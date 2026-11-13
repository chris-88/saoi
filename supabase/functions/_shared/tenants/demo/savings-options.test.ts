import { describe, expect, it } from 'vitest'
import { demoSavingsOptions } from './savings-options.ts'
import { ccpcSnapshot } from '../../market/ccpc.snapshot.ts'
import { depositRatesOf } from '../../market/schema.ts'
import { catalogueRecords } from './market.ts'
import { arrange, type SavingsSituation } from '../../domain/savings/arrange.ts'

const byId = (id: string) => demoSavingsOptions.find((option) => option.id === id)

/** The market record behind an option: what the engine's numbers must agree with. */
const records = catalogueRecords(ccpcSnapshot.products)
const market = (id: string) => {
  const record = records.get(id)
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
  it('places no lump sum where CCPC does not state one is taken, or at what rate', () => {
    // CCPC lists MortgageSaver as a regular saver; what a lump sum earns there is not stated.
    expect(market('savings.mortgagesaver').conditions.takesLumpSum).toBeUndefined()
    expect(byId('savings.mortgagesaver')?.takesLumpSum).toBe(false)
    expect(byId('savings.mortgagesaver')?.lumpSumRate).toBeUndefined()
  })

  it('carries the tier and the rate above it, from CCPC’s two balance bands', () => {
    expect(byId('savings.mortgagesaver')).toMatchObject({
      tierCap: 15000,
      aboveTierRate: 0.005,
    })
  })

  it('knows which accounts take no lump sum, or none CCPC states', () => {
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
   * The bonus conditions were the reason €200 was the number, read from Bank of Ireland's page.
   * CCPC states the €2,000 and the mortgage, not the months, the minimum or the window, so since
   * CCPC is the only source (2026-11-13) the engine is handed no bonus: nothing is assumed.
   */
  it('hands the engine no bonus whose conditions CCPC does not state', () => {
    expect(market('savings.mortgagesaver').conditions.bonus).toBeUndefined()
    expect(byId('savings.mortgagesaver')?.bonus).toBeUndefined()
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
    const noticeRate = (market('savings.notice_31_day').rates.aerPct ?? 0) / 100

    // MortgageSaver takes no lump sum CCPC states, so the notice account is where it can go.
    expect(lump?.productId).toBe('savings.notice_31_day')
    expect(lump?.annualRate).toBeCloseTo(noticeRate, 6)
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
      // No €200 into MortgageSaver for its bonus: CCPC does not state the bonus's conditions
      // (2026-11-13), so the monthly money goes where it earns the most.
      { id: 'savings.supersaver', amount: 2500, cadence: 'monthly', termMonths: null },
    ])

    expect(result?.bonus ?? null).toBeNull()
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
