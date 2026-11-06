import { describe, expect, it } from 'vitest'
import { evaluateNeeds, nextToClarify, readyToSurface, deferred } from './engine.ts'
import type { NeedContext } from './types.ts'

/**
 * The household from §14 of the design document, as the engine sees it.
 *
 * This is the demonstration's own customer, so it doubles as a guard: if a change makes Saoirse
 * offer a credit card to someone in the middle of a mortgage, this fails.
 */
const household = (): NeedContext => {
  const facts: Record<string, unknown> = {
    'goals.primaryObjective': 'buy our first home with my wife',
    'housing.firstTimeBuyer': true,
    'housing.currentTenure': 'renting',
    'assets.depositAmount': 65_000,
    'identity.maritalStatus': 'married',
    'lifeEvent.recentlyMarried': true,
    'lifeEvent.newChild': true,
    'household.buyingWith': 'partner',
    'household.financesManagedJointly': false,
    'household.dependantCount': 1,
    'borrowing.requestedAmount': 15_000,
  }

  return {
    facts: {
      has: (key) => facts[key] !== undefined,
      get: (key) => facts[key],
      number: (key) => (typeof facts[key] === 'number' ? facts[key] : null),
      boolean: (key) => (typeof facts[key] === 'boolean' ? facts[key] : null),
    },
    sensitiveDisclosure: false,
    applications: [{ product: 'mortgage', state: 'under_review' }],
    decisions: [],
  }
}

describe('the POC household (§14)', () => {
  const candidates = evaluateNeeds(household())
  const of = (id: string) => candidates.find((candidate) => candidate.need.id === id)

  it('is certain about the mortgage, because they said so', () => {
    expect(of('first_home_mortgage')?.confidence).toBe(1)
  })

  it('surfaces the joint account from marriage plus separate finances', () => {
    expect(of('shared_household_finances')?.state).toBe('ready_to_surface')
  })

  it('holds the borrowing rather than dropping or pushing it', () => {
    const borrowing = of('home_improvement_borrowing')
    expect(borrowing?.state).toBe('deferred')
    expect(borrowing?.reason).toMatch(/mortgage/i)
  })

  it('does not offer a credit card nobody asked for', () => {
    expect(of('everyday_card_credit')?.state).toBe('latent')
    expect(of('everyday_card_credit')?.confidence).toBe(0)
  })

  it('does not put everything on screen at once (§14)', () => {
    // The whole point: relevant is not the same as offer it now.
    expect(readyToSurface(candidates).length).toBeLessThan(candidates.length)
    expect(deferred(candidates).length).toBeGreaterThan(0)
  })

  it('has one next question rather than a list', () => {
    const next = nextToClarify(candidates)
    expect(next === null || typeof next.nextQuestion === 'string').toBe(true)
  })

  it('prints the table for review', () => {
    const rows = [...candidates].sort((a, b) => b.confidence - a.confidence)
    for (const row of rows) {
      const reason = row.reason === null ? '' : ` — ${row.reason}`
      console.log(`${row.confidence.toFixed(2)}  ${row.state.padEnd(17)}${row.need.id}${reason}`)
    }
    expect(rows.length).toBeGreaterThan(0)
  })
})
