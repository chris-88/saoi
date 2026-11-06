import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TURN_LIMITS, TurnTimeout, withinTime } from './turn.ts'

describe('the per-turn limit', () => {
  it('stays under the ~100 s at which Cloudflare cuts the connection', () => {
    expect(DEFAULT_TURN_LIMITS.wallClockMs).toBeLessThan(90_000)
    expect(DEFAULT_TURN_LIMITS.maxOutputTokens).toBe(3_072)
  })
})

describe('withinTime', () => {
  it('passes everything through when the source finishes in time', async () => {
    async function* source() {
      await Promise.resolve()
      yield 1
      yield 2
    }
    const seen: number[] = []
    for await (const value of withinTime(source(), 1_000, () => undefined)) seen.push(value)
    expect(seen).toEqual([1, 2])
  })

  it('throws TurnTimeout and aborts the provider when the source stalls', async () => {
    vi.useFakeTimers()
    try {
      async function* stalled(): AsyncGenerator<number> {
        yield 1
        await new Promise(() => undefined)
      }
      const onTimeout = vi.fn()
      const seen: number[] = []
      const consumed = (async () => {
        for await (const value of withinTime(stalled(), 85_000, onTimeout)) seen.push(value)
      })()
      const outcome = expect(consumed).rejects.toBeInstanceOf(TurnTimeout)
      await vi.advanceTimersByTimeAsync(85_001)
      await outcome
      expect(seen).toEqual([1])
      expect(onTimeout).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
