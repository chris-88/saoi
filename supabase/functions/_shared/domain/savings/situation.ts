import type { FactReader } from '../journey.ts'
import type { Allocation, Arrangement, SavingsSituation } from './arrange.ts'

/**
 * The customer's situation, read off the case for the arrangement engine.
 *
 * Every key here is `household` in the catalogue: a deposit is saved by the people buying
 * the house together, whoever's name the account is in. Nothing is defaulted. A missing
 * figure stays null and the engine decides what it can still do without it, which is the
 * difference between "nothing to lock away" and "lock away a number somebody guessed".
 */
export function situationFrom(facts: FactReader, today: string): SavingsSituation {
  const target = facts.get('goals.targetDate', 'household')

  return {
    lumpSum: facts.number('assets.savingsBalance', 'household'),
    monthly: facts.number('goals.monthlySaving', 'household'),
    firstTimeBuyer: facts.boolean('housing.firstTimeBuyer', 'household'),
    mortgageWithThisBank: facts.boolean('mortgage.withThisBank', 'household'),
    monthsToTarget: typeof target === 'string' ? monthsUntil(today, target) : null,
  }
}

/**
 * Whole months from today until a target month, or null when the target does not parse.
 *
 * The target is stored as `YYYY-MM` or `YYYY-MM-DD`, and only the month matters: a deposit
 * needed "by June" is needed at the start of June, so the day is dropped rather than letting
 * the 30th buy an extra month of a fixed term. A target already passed is zero months, not a
 * negative number, because nothing can be locked away for less than no time.
 */
export function monthsUntil(today: string, target: string): number | null {
  const from = /^(\d{4})-(\d{2})/.exec(today)
  const to = /^(\d{4})-(\d{2})/.exec(target)
  if (from === null || to === null) return null

  const months = (Number(to[1]) - Number(from[1])) * 12 + (Number(to[2]) - Number(from[2]))
  return Math.max(0, months)
}

/**
 * The arrangement as the prompt says it.
 *
 * Lines rather than prose, so the model sees exactly what the card will show and can say one
 * sentence about why it is shaped that way without restating any figure. The bonus is kept
 * separate from the interest here as everywhere else: it is conditional.
 */
export function describeArrangement(arrangement: Arrangement): readonly string[] {
  const lines = arrangement.allocations.map(
    (allocation) => `- ${allocation.name}: ${describeAllocation(allocation)}. ${allocation.job}`,
  )

  lines.push(
    `- About €${Math.round(arrangement.firstYearInterest).toLocaleString('en-IE')} of interest in the first year, at the published rates.`,
  )

  if (arrangement.bonus !== null) {
    lines.push(
      `- Plus a €${arrangement.bonus.amount.toLocaleString('en-IE')} bonus, separately and only if: ${arrangement.bonus.conditions.join(' ')}`,
    )
  }

  for (const note of arrangement.notes) lines.push(`- ${note}`)

  return lines
}

/** "€32,000 once, for 6 months at 1.51%" / "€200 a month at 2%". */
export function describeAllocation(allocation: Allocation): string {
  const amount = `€${allocation.amount.toLocaleString('en-IE')}`
  const rate = `${formatRate(allocation.annualRate)} AER`

  if (allocation.cadence === 'monthly') return `${amount} a month at ${rate}`

  return allocation.termMonths === null
    ? `${amount} once at ${rate}`
    : `${amount} once, for ${String(allocation.termMonths)} months at ${rate}`
}

/** The rate as a card prints it: "1.51%", "2%", "3%". No trailing zeros, no float noise. */
export function formatRate(annualRate: number): string {
  return `${(Math.round(annualRate * 10_000) / 100).toString()}%`
}
