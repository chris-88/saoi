import { describe, expect, it } from 'vitest'
import type { FactReader } from '../journey.ts'
import type { Arrangement } from './arrange.ts'
import {
  describeAllocation,
  describeArrangement,
  formatRate,
  monthsUntil,
  situationFrom,
} from './situation.ts'

/** A reader over a flat map, enough for the four keys this reads. */
function reader(values: Record<string, unknown>): FactReader {
  return {
    has: (key) => key in values,
    get: (key) => values[key],
    number: (key) => (typeof values[key] === 'number' ? values[key] : null),
    boolean: (key) => (typeof values[key] === 'boolean' ? values[key] : null),
  }
}

describe('reading the situation off the case', () => {
  /** Case c77e613f, as recorded: the inputs the engine arranged correctly. */
  it('reads the case that started all of this', () => {
    const facts = reader({
      'assets.savingsBalance': 32_000,
      'goals.monthlySaving': 2_500,
      'housing.firstTimeBuyer': true,
      'mortgage.withThisBank': true,
      'goals.targetDate': '2027-06',
    })

    expect(situationFrom(facts, '2026-10-15')).toEqual({
      lumpSum: 32_000,
      monthly: 2_500,
      firstTimeBuyer: true,
      mortgageWithThisBank: true,
      monthsToTarget: 8,
    })
  })

  /**
   * Nothing is defaulted. A missing figure is null, and the engine decides what it can still
   * do; a guessed figure would be locked away as if it were real.
   */
  it('leaves what it does not know as null, and the bonus question as unanswered', () => {
    expect(situationFrom(reader({}), '2026-10-15')).toEqual({
      lumpSum: null,
      monthly: null,
      firstTimeBuyer: null,
      mortgageWithThisBank: null,
      monthsToTarget: null,
    })
  })
})

describe('months until the target', () => {
  it('counts whole months to the month, whatever the day', () => {
    expect(monthsUntil('2026-10-15', '2027-06')).toBe(8)
    expect(monthsUntil('2026-10-15', '2027-06-30')).toBe(8)
    expect(monthsUntil('2026-10-01', '2027-06-01')).toBe(8)
  })

  it('crosses a year boundary', () => {
    expect(monthsUntil('2026-12-20', '2027-01')).toBe(1)
    expect(monthsUntil('2026-10-15', '2028-10')).toBe(24)
  })

  /** A target already passed is no time at all, not negative time. */
  it('floors at zero', () => {
    expect(monthsUntil('2026-10-15', '2026-03')).toBe(0)
  })

  it('refuses a date it cannot read', () => {
    expect(monthsUntil('2026-10-15', 'next summer')).toBeNull()
    expect(monthsUntil('soon', '2027-06')).toBeNull()
  })
})

describe('saying the arrangement', () => {
  const arrangement: Arrangement = {
    needs: [],
    allocations: [
      {
        productId: 'savings.advantage_fixed',
        name: 'Advantage Fixed Term Deposit Account',
        amount: 32_000,
        cadence: 'once',
        termMonths: 6,
        annualRate: 0.0151,
        job: 'Locked away for 6 months, which ends before you need it.',
        watch: [],
      },
      {
        productId: 'savings.mortgagesaver',
        name: 'MortgageSaver Account',
        amount: 200,
        cadence: 'monthly',
        termMonths: null,
        annualRate: 0.02,
        job: 'The least that qualifies for the bonus.',
        watch: [],
      },
    ],
    firstYearInterest: 263.4,
    bonus: { amount: 2_000, conditions: ['At least €200 a month for 6 months in a row.'] },
    unallocated: { lumpSum: 0, monthly: 0 },
    notes: ['The 12-month term pays more but ends after you need the money.'],
  }

  it('prints rates without float noise or trailing zeros', () => {
    expect(formatRate(0.0151)).toBe('1.51%')
    expect(formatRate(0.02)).toBe('2%')
    expect(formatRate(0.03)).toBe('3%')
    expect(formatRate(0.022400000000000003)).toBe('2.24%')
  })

  it('says each allocation the way a person would', () => {
    expect(describeAllocation(arrangement.allocations[0]!)).toBe(
      '€32,000 once, for 6 months at 1.51% AER',
    )
    expect(describeAllocation(arrangement.allocations[1]!)).toBe('€200 a month at 2% AER')
  })

  /** The bonus is never folded into the interest figure. It is conditional. */
  it('keeps the bonus on its own line, with its conditions, after the interest', () => {
    const lines = describeArrangement(arrangement)

    expect(lines[0]).toMatch(/^- Advantage Fixed Term Deposit Account: €32,000 once, for 6 months/)
    expect(lines[2]).toBe('- About €263 of interest in the first year, at the published rates.')
    expect(lines[3]).toMatch(/^- Plus a €2,000 bonus, separately and only if: At least €200/)
    expect(lines[4]).toBe('- The 12-month term pays more but ends after you need the money.')
  })
})
