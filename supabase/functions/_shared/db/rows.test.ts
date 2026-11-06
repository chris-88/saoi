import { describe, expect, it } from 'vitest'
import { toUsage } from './rows.ts'

const model = { input: 300, output: 400, cacheRead: 26_000, cacheWrite: 0 }
const gate = { input: 1_300, output: 20, cacheRead: 0, cacheWrite: 0 }

/**
 * Timing rides inside the usage column. It is optional, because every message written before
 * it existed has none, and tolerant, because a timing that does not parse must not take the
 * cost numbers down with it.
 */
describe('usage on a message row', () => {
  it('carries the timing when it is there', () => {
    const timing = {
      gateMs: 1_400,
      firstTextMs: 3_200,
      totalMs: 10_100,
      rounds: 2,
      coldPrefix: true,
    }
    expect(toUsage({ model, gate, timing })).toEqual({ model, gate, timing })
  })

  it('reads a row from before timing existed', () => {
    expect(toUsage({ model, gate })).toEqual({ model, gate })
  })

  it('keeps the cost numbers when the timing is malformed', () => {
    expect(toUsage({ model, gate, timing: { gateMs: 'soon' } })).toEqual({ model, gate })
  })

  it('is null when nobody measured the turn', () => {
    expect(toUsage(null)).toBeNull()
    expect(toUsage({ model })).toBeNull()
  })
})
