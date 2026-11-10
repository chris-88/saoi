import { describe, expect, it } from 'vitest'
import {
  buildPlanRequestSchema,
  buildPlanResponseSchema,
  moneyCheckRequestSchema,
} from '../../contracts/market-tools.ts'
import { BUYING_COSTS, LINKED_SAVERS } from '../../market/mortgage-incentives.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { moneyCheck } from './money-check.ts'
import { normaliseMarket } from './normalise.ts'
import { buildPlan } from './plan.ts'
import type { MarketRecord } from './types.ts'

/**
 * Pathways to a home (Chris, 2026-11-10). Three lenders' first-time-buyer rates at 80% to 90%
 * loan-to-value, shaped as CCPC lists them on 2026-11-10: Bank of Ireland (priced by BER, up to
 * 3% cashback), Avant Money (a 30-year fixed with 2% cashback) and AIB (no cashback).
 */

const mortgage = (
  provider: string,
  id: string,
  name: string,
  rates: {
    rateType: 'fixed' | 'variable'
    fixedYears: number | null
    initialRatePct: number
    followOnRatePct: number | null
    ber?: string
  },
  cashback: { field: string; text: string },
): MarketRecord => ({
  product: {
    provider,
    source: 'ccpc',
    productId: id,
    category: 'mortgage',
    providerProductName: name,
    rates: {
      kind: 'mortgage',
      rateType: rates.rateType,
      fixedYears: rates.fixedYears,
      initialRatePct: rates.initialRatePct,
      followOnRatePct: rates.followOnRatePct,
      fullTermRatePct: null,
      ltvMinPct: 80.01,
      ltvMaxPct: 90,
      ber: rates.ber ?? null,
      cashback: null,
      customerTypes: ['first_time_buyer'],
    },
    conditions: {
      details: {
        Cashback: cashback.field,
        'Cashback description': cashback.text,
        'CCPC provider name': provider,
      },
    },
    sourceUrl: 'https://www.ccpc.ie/manage-your-money/buying-a-home/mortgage-comparison-tools',
    providerUrl: null,
    sourceProductId: id,
    attribution: 'Source: Competition and Consumer Protection Commission, www.ccpc.ie',
    unknown: [],
    checkedAt: '2026-11-10T09:00:00.000Z',
    effectiveFrom: null,
  },
  firstSeenAt: '2026-11-10T09:00:00.000Z',
  supersededAt: null,
})

const BOI_CASHBACK = {
  field: 'Up to 3%',
  text: '2% Cashback available on draw down of new mortgage. 1% bonus in 5 years subject to meeting the conditions of the mortgage.',
}
const MORTGAGES: MarketRecord[] = [
  mortgage(
    'boi',
    'mortgage.t1',
    '5 Year Fixed BER C',
    { rateType: 'fixed', fixedYears: 5, initialRatePct: 4, followOnRatePct: 4.15, ber: 'C' },
    BOI_CASHBACK,
  ),
  mortgage(
    'boi',
    'mortgage.t2',
    '5 Year Fixed BER A',
    { rateType: 'fixed', fixedYears: 5, initialRatePct: 3.9, followOnRatePct: 4.15, ber: 'A' },
    BOI_CASHBACK,
  ),
  mortgage(
    'avant_money',
    'mortgage.t3',
    'Up to 30 year fixed >80% <=90%',
    { rateType: 'fixed', fixedYears: 30, initialRatePct: 3.8, followOnRatePct: null },
    { field: '1%', text: '1 percent at drawdown' },
  ),
  mortgage(
    'aib',
    'mortgage.t4',
    '4 year fixed, LTV over 80%',
    { rateType: 'fixed', fixedYears: 4, initialRatePct: 3.75, followOnRatePct: 4.15 },
    { field: 'No', text: 'N/A' },
  ),
]
const market = normaliseMarket([
  ...MARKET_FIXTURE.filter((record) => record.product.category !== 'mortgage'),
  ...MORTGAGES,
])
const AS_OF = '2026-11-10'
const CREATED = '2026-11-10T09:00:00.000Z'
const firstHome = {
  id: 'home',
  kind: 'house_deposit',
  label: 'First home',
  targetDate: '2027-11',
  priority: 1,
}
const plan = (body: Record<string, unknown>) =>
  buildPlan(market, buildPlanRequestSchema.parse(body), AS_OF, CREATED)

