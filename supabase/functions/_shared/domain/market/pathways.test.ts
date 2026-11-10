import { describe, expect, it } from 'vitest'
import {
  buildPlanRequestSchema,
  buildPlanResponseSchema,
  moneyCheckRequestSchema,
} from '../../contracts/market-tools.ts'
import { adviceWordsIn, MORTGAGE_WARNINGS } from '../../market/disclosures.ts'
import { BUYING_COSTS, LINKED_SAVERS } from '../../market/mortgage-incentives.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { moneyCheck } from './money-check.ts'
import { normaliseMarket } from './normalise.ts'
import { minLoanOf } from './normalise.ts'
import { buildPlan } from './plan.ts'
import { homeCalculator } from './home-calculator.ts'
import { marketPlanSchema, SAVE_PLAN_MAX_BYTES } from '../../contracts/market-plan.ts'
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
    expect(home?.headline).toMatch(
      /^At these figures, the deposit and buying costs are in place around /,
    )
    expect(home?.assumptions[0]).toMatch(/^Showing first-time-buyer rates; a 30-year mortgage/)
    expect(home?.assumptions[0]).toMatch(/stamp duty of €3,500 \(1%\) and €3,000 for legal fees/)
    expect(() => buildPlanResponseSchema.parse(result)).not.toThrow()
  })

  it('counts BoI’s cashback (2% now, 1% after five years) and the MortgageSaver bonus as cost, not deposit', () => {
    // At €315,000 the high-value rate (3.2%, no cashback) costs less over the term than the
    // 5-year at 4% with 3% cashback; both are worked out, and the cashback one is next.
    expect(boi?.mortgage.name).toBe('4 Year Fixed HVM BER C')
    expect(boi?.cashbackEur).toBe(0)
    // Every BoI option is shown, one per rate type and fixed period: the 5-year with cashback too.
    expect(home?.pathways.filter((p) => p.lender === 'boi').map((p) => p.mortgage.name)).toContain(
      '5 Year Fixed BER C',
    )
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
    // Over the first 5 years: the 2% at drawdown counts; the 1% at year 5 is listed, not ranked.
    expect(smaller?.cashbackEur).toBe(4_500)
    expect(smaller?.cashbackAfterEur).toBe(2_250)
    expect(smaller?.drivers).toMatch(/\+€2,250 after 5 years if repayments are on time/)
    expect(LINKED_SAVERS['boi']?.[0]?.paid).toBe('after_drawdown')
  })

  it('ranks by cost over the first 5 years, the cheapest at 0, and marks CCPC-only incentives', () => {
    const costs = home?.pathways.map((pathway) => pathway.netCostEur) ?? []
    expect([...costs].sort((a, b) => a - b)).toEqual(costs)
    expect(home?.pathways[0]?.vsCheapestEur).toBe(0)
    expect(home?.comparedOver).toEqual({ basis: 'first_years', years: 5 })
    expect(home?.pathways[1]?.line).toMatch(
      /€[\d,]+ over the first 5 years, €[\d,]+ more than the lowest shown/,
    )
    expect(home?.sortBy).toBe('five_year_cost')
    expect(home?.warnings).toEqual([...MORTGAGE_WARNINGS])
    // Every option, not one pick per lender: more options than lenders, and no cap.
    expect(home?.pathways.length ?? 0).toBeGreaterThan(
      new Set(home?.pathways.map((p) => p.lender)).size,
    )
    for (const pathway of home?.pathways ?? []) {
      // The 30-year figure stays as secondary detail, where follow-on rates are known.
      if (pathway.mortgage.followOnRatePct !== null || pathway.mortgage.fixedYears === 30) {
        expect(pathway.thirtyYearNetEur).not.toBeNull()
      }
    }
    const avant = home?.pathways.find((pathway) => pathway.lender === 'avant_money')
    expect(avant?.cashbackEur).toBe(3_150)
    expect(avant?.confirmed).toBe(false)
    expect(avant?.line).toMatch(/not confirmed on the lender’s site/)
  })

  it('leads the presentation with the goal, three routes and the pathways, as options', () => {
    expect(result.presentation[0]).toBe(home?.headline)
    expect(result.presentation.slice(1, 5)).toEqual([
      ...result.routes.slice(0, 3).map((route) => route.line),
      `More routes: ${String(result.routes.length - 3)}`,
    ])
    expect(result.presentation[5]).toBe(home?.assumptions[0])
    expect(result.presentation[6]).toBe(home?.sortedBy)
    expect(result.presentation[7]).toMatch(
      /^[A-Z][^:]+, (\d+-year fixed|variable): .*; deposit in place around [A-Z][a-z]+ \d{4}; /,
    )
    for (const warning of MORTGAGE_WARNINGS) expect(result.presentation).toContain(warning)
    for (const line of result.presentation) {
      expect(line).not.toMatch(/^(Clear|Pay|Take|Choose|Open|Switch|Get)\b/)
      expect(adviceWordsIn(line)).toEqual([])
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
    expect(boi?.bundle.currentAccount).toBe(
      'None of these products is recorded as needing a current account with the lender.',
    )
    expect(boi?.line).toMatch(/^Bank of Ireland, \d+-year fixed: /)
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
    // Scored on the goal: price, keys months × monthly saving, what is held, cost per €100,000
    // borrowed. Never the absolute cost of a bigger home.
    for (const q of all) {
      expect(q.scoreEur).toBeCloseTo(
        (q.key === 'home_price' ? 0 : q.spread.priceEur) +
          q.spread.keysMonths * 800 +
          q.spread.totalEur +
          q.spread.costPer100kEur,
        1,
      )
      expect(q.why).not.toMatch(/cost of the home/)
    }
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
    expect(early.saveCall.label).toBe('Save this comparison')
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
      label: 'Save this comparison',
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

describe('the first five years', () => {
  const avantOnly = (fixedYears: number, followOnRatePct: number | null) =>
    normaliseMarket([
      ...MARKET_FIXTURE.filter((record) => record.product.category !== 'mortgage'),
      mortgage(
        'aib',
        'mortgage.f1',
        `${String(fixedYears)} year fixed`,
        { rateType: 'fixed', fixedYears, initialRatePct: 3.5, followOnRatePct },
        { field: 'No', text: 'N/A' },
      ),
    ])
  const run = (m: ReturnType<typeof normaliseMarket>) =>
    buildPlan(
      m,
      buildPlanRequestSchema.parse({
        situation: {
          monthlySaving: 800,
          savings: [{ label: 'Savings', balance: 35_000, aerPct: 1 }],
          firstTimeBuyer: true,
          income: { annualGross: 90_000 },
        },
        goals: [firstHome],
        homePrice: 350_000,
      }),
      AS_OF,
      CREATED,
    ).home?.pathways[0]

  it('moves a shorter fix to its follow-on rate for the rest of the five years', () => {
    const twoYear = run(avantOnly(2, 4.5))
    const fiveYear = run(avantOnly(5, 4.5))
    // Same 3.5% start: two years then 4.5% costs more than five years at 3.5%.
    expect(twoYear?.interestEur).toBeGreaterThan(fiveYear?.interestEur ?? Infinity)
    expect(twoYear?.followOnAssumed).toBe(false)
  })

  it('carries the fixed rate on where no follow-on is stated, and says it is unconfirmed', () => {
    const unknown = run(avantOnly(2, null))
    expect(unknown?.followOnAssumed).toBe(true)
    expect(unknown?.confirmed).toBe(false)
    expect(unknown?.conditions.join(' ')).toMatch(
      /no follow-on rate is stated, so the fixed rate is carried on/,
    )
    expect(unknown?.thirtyYearNetEur).toBeNull()
  })
})

describe('the customer sets the filters and the sort (decision 2026-11-10)', () => {
  const body = (homePreferences: Record<string, unknown>) => ({
    situation: {
      monthlySaving: 800,
      savings: [{ label: 'Savings', balance: 35_000, aerPct: 1 }],
      firstTimeBuyer: true,
      income: { annualGross: 90_000 },
    },
    goals: [firstHome],
    homePrice: 350_000,
    homePreferences,
  })

  it('shows only the customer’s bank when they ask to stay, and says so', () => {
    const result = plan(body({ currentBank: 'Bank of Ireland', stayWithBank: true }))
    const lenders = new Set(result.home?.pathways.map((p) => p.lender))
    expect([...lenders]).toEqual(['boi'])
    expect(result.home?.filters).toContain('Showing Bank of Ireland options, as you asked.')
    expect(result.presentation).toContain('Showing Bank of Ireland options, as you asked.')
  })

  it('names the bank without filtering when the customer does not ask to stay', () => {
    const result = plan(body({ currentBank: 'Bank of Ireland' }))
    expect(new Set(result.home?.pathways.map((p) => p.lender)).size).toBeGreaterThan(1)
    expect(result.home?.filters).toEqual([])
  })

  it('keeps fixed rates only when asked, and states the filter', () => {
    const result = plan(body({ rateType: 'fixed' }))
    expect(result.home?.pathways.every((p) => p.mortgage.rateType === 'fixed')).toBe(true)
    expect(result.home?.filters).toContain('Showing fixed rates only, as you asked.')
  })

  it('sorts by the metric the customer picks', () => {
    const monthly = plan(body({ sortBy: 'monthly_repayment' })).home
    const repayments = monthly?.pathways.map((p) => p.mortgage.monthlyRepayment) ?? []
    expect([...repayments].sort((a, b) => a - b)).toEqual(repayments)
    expect(monthly?.sortedBy).toMatch(/sorted by monthly repayment, lowest first/)
    const keys = plan(body({ sortBy: 'keys_date' })).home
    const dates = keys?.pathways.map((p) => p.keysOn ?? '') ?? []
    expect([...dates].sort()).toEqual(dates)
    expect(keys?.sortBy).toBe('keys_date')
  })

  it('returns runners-up beside the worked combination, and no advice words anywhere', () => {
    const result = plan(body({}))
    expect(result.runnersUp.length).toBeGreaterThan(0)
    for (const runnerUp of result.runnersUp) {
      expect(runnerUp.line).toMatch(/^Another split, without /)
      expect(result.presentation).toContain(runnerUp.line)
    }
    expect(result.presentation.join(' ')).toMatch(
      /One worked split, for the most towards the goal by [A-Z][a-z]+ \d{4} \(a fixed term only where it adds enough\): /,
    )
    for (const line of [
      ...result.presentation,
      result.saveCall.label,
      ...(result.home?.pathways.map((p) => p.line) ?? []),
    ]) {
      expect(adviceWordsIn(line)).toEqual([])
    }
    expect(JSON.stringify(result.plan)).not.toMatch(/"recommendation"/)
    expect(result.plan.combination.products.length).toBeGreaterThan(0)
    expect(result.presentation.join(' ')).toMatch(
      /Saoi is not regulated by the Central Bank of Ireland and does not give advice/,
    )
  })
})

describe('routes to a home travel with the plan (decision 2026-11-10-saoi-routes-card)', () => {
  const situation = {
    monthlySaving: 800,
    savings: [{ label: 'Savings', balance: 35_000, aerPct: 1 }],
    firstTimeBuyer: true,
    income: { annualGross: 90_000 },
  }
  const result = plan({
    situation,
    goals: [firstHome],
    homePrice: 350_000,
    propertyKind: 'second_hand',
    county: 'dublin_city',
    monthlyRentEur: 1_800,
  })

  it('works out every route from the figures the home calculator takes', () => {
    const calculator = homeCalculator(
      {
        depositSavedEur: 35_000,
        monthlySavingEur: 800,
        annualGrossIncomeEur: 90_000,
        targetPriceEur: 350_000,
        firstTimeBuyer: true,
        propertyKind: 'second_hand',
        county: 'dublin_city',
      },
      AS_OF,
    )
    expect(result.routes.map((route) => route.id)).toEqual(
      calculator.routes.map((route) => route.id),
    )
    expect(result.routes.map((route) => route.status)).toEqual(
      calculator.routes.map((route) => route.status),
    )
    expect(result.routes[0]?.id).toBe('second_hand')
    expect(() => buildPlanResponseSchema.parse(result)).not.toThrow()
  })

  it('carries them in the plan, which parses and stays inside what a save takes', () => {
    const stored = marketPlanSchema.parse(JSON.parse(JSON.stringify(result.plan)))
    expect(stored.comparison?.routes.map((route) => route.line)).toEqual(
      result.routes.map((route) => route.line),
    )
    expect(stored.comparison?.routes).toHaveLength(6)
    expect(new TextEncoder().encode(JSON.stringify(result.plan)).length).toBeLessThan(
      SAVE_PLAN_MAX_BYTES,
    )
    // Rent changes no figure; it is kept with the plan as what they pay now.
    expect(stored.situation.outgoings?.rentMonthly).toBe(1_800)
  })

  it('names no route best in the presentation', () => {
    for (const line of result.presentation) {
      expect(line).not.toMatch(/\b(best|fastest|recommended)\b/i)
      expect(adviceWordsIn(line)).toEqual([])
    }
  })

  it('has none when the goal is not a home', () => {
    const savings = plan({
      situation,
      goals: [{ id: 'rainy', kind: 'emergency_fund', label: 'Rainy-day money' }],
    })
    expect(savings.routes).toEqual([])
    expect(savings.presentation.join(' ')).not.toMatch(/More routes/)
  })
})
