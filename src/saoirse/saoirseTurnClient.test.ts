import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamSaoirseTurn } from '@/saoirse/saoirseTurnClient'
import type { StreamEvent } from '@contracts/stream.ts'

vi.mock('@/lib/env', () => ({ saoiApiUrl: 'https://api.example.test/saoi' }))

vi.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'token' } } }) },
  }),
}))

/** A response whose body opens and then says nothing at all, which is how a turn hangs. */
function silentStream(): Response {
  const body = new ReadableStream<Uint8Array>({
    start() {
      // Deliberately never enqueues and never closes.
    },
  })

  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function framed(events: readonly StreamEvent[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  })

  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('a turn that stops answering', () => {
  /**
   * Reported live: the typing indicator ran forever with nothing to click.
   *
   * A read that never settles is the worst way for a turn to fail — the connection stays open,
   * no bytes arrive, and the customer has no way out. It has to become an ordinary error.
   */
  it('gives up on a stream that opens and says nothing', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(silentStream()))

    const events: StreamEvent[] = []
    const turn = streamSaoirseTurn({ caseId: 'case-1', message: 'hello' }, (event) =>
      events.push(event),
    )

    await vi.advanceTimersByTimeAsync(60_000)
    await turn

    expect(events).toHaveLength(1)
    const [first] = events
    expect(first?.type).toBe('error')
    // Phrased so the customer knows what to do, not what broke.
    if (first?.type !== 'error') throw new Error('expected an error event')
    expect(first.error.message).toMatch(/say it again/i)
  })

  it('leaves a stream that is answering alone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        framed([
          { type: 'text_delta', text: 'Hello' },
          {
            type: 'done',
            messageId: '11111111-2222-4333-8444-555555555555',
            gateCategory: 'banking',
          },
        ]),
      ),
    )

    const events: StreamEvent[] = []
    await streamSaoirseTurn({ caseId: 'case-1', message: 'hello' }, (event) => events.push(event))

    expect(events.map((event) => event.type)).toEqual(['text_delta', 'done'])
  })
})

/**
 * A tool-first turn sends no text at all during its first round.
 *
 * The silence limit was written on the assumption that a working turn produces text the whole
 * way through. It does not: the model can spend an entire round writing a record_facts call
 * and a card request, and the first byte the browser sees is the opening word of the round
 * after that. On a dense opening message that gap ran past a minute, and the customer was told
 * the turn had taken too long while the server was still doing it properly. The server now
 * sends an SSE comment while it works.
 */
describe('a turn that is thinking', () => {
  const withHeartbeats = (events: readonly StreamEvent[], beats: number): Response => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let beat = 0; beat < beats; beat += 1) controller.enqueue(encoder.encode(': \n\n'))
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
        controller.close()
      },
    })
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  it('ignores heartbeat frames and still delivers the reply', async () => {
    const reply: StreamEvent[] = [
      { type: 'text_delta', text: 'Two kids and €2,500 a month.' },
      { type: 'done', messageId: '11111111-2222-4333-8444-555555555555', gateCategory: 'banking' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(withHeartbeats(reply, 6)))

    const seen: StreamEvent[] = []
    await streamSaoirseTurn({ caseId: 'c1', message: 'hello' }, (event) => seen.push(event))

    // Six comment frames in front of it, and not one of them reaches the UI.
    expect(seen).toEqual(reply)
  })
})

/**
 * A round the server took back.
 *
 * The frame carries a count of characters, and the client's only job is to deliver it intact
 * and in order: what to do with it is the conversation's decision, not the transport's.
 */
describe('a round that was withdrawn', () => {
  it('delivers the retract with its length, between the words and the rewrite', async () => {
    const reply: StreamEvent[] = [
      { type: 'text_delta', text: 'Payslip first, then.' },
      { type: 'retract', length: 'Payslip first, then.'.length },
      { type: 'text_delta', text: 'There is no document to send yet.' },
      { type: 'done', messageId: '11111111-2222-4333-8444-555555555555', gateCategory: 'banking' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(framed(reply)))

    const seen: StreamEvent[] = []
    await streamSaoirseTurn({ caseId: 'c1', message: 'hello' }, (event) => seen.push(event))

    expect(seen).toEqual(reply)
  })

  it('drops a retract that names no characters rather than passing it on', async () => {
    const done: StreamEvent = {
      type: 'done',
      messageId: '11111111-2222-4333-8444-555555555555',
      gateCategory: 'banking',
    }
    // Shaped like a retract, but the contract says a withdrawal is never empty.
    const empty = { type: 'retract', length: 0 } as StreamEvent
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(framed([empty, done])))

    const seen: StreamEvent[] = []
    await streamSaoirseTurn({ caseId: 'c1', message: 'hello' }, (event) => seen.push(event))

    expect(seen).toEqual([done])
  })
})

/**
 * Where the request goes and what it carries; the stream parsing is exercised above.
 */
describe('where the turn is posted', () => {
  const reply: StreamEvent[] = [
    { type: 'text_delta', text: 'Hello' },
    { type: 'done', messageId: '11111111-2222-4333-8444-555555555555', gateCategory: 'banking' },
  ]

  it('posts to the case’s turns route on saoi-api and reads the stream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(framed(reply))
    vi.stubGlobal('fetch', fetchMock)

    const seen: StreamEvent[] = []
    await streamSaoirseTurn(
      { caseId: 'case/1', message: 'hello', note: 'Say it briefly.', trigger: 'action' },
      (event) => seen.push(event),
    )

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.test/saoi/api/cases/case%2F1/turns')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    })
    // The case is in the path now, not the body.
    expect(JSON.parse(init.body as string)).toEqual({
      trigger: 'action',
      message: 'hello',
      note: 'Say it briefly.',
    })
    expect(seen).toEqual(reply)
  })

  it('turns a refusal from the service into an error event the chat can show', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'forbidden',
              message: 'Only the person who started this case can do that.',
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    const seen: StreamEvent[] = []
    await streamSaoirseTurn({ caseId: 'case-1', message: 'hello' }, (event) => seen.push(event))

    expect(seen).toEqual([
      {
        type: 'error',
        error: {
          code: 'upstream_unavailable',
          message: 'Only the person who started this case can do that.',
        },
      },
    ])
  })
})
