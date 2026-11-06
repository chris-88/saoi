import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { parseStreamEvent, type StreamEvent } from '@shared/contracts/stream.ts'
import { SSE_HEADERS, eventStream, encodeFrame, just } from './stream.ts'

/**
 * The wire format of a turn. `test/recordings/saoirse-turn-opening.json` holds the raw bodies the
 * Edge Function wrote for the `opening` conversation, so these are checked against what the
 * SPA's `saoirseTurnClient` has actually been parsing, not against a description of it.
 */
const recording = JSON.parse(
  readFileSync(new URL('../../test/recordings/saoirse-turn-opening.json', import.meta.url), 'utf8'),
) as { contentType: string; turns: string[] }

const decode = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text
    text += value
  }
}

/** The way `saoirseTurnClient` reads a body: blank-line separated, `data: ` lines only. */
function clientParse(body: string): unknown[] {
  return body
    .split('\n\n')
    .flatMap((frame) => frame.split('\n'))
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as unknown)
}

describe('encodeFrame', () => {
  it('is `data: <json>` and a blank line, and nothing else', () => {
    expect(encodeFrame({ type: 'text_delta', text: 'Hi' })).toBe(
      'data: {"type":"text_delta","text":"Hi"}\n\n',
    )
    expect(encodeFrame({ type: 'retract', length: 4 })).toBe(
      'data: {"type":"retract","length":4}\n\n',
    )
    expect(
      encodeFrame({
        type: 'error',
        error: { code: 'upstream_unavailable', message: 'No.' },
      }),
    ).toBe('data: {"type":"error","error":{"code":"upstream_unavailable","message":"No."}}\n\n')
  })

  it('round-trips through the parser the SPA uses', () => {
    const events: StreamEvent[] = [
      { type: 'text_delta', text: 'a "quoted" line\nwith a break' },
      { type: 'status', caseId: '0b0c6a0e-6d4e-4a42-9d3f-7a3d4a1d2c11', invalidate: ['case'] },
      { type: 'done', messageId: '0b0c6a0e-6d4e-4a42-9d3f-7a3d4a1d2c12', gateCategory: 'banking' },
    ]
    for (const event of events) {
      const frame = encodeFrame(event)
      expect(parseStreamEvent(frame.slice('data: '.length, -2))).toEqual(event)
    }
  })
})

describe('against the Edge Function’s recording', () => {
  it.each([0, 1])('re-encodes recorded turn %i byte for byte', async (index) => {
    const body = recording.turns[index] ?? ''
    // Parse as the client does, without the schema: the recording holds placeholder ids.
    const events = clientParse(body) as StreamEvent[]
    const written = await decode(eventStream(just(...events)))
    expect(written).toBe(body)
  })

  it('has the documented order: text, cards, status, done', () => {
    const types = clientParse(recording.turns[0] ?? '').map((e) => (e as StreamEvent).type)
    expect(types).toEqual(['text_delta', 'text_delta', 'text_delta', 'card', 'status', 'done'])
  })
})

describe('eventStream', () => {
  it('declares an event stream the proxy must not buffer', () => {
    expect(SSE_HEADERS['Content-Type']).toBe(recording.contentType)
    expect(SSE_HEADERS['X-Accel-Buffering']).toBe('no')
    expect(SSE_HEADERS['Cache-Control']).toContain('no-cache')
  })

  it('writes a keep-alive comment when nothing has happened for a while, and the client ignores it', async () => {
    vi.useFakeTimers()
    try {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      async function* slow(): AsyncGenerator<StreamEvent> {
        yield { type: 'text_delta', text: 'one' }
        await gate
        yield { type: 'text_delta', text: 'two' }
      }

      const bodyPromise = decode(eventStream(slow(), { keepAliveMs: 25_000 }))
      await vi.advanceTimersByTimeAsync(60_000)
      release()
      await vi.advanceTimersByTimeAsync(1)
      const body = await bodyPromise

      expect(body.match(/^: keep-alive$/gm)).toHaveLength(2)
      expect(clientParse(body)).toEqual([
        { type: 'text_delta', text: 'one' },
        { type: 'text_delta', text: 'two' },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('ends the generator when the customer goes away', async () => {
    let finished = false
    async function* endless(): AsyncGenerator<StreamEvent> {
      try {
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 5))
          yield { type: 'text_delta', text: '.' }
        }
      } finally {
        finished = true
      }
    }
    const reader = eventStream(endless()).getReader()
    await reader.read()
    await reader.cancel()
    await vi.waitFor(() => expect(finished).toBe(true))
  })
})
