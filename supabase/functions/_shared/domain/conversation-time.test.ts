import { describe, expect, it } from 'vitest'
import { conversationTiming } from './conversation-time.ts'

const at = (minutes: number): string => new Date(Date.UTC(2026, 9, 9, 9, minutes)).toISOString()

describe('conversationTiming', () => {
  it('measures a single sitting end to end', () => {
    const timing = conversationTiming([at(0), at(2), at(5), at(12)])

    expect(timing.activeMinutes).toBe(12)
    expect(timing.elapsedMinutes).toBe(12)
    expect(timing.sittings).toBe(1)
  })

  /*
   * The figure this function exists for. Somebody who starts at nine, leaves, and finishes at
   * four spent minutes in the conversation, not seven hours — and seven hours is the number a
   * naive first-to-last would put on a slide.
   */
  it('does not count time the customer was away', () => {
    const timing = conversationTiming([at(0), at(4), at(300), at(306)])

    expect(timing.activeMinutes).toBe(10)
    expect(timing.elapsedMinutes).toBe(306)
    expect(timing.sittings).toBe(2)
  })

  it('counts a pause short enough to be thinking', () => {
    expect(conversationTiming([at(0), at(9)]).activeMinutes).toBe(9)
    expect(conversationTiming([at(0), at(9)]).sittings).toBe(1)
  })

  it('treats a long pause as leaving', () => {
    expect(conversationTiming([at(0), at(11)]).activeMinutes).toBe(0)
    expect(conversationTiming([at(0), at(11)]).sittings).toBe(2)
  })

  it('is zero for one message and for none', () => {
    expect(conversationTiming([at(0)])).toEqual({
      activeMinutes: 0,
      elapsedMinutes: 0,
      sittings: 1,
    })
    expect(conversationTiming([])).toEqual({ activeMinutes: 0, elapsedMinutes: 0, sittings: 0 })
  })

  it('does not care what order it is given them in', () => {
    expect(conversationTiming([at(12), at(0), at(5)]).elapsedMinutes).toBe(12)
  })

  it('ignores a timestamp it cannot read rather than producing NaN', () => {
    expect(conversationTiming([at(0), 'not a date', at(6)]).activeMinutes).toBe(6)
  })
})
