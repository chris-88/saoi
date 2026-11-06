import { describe, expect, it } from 'vitest'
import { buildPlan, watchMet } from './plan.ts'
import { evaluateNeeds } from './engine.ts'
import type { NeedContext } from './types.ts'

const contextOf = (
  facts: Record<string, unknown>,
  apps: NeedContext['applications'] = [],
): NeedContext => ({
  facts: {
    has: (key) => facts[key] !== undefined,
    get: (key) => facts[key],
    number: (key) => (typeof facts[key] === 'number' ? facts[key] : null),
    boolean: (key) => (typeof facts[key] === 'boolean' ? facts[key] : null),
  },
  sensitiveDisclosure: false,
  applications: apps,
  decisions: [],
})

/** The customer from the transcript: six months out, €600k in mind, savings elsewhere. */
const sixMonthsOut = contextOf({
  'goals.primaryObjective': 'buy our first home and move our savings to Demo Bank',
  'housing.purchasePrice': 600_000,
  'housing.firstTimeBuyer': true,
  'housing.currentTenure': 'renting',
  'assets.savingsBalance': 20_000,
  'goals.monthlySaving': 2_000,
  'goals.targetDate': '2027-04',
})

describe('a plan for someone who is not ready yet', () => {
  const plan = buildPlan(sixMonthsOut, evaluateNeeds(sixMonthsOut))

  it('exists, rather than Saoirse saying it cannot help', () => {
    expect(plan).not.toBeNull()
  })

  it('works out the deposit from the price without being told', () => {
    expect(plan?.steps[0]?.because).toContain('€60,000')
    expect(plan?.steps[0]?.because).toContain('€40,000')
  })

  it('says how long at the rate they can actually save', () => {
    // €40,000 short at €2,000 a month.
    expect(plan?.steps[1]?.because).toContain('20 months')
  })

  it('puts the mortgage last, not first', () => {
    expect(plan?.steps.at(-1)?.id).toBe('start-mortgage')
    expect(plan?.steps.at(-1)?.state).toBe('later')
  })

  it('commits to something checkable rather than "we will be in touch"', () => {
    expect(plan?.watch).toEqual({
      kind: 'savings_target',
      target: 60_000,
      describe: 'your savings reach €60,000',
    })
  })
})

describe('no plan where there is no sequence', () => {
  it('does not invent one for someone who already has the deposit', () => {
    const ready = contextOf({
      'goals.primaryObjective': 'buy our first home',
      'housing.purchasePrice': 450_000,
      'assets.depositAmount': 65_000,
    })

    expect(buildPlan(ready, evaluateNeeds(ready))).toBeNull()
  })

  it('does not invent one for someone who is not buying', () => {
    const saving = contextOf({ 'goals.primaryObjective': 'start saving a bit each month' })
    expect(buildPlan(saving, evaluateNeeds(saving))).toBeNull()
  })

  it('says nothing about timing it cannot know', () => {
    const noRate = contextOf({
      'goals.primaryObjective': 'buy our first home',
      'housing.purchasePrice': 600_000,
      'assets.savingsBalance': 20_000,
    })
    const plan = buildPlan(noRate, evaluateNeeds(noRate))

    expect(plan?.steps[1]?.because).toMatch(/depends on/i)
    expect(plan?.steps[1]?.when).toBeNull()
  })
})

describe('knowing when to come back', () => {
  it('waits until the money is actually there', () => {
    const watch = { kind: 'savings_target', target: 60_000, describe: '' } as const

    expect(watchMet(watch, { savingsBalance: 59_999, today: '2027-04-01' })).toBe(false)
    expect(watchMet(watch, { savingsBalance: 60_000, today: '2026-10-05' })).toBe(true)
  })

  it('does not fire on a balance it cannot see', () => {
    const watch = { kind: 'savings_target', target: 60_000, describe: '' } as const
    expect(watchMet(watch, { savingsBalance: null, today: '2030-01-01' })).toBe(false)
  })

  it('fires on the day for a date watch', () => {
    const watch = { kind: 'date', on: '2027-04-01', describe: '' } as const

    expect(watchMet(watch, { savingsBalance: null, today: '2027-03-31' })).toBe(false)
    expect(watchMet(watch, { savingsBalance: null, today: '2027-04-01' })).toBe(true)
  })
})
