import { describe, expect, it } from 'vitest'
import { describeGoals } from './goals.ts'
import { MAX_GAPS_FOR_PLAN } from '../domain/conversation/stages.ts'
import type { FactKey } from '../domain/facts.ts'
import type { GoalContext } from '../domain/goals/types.ts'

/**
 * The goal section tells the model what gates the plan card, not only what is unknown.
 *
 * Case ad93c361: the customer asked for a plan three times while three facts were missing, the
 * stage withheld `propose_plan` as designed, and the model, unable to see the gate, drew the
 * empty status card as the plan and said it was done. These pin the sentence that closes that
 * gap, on both sides of the threshold.
 */

function contextWith(known: Partial<Record<FactKey, unknown>>): GoalContext {
  const facts = new Map(Object.entries(known) as [FactKey, unknown][])
  return {
    facts: {
      has: (key) => facts.has(key),
      get: (key) => facts.get(key),
      number: (key) => {
        const value = facts.get(key)
        return typeof value === 'number' ? value : null
      },
      boolean: (key) => {
        const value = facts.get(key)
        return typeof value === 'boolean' ? value : null
      },
    },
    applications: [],
    sensitiveDisclosure: false,
    plans: [],
    today: '2026-10-19',
  }
}

const FIRST_HOME: Partial<Record<FactKey, unknown>> = {
  'goals.primaryObjective': 'Buy first home with wife by end of next year',
  'housing.firstTimeBuyer': true,
  'household.buyingWith': 'partner',
}

describe('the goal section and the plan gate', () => {
  it('says how many unknowns the plan card allows and how many more to ask for', () => {
    // As ad93c361 stood on turn 9: four of seven known, three unknown, one over the gate.
    const { lines } = describeGoals(
      contextWith({
        ...FIRST_HOME,
        'goals.targetDate': '2027-12',
        'goals.monthlySaving': 1200,
        'housing.purchasePrice': 450_000,
      }),
    )

    const line = lines.find((candidate) => candidate.startsWith('Still unknown for it:'))
    expect(line).toBeDefined()
    expect(line).toContain(`at most ${String(MAX_GAPS_FOR_PLAN)} of these are left`)
    expect(line).toContain('ask for 1 more')
    expect(line).toContain('never say a plan is done or saved before the card has been tapped')
  })

  it('says the card is available once the gate is met', () => {
    const { lines } = describeGoals(
      contextWith({
        ...FIRST_HOME,
        'goals.targetDate': '2027-12',
        'goals.monthlySaving': 1200,
        'housing.purchasePrice': 450_000,
        'assets.depositAmount': 32_000,
        'income.annualBasic': 150_000,
      }),
    )

    const line = lines.find((candidate) => candidate.startsWith('Still unknown for it:'))
    expect(line).toBeDefined()
    expect(line).toContain('Monthly loan repayments')
    expect(line).toContain('The plan card is available now.')
    expect(line).not.toContain('ask for')
  })
})

describe('a switcher in the goal section', () => {
  it('is told it is a switch, not a purchase', () => {
    const { lines } = describeGoals(
      contextWith({
        'goals.primaryObjective': 'Switch mortgage',
        'mortgage.customerType': 'switcher',
      }),
    )
    expect(lines.some((line) => line.startsWith('This is a switch of a mortgage'))).toBe(true)
    expect(lines.find((line) => line.startsWith('What they came in about'))).toContain(
      'switch our mortgage',
    )
  })
})
