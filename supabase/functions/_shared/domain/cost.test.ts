import { describe, expect, it } from 'vitest'
import {
  SAOI_PRICES,
  EMPTY_USAGE,
  GATE_PRICES,
  TYPICAL_TURN,
  addUsage,
  costIn,
  sumUsage,
  tokensIn,
  type TurnUsage,
} from './cost.ts'

const usage = (
  model: Partial<TurnUsage['model']>,
  gate: Partial<TurnUsage['gate']> = {},
): TurnUsage => ({
  model: { ...EMPTY_USAGE.model, ...model },
  gate: { ...EMPTY_USAGE.gate, ...gate },
})

describe('counting tokens', () => {
  it('counts every token however it was charged', () => {
    expect(
      tokensIn(usage({ input: 100, output: 50, cacheRead: 7_000, cacheWrite: 10 }, { input: 5 })),
    ).toBe(7_165)
  })

  it('is nothing for a turn that never ran', () => {
    expect(tokensIn(EMPTY_USAGE)).toBe(0)
    expect(costIn(EMPTY_USAGE)).toBe(0)
  })
})

describe('pricing', () => {
  it('charges cached reads at a tenth of fresh input', () => {
    const fresh = costIn(usage({ input: 1_000_000 }))
    const cached = costIn(usage({ cacheRead: 1_000_000 }))

    expect(cached).toBeCloseTo(fresh / 10, 6)
  })

  it('charges cache writes above fresh input, because they are', () => {
    expect(costIn(usage({ cacheWrite: 1_000 }))).toBeGreaterThan(costIn(usage({ input: 1_000 })))
  })

  it('charges output far above input, which is why terse answers matter', () => {
    expect(costIn(usage({ output: 1_000 }))).toBeCloseTo(costIn(usage({ input: 1_000 })) * 5, 6)
  })

  it('prices the gate below the model, because it is a smaller one', () => {
    expect(costIn(usage({}, { input: 1_000 }))).toBeLessThan(costIn(usage({ input: 1_000 })))
    expect(GATE_PRICES.input).toBeLessThan(SAOI_PRICES.input)
  })

  it('prices a million fresh tokens at the stated rate', () => {
    expect(costIn(usage({ input: 1_000_000 }))).toBeCloseTo(SAOI_PRICES.input, 6)
  })
})

describe('adding it up', () => {
  it('sums each kind separately, so the mix is not lost', () => {
    const total = addUsage(usage({ input: 10, cacheRead: 100 }), usage({ input: 5, output: 20 }))

    expect(total.model.input).toBe(15)
    expect(total.model.cacheRead).toBe(100)
    expect(total.model.output).toBe(20)
  })

  it('sums a whole conversation', () => {
    const turns = [usage({ input: 100 }), usage({ input: 200 }), usage({ output: 50 })]

    expect(sumUsage(turns).model.input).toBe(300)
    expect(sumUsage(turns).model.output).toBe(50)
  })

  it('is nothing for a conversation that never happened', () => {
    expect(sumUsage([])).toEqual(EMPTY_USAGE)
  })
})

describe('the fallback for untracked turns', () => {
  /*
   * Guards the measurement rather than the code. If the prompt grows enormously or the model
   * changes, the number quoted in the comment above TYPICAL_TURN is no longer what was measured
   * and the estimate silently drifts from reality.
   */
  it('costs what the measurement said a turn costs, within a tenth of a cent', () => {
    expect(costIn(TYPICAL_TURN)).toBeGreaterThan(0.01)
    expect(costIn(TYPICAL_TURN)).toBeLessThan(0.025)
  })

  it('is dominated by cached reads, which is the thing worth knowing', () => {
    expect(TYPICAL_TURN.model.cacheRead).toBeGreaterThan(TYPICAL_TURN.model.input * 4)
  })
})
