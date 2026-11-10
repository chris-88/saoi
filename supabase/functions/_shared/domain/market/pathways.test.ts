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
import { minLoanOf } from './normalise.ts'
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
  prose?: string,
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
      ...(prose === undefined ? {} : { prose: { 'Additional information': prose } }),
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
  // A high-value rate as CCPC states it: 4 years at 3.2%, no cashback, €250,000 or more.
  mortgage(
    'boi',
    'mortgage.t5',
    '4 Year Fixed HVM BER C',
    { rateType: 'fixed', fixedYears: 4, initialRatePct: 3.2, followOnRatePct: 4.15, ber: 'C' },
    {
      field: 'No',
      text: 'The High Value Mortgage fixed interest rates do not include Cashback',
    },
    'The High Value Mortgage fixed interest rates do not include Cashback. The High Value Mortgage fixed interest rates are available to you if you are buying or building a property to live in as your home or are switching your home mortgage loan to the Bank of Ireland Group from another mortgage lender, AND you are borrowing €250,000 or more.',
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
    // At €315,000 the high-value rate (3.2%, no cashback) costs less over the term than the
    // 5-year at 4% with 3% cashback; both are worked out, and the cashback one is next.
    expect(boi?.mortgage.name).toBe('4 Year Fixed HVM BER C')
    expect(boi?.cashbackEur).toBe(0)
    expect(boi?.considered[1]?.name).toBe('5 Year Fixed BER C')
    expect(boi?.bonusEur).toBe(1_340)
    expect(boi?.conditions.join(' ')).toMatch(/for loans of €250,000 or more/)
    expect(boi?.confirmed).toBe(true)
    expect(boi?.conditions.join(' ')).toMatch(
      /paid after drawdown, so it lowers the cost rather than the deposit needed/,
    )
    expect(boi?.keysOn).toBe(home?.keysOn)
    expect(boi?.netCostEur).toBeCloseTo((boi?.interestEur ?? 0) - 1_340, 2)
    // Below €250,000 the high-value rate is out, and the cashback counts: 2% now and 1% at year 5.
    const smaller = plan({
      situation: {
        monthlySaving: 800,
        savings: [{ label: 'Savings', balance: 35_000, aerPct: 1 }],
        firstTimeBuyer: true,
        income: { annualGross: 90_000 },
      },
      goals: [firstHome],
      homePrice: 250_000,
    }).home?.pathways.find((pathway) => pathway.lender === 'boi')
    expect(smaller?.mortgage.name).toBe('5 Year Fixed BER C')
    expect(smaller?.cashbackEur).toBe(6_750)
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
    expect(result.presentation[2]).toMatch(/^The .* path: .*; keys around [A-Z][a-z]+ \d{4}; /)
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
    expect(result.nextQuestion?.key).toBeDefined()
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

describe('a pathway is a bundle with that lender', () => {
  it('lists the linked saver, the mortgage and the cashback, and leaves the current account where it is', () => {
    const result = plan({
      situation: {
        monthlySaving: 800,
        savings: [{ label: 'Savings', balance: 35_000, aerPct: 1 }],
        firstTimeBuyer: true,
        income: { annualGross: 90_000 },
      },
      goals: [firstHome],
      homePrice: 250_000,
    })
    const boi = result.home?.pathways.find((pathway) => pathway.lender === 'boi')
    expect(boi?.bundle.products.map((product) => product.role)).toEqual(
      expect.arrayContaining(['linked_saver', 'mortgage', 'cashback']),
    )
    expect(boi?.bundle.products.find((p) => p.role === 'cashback')?.detail).toBe(
      '2% at drawdown and 1% after 5 years',
    )
    expect(boi?.bundle.currentAccount).toBe('Your current account can stay where it is.')
    expect(boi?.line).toMatch(/^The Bank of Ireland path: MortgageSaver \(/)
    expect(boi?.line).not.toMatch(/bank with/i)
  })
})

describe('the next question is the one that moves the plan most', () => {
  const unanswered = plan({
    situation: {
      monthlySaving: 800,
      savings: [{ label: 'current account', balance: 25_000 }],
      debts: [
        { id: 'car-loan', kind: 'car_finance', label: 'car loan', balance: 9_000, ratePct: 9 },
      ],
    },
    goals: [{ ...firstHome, targetDate: '2028-11' }],
  })

  it('ranks every unanswered input by the spread its answers make, largest first', () => {
    const all = [unanswered.nextQuestion, ...unanswered.laterQuestions].flatMap((q) =>
      q === null ? [] : [q],
    )
    expect(all.map((q) => q.key).sort()).toEqual(
      ['current_account_bank', 'debt_repayment', 'home_price', 'income', 'property_kind'].sort(),
    )
    const scores = all.map((q) => q.scoreEur)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    expect(unanswered.nextQuestion?.scoreEur).toBeGreaterThan(0)
    expect(all.find((q) => q.key === 'current_account_bank')?.scoreEur).toBe(0)
    expect(all.find((q) => q.key === 'income')?.why).toMatch(
      /moves the price that can be bought by up to €[\d,]+/,
    )
  })

  it('ends the presentation with that one question only', () => {
    expect(unanswered.presentation.at(-1)).toBe(
      `Answer this one and the plan gets sharper: ${unanswered.nextQuestion?.question ?? ''} ${unanswered.nextQuestion?.why ?? ''}`,
    )
    expect(unanswered.presentation.join(' ')).not.toMatch(/To sharpen this/)
  })

  it('asks nothing about what was answered', () => {
    const answered = plan({
      situation: {
        monthlySaving: 800,
        savings: [{ label: 'current account', balance: 25_000 }],
        income: { annualGross: 70_000 },
        firstTimeBuyer: true,
      },
      goals: [{ ...firstHome, targetDate: '2028-11' }],
      propertyKind: 'second_hand',
      homePrice: 300_000,
    })
    const keys = [answered.nextQuestion, ...answered.laterQuestions].map((q) => q?.key)
    expect(keys).not.toContain('income')
    expect(keys).not.toContain('property_kind')
    expect(keys).not.toContain('home_price')
  })
})

describe('the save wording grows with the plan', () => {
  it('says "Save this plan" while key inputs are assumed, and counts what was answered', () => {
    const early = plan({
      situation: { monthlySaving: 800, savings: [{ label: 'current account', balance: 25_000 }] },
      goals: [{ ...firstHome, targetDate: '2028-11' }],
    })
    expect(early.saveCall.ready).toBe(false)
    expect(early.saveCall.label).toBe('Save this plan')
    expect(early.completeness.assumed).toEqual(
      expect.arrayContaining(['gross income', 'new build or second-hand', 'first-time buyer']),
    )
    expect(early.completeness.line).toMatch(/^Plan based on \d of \d answers\.$/)
  })

  it('invites saving once income and the kind of home are known, and marks unbuilt features as coming', () => {
    const ready = plan({
      situation: {
        monthlySaving: 800,
        savings: [{ label: 'current account', balance: 25_000 }],
        income: { annualGross: 70_000 },
      },
      goals: [{ ...firstHome, targetDate: '2028-11' }],
      propertyKind: 'second_hand',
    })
    expect(ready.saveCall).toMatchObject({
      ready: true,
      label: 'Ready to make this plan happen? Save it to Saoi',
    })
    expect(ready.saveCall.coming).toEqual(
      expect.arrayContaining([
        'a partner joining the plan',
        'application checklists',
        'a document store',
      ]),
    )
    expect(ready.saveCall.appToday.join(' ')).not.toMatch(/partner|reminder|checklist|document/)
  })
})

describe('high-value rates and the per-lender pick (after Chris spotted BoI at 3.1%)', () => {
  const body = (homePrice: number) => ({
    situation: {
      monthlySaving: 800,
      savings: [{ label: 'Savings', balance: 35_000, aerPct: 1 }],
      firstTimeBuyer: true,
      income: { annualGross: 120_000 },
    },
    goals: [firstHome],
    homePrice,
  })

  it('reads the minimum loan from the source’s words', () => {
    expect(minLoanOf('AND you are borrowing €250,000 or more. See www.bankofireland.com')).toBe(
      250_000,
    )
    expect(minLoanOf('for loans of €300,000+ only')).toBe(300_000)
    expect(minLoanOf('€5,000 cashback when you draw down €250,000+')).toBeNull()
  })

  it('weighs the high-value rate against the cashback rates when the loan qualifies, and drops it when not', () => {
    const big = plan(body(350_000)).home?.pathways.find((p) => p.lender === 'boi')
    expect(big?.considered.map((option) => option.name)).toContain('4 Year Fixed HVM BER C')
    expect(big?.lowestRatePct).toBe(3.2)
    const small = plan(body(250_000)).home?.pathways.find((p) => p.lender === 'boi')
    // €225,000 is below the €250,000 the high-value rate needs.
    expect(small?.considered.map((option) => option.name)).not.toContain('4 Year Fixed HVM BER C')
  })

  it('picks, for every lender, the product no other of its eligible products beats on net cost', () => {
    for (const price of [250_000, 350_000]) {
      for (const pathway of plan(body(price)).home?.pathways ?? []) {
        expect(pathway.considered[0]?.productId).toBe(pathway.mortgage.productId)
        for (const option of pathway.considered) {
          expect(option.netCostEur).toBeGreaterThanOrEqual(pathway.netCostEur - 0.01)
        }
      }
    }
  })
})
