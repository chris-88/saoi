import { describe, expect, it } from 'vitest'
import { demoSavingsOptions } from './savings-options.ts'
import { demoKnowledgeBase } from './knowledge-base.ts'
import { arrange, type SavingsSituation } from '../../domain/savings/arrange.ts'

const byId = (id: string) => demoSavingsOptions.find((option) => option.id === id)

describe('translating the pack into something that can be arranged', () => {
  it('carries the rates across as fractions, by whichever shape the pack states them in', () => {
    expect(byId('savings.supersaver')?.annualRate).toBeCloseTo(0.03)
    expect(byId('savings.mortgagesaver')?.annualRate).toBeCloseTo(0.02)
    expect(byId('savings.notice_31_day')?.annualRate).toBeCloseTo(0.01)
  })

  it('reads the fixed-term ladder as terms rather than one rate', () => {
    const terms = byId('savings.advantage_fixed')?.terms ?? []

    expect(terms.map((term) => term.months)).toEqual([6, 12, 18])
    // Compared loosely: 2.24 / 100 is not 0.0224 in binary, and never will be.
    for (const [index, expected] of [0.0151, 0.0215, 0.0224].entries()) {
      expect(terms[index]?.annualRate).toBeCloseTo(expected, 6)
    }
  })

  /**
   * The tier is what stops the engine repeating the mistake that prompted it.
   *
   * MortgageSaver's headline is 2%, and a lump sum above the tier earns 0.5%. Without both
   * numbers travelling together, ranking on the headline puts €32,000 in the worst home on the
   * page.
   */
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
   * The bonus conditions are numbers here and sentences in the pack. They are the reason €200
   * is the number, so they are checked against the prose rather than trusted.
   */
  it('keeps the bonus conditions in step with the pack’s own words', () => {
    const bonus = byId('savings.mortgagesaver')?.bonus
    expect(bonus?.amount).toBe(2000)

    const stated = (
      demoKnowledgeBase.products.find((product) => product.id === 'savings.mortgagesaver')
        ?.pricing_and_rates as { bonus_conditions?: readonly string[] }
    ).bonus_conditions?.join(' | ')

    expect(stated).toMatch(new RegExp(`\\b${String(bonus?.minMonthly)}\\b`))
    expect(stated).toMatch(new RegExp(`\\b${String(bonus?.minMonths)}\\b`))
    expect(stated).toMatch(/5,?000/)
    expect(stated).toMatch(new RegExp(`\\b${String(bonus?.withinMonths)}\\b`))
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
