import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '@contracts/stream.ts'
import { streamSaoirseTurn } from '@/saoirse/saoirseTurnClient'
import { useConversation, type TurnEntry } from '@/saoirse/useConversation'

vi.mock('@/saoirse/saoirseTurnClient', () => ({ streamSaoirseTurn: vi.fn() }))

const DONE: StreamEvent = {
  type: 'done',
  messageId: '11111111-2222-4333-8444-555555555555',
  gateCategory: 'banking',
}

/**
 * A scripted turn that pauses part way, so what is on screen between two events can be looked
 * at rather than only what is left when the turn ends.
 */
function scripted(before: readonly StreamEvent[], after: readonly StreamEvent[]) {
  let resume: () => void = () => undefined
  const paused = new Promise<void>((resolve) => {
    resume = resolve
  })

  vi.mocked(streamSaoirseTurn).mockImplementation(async (_input, onEvent) => {
    for (const event of before) onEvent(event)
    await paused
    for (const event of after) onEvent(event)
  })

  return { resume: () => resume() }
}

/** The transcript as a person would read it: who spoke and what, or a card. */
const transcript = (entries: readonly TurnEntry[]): string[] =>
  entries.map((entry) => (entry.kind === 'message' ? `${entry.author}: ${entry.text}` : 'card'))

afterEach(() => {
  vi.clearAllMocks()
})

/**
 * The server takes back a round whose tool it refused. Between the retract and the rewrite
 * there is a moment with nothing to show, and that moment must not be an empty bubble: the
 * surface reads "Saoirse is thinking" off there being no reply on screen while a turn is in flight.
 */
describe('a round that was withdrawn', () => {
  it('takes the words back, and leaves no empty bubble while the rewrite is on its way', async () => {
    const said = 'Payslip first, then. Send it in as a photo.'
    const script = scripted(
      [
        { type: 'text_delta', text: said },
        { type: 'retract', length: said.length },
      ],
      [{ type: 'text_delta', text: 'There is no document to send yet.' }, DONE],
    )

    const { result } = renderHook(() => useConversation('case-1'))

    let turn: Promise<void> = Promise.resolve()
    act(() => {
      turn = result.current.send('here is my payslip')
    })

    // Paused between the retract and the rewrite: still in flight, nothing of Saoirse's on screen.
    expect(result.current.streaming).toBe(true)
    expect(transcript(result.current.entries)).toEqual(['customer: here is my payslip'])

    await act(async () => {
      script.resume()
      await turn
    })

    expect(transcript(result.current.entries)).toEqual([
      'customer: here is my payslip',
      'assistant: There is no document to send yet.',
    ])
    expect(result.current.streaming).toBe(false)
  })

  it('trims exactly the characters named and leaves what an earlier round said', async () => {
    const withdrawn = '\n\nI will put the invitation up so she can do that.'
    const script = scripted(
      [
        { type: 'text_delta', text: 'Right.' },
        { type: 'text_delta', text: withdrawn },
        { type: 'retract', length: withdrawn.length },
      ],
      [{ type: 'text_delta', text: '\n\nHannah has already joined.' }, DONE],
    )

    const { result } = renderHook(() => useConversation('case-1'))

    let turn: Promise<void> = Promise.resolve()
    act(() => {
      turn = result.current.send('can you invite Hannah')
    })

    expect(transcript(result.current.entries)).toEqual([
      'customer: can you invite Hannah',
      'assistant: Right.',
    ])

    await act(async () => {
      script.resume()
      await turn
    })

    expect(transcript(result.current.entries)).toEqual([
      'customer: can you invite Hannah',
      'assistant: Right.\n\nHannah has already joined.',
    ])
  })
})
