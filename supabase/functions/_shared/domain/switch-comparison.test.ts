import { describe, expect, it } from 'vitest'
import { compareSwitch, comparisonYears } from './switch-comparison.ts'
import { monthlyRepayment } from './mortgage.ts'

/**
 * Case eb37e9b5, as the customer put it: €300,000 over twenty years, AIB offering 4% fixed for
 * two years with no cashback, against the bank's published two-year fixed with €6,000 cashback.
 */
const AIB_STAY_OFFER = {
  label: 'AIB, 4% fixed for 2 years',
  ratePct: 4,
  cashbackEur: null,
  fixedYears: 2,
}

describe('compareSwitch', () => {
  it('sets the stay offer against each published rate over the fixed period, cashback counted once', () => {
    const comparison = compareSwitch({
      balanceEur: 300_000,
      termYears: 20,
      against: AIB_STAY_OFFER,
      candidates: [
        {
          id: 'two-year',
          label: '2 years fixed',
          ratePct: 3.85,
          cashbackEur: 6_000,
          fixedYears: 2,
        },
        { id: 'hvm', label: '4 years fixed', ratePct: 3.15, cashbackEur: null, fixedYears: 4 },
      ],
    })

    expect(comparison.against.monthlyEur).toBe(Math.round(monthlyRepayment(300_000, 4, 20)))

    const two = comparison.rows[0]
    expect(two?.monthlyDifferenceEur).toBe(
      Math.round(monthlyRepayment(300_000, 4, 20)) -
        Math.round(monthlyRepayment(300_000, 3.85, 20)),
    )
    expect(two?.overYears).toBe(2)
    expect(two?.repaymentDifferenceEur).toBe((two?.monthlyDifferenceEur ?? 0) * 24)
    expect(two?.cashbackDifferenceEur).toBe(6_000)
    expect(two?.netBeforeCostsEur).toBe((two?.repaymentDifferenceEur ?? 0) + 6_000)

    // The High Value rate: a bigger monthly saving, over its own four years, and no cashback.
    const hvm = comparison.rows[1]
    expect(hvm?.overYears).toBe(4)
    expect(hvm?.cashbackDifferenceEur).toBe(0)
    expect(hvm?.monthlyDifferenceEur).toBeGreaterThan(two?.monthlyDifferenceEur ?? 0)
  })

  it('counts cashback the other side pays against the candidate', () => {
    const comparison = compareSwitch({
      balanceEur: 200_000,
      termYears: 25,
      against: { label: 'Stay, with €2,000 back', ratePct: 3.9, cashbackEur: 2_000, fixedYears: 3 },
      candidates: [
        { id: 'x', label: '3 years fixed', ratePct: 3.9, cashbackEur: 4_000, fixedYears: 3 },
      ],
    })
    expect(comparison.rows[0]?.monthlyDifferenceEur).toBe(0)
    expect(comparison.rows[0]?.cashbackDifferenceEur).toBe(2_000)
    expect(comparison.rows[0]?.netBeforeCostsEur).toBe(2_000)
  })

  it('compares a variable candidate over the other rate’s fixed period, else one year, never past the term', () => {
    expect(comparisonYears({ fixedYears: null }, { fixedYears: 2 }, 20)).toBe(2)
    expect(comparisonYears({ fixedYears: null }, { fixedYears: null }, 20)).toBe(1)
    expect(comparisonYears({ fixedYears: 10 }, { fixedYears: null }, 3)).toBe(3)
  })

  it('matches the brochure’s worked repayment', () => {
    // "A typical mortgage of €100,000 over 20 years ... costs €613.16 per month at 4.15% variable."
    // Within a euro: the bank's day-count convention is not published, and the annuity is.
    expect(Math.abs(monthlyRepayment(100_000, 4.15, 20) - 613.16)).toBeLessThan(1)
  })
})