describe('the Bank of Ireland route: first-time buyer, €350,000, €35,000 saved', () => {
  const result = plan({
    situation: {
      monthlySaving: 800,
      savings: [{ label: 'Savings', balance: 35_000, aerPct: 1 }],
      firstTimeBuyer: true,
      income: { annualGross: 90_000 },
    },
    goals: [firstHome],
    homePrice: 350_000,
  })
  const home = result.home
  const boi = home?.pathways.find((pathway) => pathway.lender === 'boi')

  it('sizes the home, the loan and the cash needed at the keys, buying costs included', () => {
    expect(home).toMatchObject({
      price: 350_000,
      priceFrom: 'given',
      loan: 315_000,
      ltvPct: 90,
      depositEur: 35_000,
      stampDutyEur: 3_500,
      legalAndSurveyEur: BUYING_COSTS.legalAndSurveyEur,
      helpToBuyEur: 0,
      neededAtKeysEur: 41_500,
    })
    expect(home?.keysOn).toMatch(/^202[67]-\d{2}$/)
    expect(home?.headline).toMatch(/^Your home: keys around /)
    expect(home?.assumptions[0]).toMatch(/^Assumed: first-time buyer; a 30-year mortgage/)
    expect(home?.assumptions[0]).toMatch(/stamp duty of €3,500 \(1%\) and €3,000 for legal fees/)
    expect(() => buildPlanResponseSchema.parse(result)).not.toThrow()
  })

  it('counts BoI’s cashback (2% now, 1% after five years) and the MortgageSaver bonus as cost, not deposit', () => {
    expect(boi?.mortgage.name).toBe('5 Year Fixed BER C')
    expect(boi?.cashbackEur).toBe(9_450)
    expect(boi?.bonusEur).toBe(1_340)
    expect(boi?.confirmed).toBe(true)
    expect(boi?.conditions.join(' ')).toMatch(
      /paid after drawdown, so it lowers the cost rather than the deposit needed/,
    )
    expect(boi?.keysOn).toBe(home?.keysOn)
    expect(boi?.netCostEur).toBeCloseTo((boi?.interestEur ?? 0) - 9_450 - 1_340, 2)
    expect(LINKED_SAVERS['boi']?.[0]?.paid).toBe('after_drawdown')
  })

  it('ranks by cost over the same 30 years, the cheapest at 0, and marks CCPC-only incentives', () => {
    const costs = home?.pathways.map((pathway) => pathway.netCostEur) ?? []
    expect([...costs].sort((a, b) => a - b)).toEqual(costs)
    expect(home?.pathways[0]?.vsCheapestEur).toBe(0)
    expect(home?.comparedOver).toEqual({ basis: 'term', years: 30 })
    const avant = home?.pathways.find((pathway) => pathway.lender === 'avant_money')
    expect(avant?.cashbackEur).toBe(3_150)
    expect(avant?.confirmed).toBe(false)
    expect(avant?.line).toMatch(/not confirmed on the lender’s site/)
  })

  it('leads the presentation with the goal and the pathways, as options', () => {
    expect(result.presentation[0]).toBe(home?.headline)
    expect(result.presentation[1]).toBe(home?.assumptions[0])
    expect(result.presentation[2]).toMatch(
      /^With .*: keys around .*; .* at [\d.]+% \(€[\d,.]+ a month\)/,
    )
    for (const line of result.presentation) {
      expect(line).not.toMatch(/^(Clear|Pay|Take|Choose|Open|Switch|Get)\b/)
    }
  })

  it('takes green rates for a new build (BER A) and adds Help to Buy', () => {
    const built = plan({
      situation: {
        monthlySaving: 800,
        savings: [{ label: 'Savings', balance: 35_000, aerPct: 1 }],
        firstTimeBuyer: true,
      },
      goals: [firstHome],
      homePrice: 350_000,
      propertyKind: 'new_build',
    })
    expect(built.home?.helpToBuyEur).toBe(35_000)
    expect(built.home?.pathways.find((p) => p.lender === 'boi')?.mortgage.name).toBe(
      '5 Year Fixed BER A',
    )
    expect(built.home?.assumptions[0]).toMatch(/a new build, taken as BER A/)
  })
})

describe('when the price or the income is not given', () => {
  it('sizes the home from the savings by the date, and says income is assumed to allow the loan', () => {
    const result = plan({
      situation: {
        monthlySaving: 800,
        savings: [{ label: 'current account', balance: 25_000 }],
      },
      goals: [{ ...firstHome, targetDate: '2028-11' }],
    })
    const home = result.home
    expect(home?.priceFrom).toBe('savings')
    expect(home?.bindingLimit).toBe('income_not_given')
    expect(home?.assumptions[0]).toMatch(/assuming income allows a €[\d,]+ loan/)
    expect(home?.assumptions[0]).toMatch(/no home owned was mentioned/)
    expect(home?.keysOn).toBe('2028-11')
    // The savings by the date cover the deposit and the buying costs.
    expect(home?.neededAtKeysEur).toBeLessThanOrEqual(result.position.towardsGoal + 0.5)
    expect(result.questions.join(' ')).toMatch(/gross income/)
    expect(result.questions.join(' ')).toMatch(/Roughly what price, and is it a new build/)
  })

  it('caps the price by four times income when income binds, and says so', () => {
    const result = plan({
      situation: {
        monthlySaving: 800,
        savings: [{ label: 'current account', balance: 25_000 }],
        income: { annualGross: 50_000 },
      },
      goals: [{ ...firstHome, targetDate: '2028-11' }],
    })
    expect(result.home?.bindingLimit).toBe('income')
    expect(result.home?.loan).toBeLessThanOrEqual(200_000)
    expect(result.home?.assumptions[0]).toMatch(/capped by 4 times income/)
  })

  it('gives money_check the same pathways as build_plan', () => {
    const body = {
      situation: { monthlySaving: 800, savings: [{ label: 'current account', balance: 25_000 }] },
      goals: [{ ...firstHome, targetDate: '2028-11' }],
    }
    expect(
      moneyCheck(market, moneyCheckRequestSchema.parse(body), AS_OF, CREATED).plan?.home,
    ).toEqual(plan(body).home)
  })

  it('has no pathways when the goal is not a home', () => {
    const result = plan({
      situation: { monthlySaving: 800, savings: [{ label: 'Savings', balance: 10_000 }] },
      goals: [{ id: 'car', kind: 'save_for_purchase', label: 'A car', targetDate: '2027-11' }],
    })
    expect(result.home).toBeNull()
  })
})
