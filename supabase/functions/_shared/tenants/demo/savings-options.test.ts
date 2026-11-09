import { describe, expect, it } from 'vitest'
import { demoSavingsOptions } from './savings-options.ts'
import { boiSnapshot } from '../../market/boi.snapshot.ts'
import { depositRatesOf } from '../../market/schema.ts'
import { arrange, type SavingsSituation } from '../../domain/savings/arrange.ts'

const byId = (id: string) => demoSavingsOptions.find((option) => option.id === id)

/** The market record behind an option: what the engine's numbers must agree with. */
const market = (id: string) => {
  const record = boiSnapshot.products.find((candidate) => candidate.productId === id)
  expect(record, id).toBeDefined()
  return { ...record!, rates: depositRatesOf(record!) }
}

describe('translating the pack into something that can be arranged', () => {
  it('carries the market rates across as fractions', () => {
    for (const id of ['savings.supersaver', 'savings.mortgagesaver', 'savings.notice_31_day']) {
      expect(byId(id)?.annualRate, id).toBeCloseTo((market(id).rates.aerPct ?? 0) / 100, 6)
    }
  })

  it('reads the fixed-term ladder as terms rather than one rate', () => {
    const terms = byId('savings.advantage_fixed')?.terms ?? []
    const published = market('savings.advantage_fixed').rates.terms ?? []

    expect(terms.map((term) => term.months)).toEqual([6, 12, 18])
    // Compared loosely: 2.24 / 100 is not 0.0224 in binary, and never will be.
    for (const term of terms) {
      const stated = published.find((candidate) => candidate.months === term.months)
      expect(term.annualRate).toBeCloseTo((stated?.aerPct ?? 0) / 100, 6)
    }
  })

  /**
   * The tier is what stops the engine repeating the mistake that prompted it.
   *
   * MortgageSaver's headline is 2%, and a lump sum above the tier earns 0.5%. Without both
   * numbers travelling together, ranking on the headline puts €32,000 in the worst home on the
   * page.
   */
  it('carries the lump-sum rate from the market record', () => {
    expect(byId('savings.mortgagesaver')?.lumpSumRate).toBeCloseTo(
      (market('savings.mortgagesaver').rates.lumpSumAerPct ?? Number.NaN) / 100,
      6,
    )
  })

  it('carries the tier and the rate above it', () => {
    expect(byId('savings.mortgagesaver')).toMatchObject({
      tierCap: 15000,
      aboveTierRate: 0.005,
      maxLumpSum: 20000,
    })
  })

  it('knows which accounts refuse a lump sum', () => {
    expect(byId('savings.supersaver')?.takesLumpSum).toBe(false)
    expect(byId('savings.advantage_fixed')?.takesMonthly).toBe(false)
  })

  /**
   * A children's account pays 2% and is not a place to put a house deposit. Ranking on rate
   * alone would reach for it, so the exclusion is explicit and asserted.
   */
  it('leaves out the accounts that are not for a goal like this', () => {
    expect(byId('savings.smart_start_money_pot')).toBeUndefined()
    expect(byId('savings.childsave')).toBeUndefined()
    expect(byId('savings.currency_account')).toBeUndefined()
  })

  /**
   * The bonus conditions are the reason €200 is the number. They come from the product page by
   * way of the market record, and must arrive in the engine unchanged.
   */
  it('carries the bonus conditions across from the market record', () => {
    const bonus = market('savings.mortgagesaver').conditions.bonus

    expect(byId('savings.mortgagesaver')?.bonus).toEqual({
      amount: bonus?.amountEur,
      requiresMortgageHere: true,
      minMonthly: bonus?.minMonthlyEur,
      minMonths: bonus?.minMonths,
      minTotal: bonus?.minTotalEur,
      withinMonths: bonus?.withinMonths,
    })
  })
})

describe('a lump sum against the real catalogue', () => {
  /**
   * €10,000 needed in three months: no fixed term fits, so it is between MortgageSaver (2% on
   * monthly saving, the lump-sum rate on this) and the notice account. Before the lump-sum rate
   * was read, MortgageSaver won at a 2% it does not pay on lump sums.
   */
  it('puts it where it earns the most on the rates the site states for lump sums', () => {
    const result = arrange(
      {
        lumpSum: 10000,
        monthly: 500,
        firstTimeBuyer: true,
        mortgageWithThisBank: true,
        monthsToTarget: 3,
      },
      demoSavingsOptions,
    )
    const lump = result?.allocations.find((allocation) => allocation.cadence === 'once')
    const lumpRate = (market('savings.mortgagesaver').rates.lumpSumAerPct ?? 0) / 100
    const noticeRate = (market('savings.notice_31_day').rates.aerPct ?? 0) / 100

    expect(lump?.productId).toBe(
      noticeRate > lumpRate ? 'savings.notice_31_day' : 'savings.mortgagesaver',
    )
    expect(lump?.annualRate).toBeCloseTo(Math.max(noticeRate, lumpRate), 6)
  })
})

describe('case c77e613f, against the real catalogue', () => {
  /**
   * The conversation this was all built from: €32,000 held, €2,500 a month, first-time buyers,
   * mortgage intended here, deposit needed in eight months.
   */
  const situation: SavingsSituation = {
    lumpSum: 32000,
    monthly: 2500,
    firstTimeBuyer: true,
    mortgageWithThisBank: true,
    monthsToTarget: 8,
  }

  it('produces the arrangement the customer had to work out for themselves', () => {
    const result = arrange(situation, demoSavingsOptions)

    expect(
      result?.allocations.map((allocation) => ({
        id: allocation.productId,
        amount: allocation.amount,
        cadence: allocation.cadence,
        termMonths: allocation.termMonths,
      })),
    ).toEqual([
      { id: 'savings.advantage_fixed', amount: 32000, cadence: 'once', termMonths: 6 },
      { id: 'savings.mortgagesaver', amount: 200, cadence: 'monthly', termMonths: null },
      { id: 'savings.supersaver', amount: 2300, cadence: 'monthly', termMonths: null },
    ])

    expect(result?.bonus?.amount).toBe(2000)
    expect(result?.unallocated).toEqual({ lumpSum: 0, monthly: 0 })
  })

  /**
   * What Saoirse actually offered, priced.
   *
   * The whole €32,000 into MortgageSaver earns the above-tier rate on most of it. This is the
   * gap the engine closes, and it is here so that a change to either side of it shows up as a
   * number rather than as a worse conversation.
   */
  it('beats putting the lump sum where Saoirse suggested', () => {
    const arranged = arrange(situation, demoSavingsOptions)
    const asOffered = 15000 * 0.02 + 17000 * 0.005

    expect(arranged?.firstYearInterest).toBeGreaterThan(asOffered)
  })
})
