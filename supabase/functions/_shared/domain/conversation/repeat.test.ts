import { describe, expect, it } from 'vitest'
import { isRepeatedMessage, REPEAT_WINDOW_MS } from './repeat.ts'

const firstSentAt = '2026-10-14T10:00:00.000Z'
const secondsLater = (seconds: number): number => Date.parse(firstSentAt) + seconds * 1000
const earlier = (content: string) => ({ content, createdAt: firstSentAt })

describe('a message sent again is a signal, not a coincidence', () => {
  /**
   * The live case this came from: the customer typed the same question twice inside a minute
   * because Saoirse's answer had not answered it, and the transcript showed two ordinary turns.
   */
  it('hears the same words a minute later', () => {
    expect(
      isRepeatedMessage(
        'Can I get a mortgage?',
        earlier('Can I get a mortgage?'),
        secondsLater(60),
      ),
    ).toBe(true)
  })

  it('ignores case, surrounding space and the spacing between words', () => {
    expect(
      isRepeatedMessage(
        '  can i get   a MORTGAGE? ',
        earlier('Can I get a mortgage?'),
        secondsLater(60),
      ),
    ).toBe(true)
  })

  it('does not hear a different message', () => {
    expect(
      isRepeatedMessage('Can I get a loan?', earlier('Can I get a mortgage?'), secondsLater(60)),
    ).toBe(false)
  })

  it('stops listening after ten minutes', () => {
    const window = REPEAT_WINDOW_MS / 1000
    expect(isRepeatedMessage('Hello?', earlier('Hello?'), secondsLater(window))).toBe(true)
    expect(isRepeatedMessage('Hello?', earlier('Hello?'), secondsLater(window + 1))).toBe(false)
  })

  it('treats an empty message as nothing to repeat', () => {
    expect(isRepeatedMessage('   ', earlier(''), secondsLater(5))).toBe(false)
  })

  it('treats a timestamp it cannot read as too long ago', () => {
    expect(
      isRepeatedMessage('Hello?', { content: 'Hello?', createdAt: 'yesterday' }, secondsLater(5)),
    ).toBe(false)
  })
})
