import { describe, expect, it } from 'vitest'
import { cardSchema } from '../contracts/cards.ts'
import {
  marketPlanSchema,
  upgradeStoredPlan,
  type MarketPlan,
  type PlanRoute,
} from '../contracts/market-plan.ts'
import { exampleMarketPlan } from '../contracts/market-plan.example.ts'
import {
  arrivalMessage,
  arrivedWith,
  dayOf,
  factsFromPlan,
  monthOf,
  planOpening,
  savedPlanCard,
  savedPlanDigestLines,
  shownPlans,
} from './saved-plans.ts'

const PLAN_ID = '99999999-9999-4999-8999-999999999999'
const plan = (): MarketPlan => marketPlanSchema.parse(exampleMarketPlan())

describe('the plan card', () => {
  it('is a valid card, built from the plan alone', () => {
    const card = savedPlanCard({ id: PLAN_ID, plan: plan() })
    expect(cardSchema.parse(card)).toEqual(card)
    if (card.type !== 'saved_plan') throw new Error('wrong card')

    expect(card.title).toBe('House deposit by November 2028')
    expect(card.goals).toEqual([
      { label: 'House deposit', target: '€35,000 by November 2028' },
      { label: 'Rainy-day money', target: '€5,000' },
    ])
    expect(card.products.map((product) => product.role)).toEqual([
      'Monthly saving',
      'Monthly saving',
      'Lump sum',
      'Emergency fund',
    ])
    expect(card.products[0]).toMatchObject({
      name: 'SuperSaver Account',
      amounts: ['€500 a month'],
      rate: '3.00% AER',
      projected: '€12,189 after 24 months, €189 interest after DIRT',
      provenance: 'Bank of Ireland’s own site, checked 9 Nov 2026',
    })
    expect(card.products[1]?.provenance).toBe('CCPC, checked 9 Nov 2026')
    expect(card.products[1]?.unknowns).toEqual(['Monthly maximum', 'Rate after the first year'])
    expect(card.debts).toEqual([
      'Car loan: part paid from the lump sum in this plan. At 9% it costs more than any savings account pays, so €5,000 of the €25,000 goes to it now. Costs €1,276 as it is, €551 this way.',
    ])
    // CCPC's attribution travels once, however many products came from it.
    expect(card.attributions).toEqual([
      'Source: Competition and Consumer Protection Commission, www.ccpc.ie',
    ])
  })

  it('says borrowing in borrowing terms', () => {
    const base = plan()
    const product = base.combination.products[0]
    if (product === undefined) throw new Error('no product')
    const card = savedPlanCard({
      id: PLAN_ID,
      plan: {
        ...base,
        combination: {
          products: [
            {
              ...product,
              role: 'refinance',
              category: 'loan',
              monthlyAmount: 210,
              amount: 9_000,
              ratePct: 6.9,
              projected: { horizonMonths: 48, monthlyRepayment: 215, totalCost: 10_320 },
            },
          ],
        },
      },
    })
    if (card.type !== 'saved_plan') throw new Error('wrong card')
    expect(card.products[0]).toMatchObject({
      role: 'Refinance',
      amounts: ['€210 a month repaid', '€9,000 borrowed'],
      rate: '6.90% APR',
      projected: '€215 a month, €10,320 total cost over 48 months',
    })
  })
})

describe('what the model is told', () => {
  it('lists the steps in the plan’s order and offers a choice, never a pick, as next', () => {
    const lines = savedPlanDigestLines({ id: PLAN_ID, plan: plan() })
    expect(lines[0]).toBe('Title: House deposit by November 2028')
    expect(lines).toContain(
      'Step 1: Monthly saving, SuperSaver Account with Bank of Ireland, €500 a month. Check first: Paid by direct debit from a Bank of Ireland current account',
    )
    expect(lines.at(-1)).toMatch(/^Next: offer them a choice, never a pick: /)
    expect(lines.at(-1)).not.toMatch(/SuperSaver/)
  })

  it('carries a home comparison: the count, the order and the first three options', () => {
    const base = plan()
    const option = {
      lender: 'Bank of Ireland',
      kind: '4-year fixed',
      productName: '4 Year Fixed HVM BER C',
      ratePct: 3.2,
      monthlyEur: 1362.27,
      fiveYearCostEur: 49338.1,
      keysOn: '2028-07',
      confirmed: true,
      conditions: ['4 Year Fixed HVM BER C is for loans of €250,000 or more.'],
    }
    const claimed = {
      id: PLAN_ID,
      plan: {
        ...base,
        comparison: {
          kind: 'home' as const,
          headline: 'At these figures, the deposit and buying costs are in place around July 2028.',
          priceEur: 350_000,
          sortBy: 'five_year_cost' as const,
          sortedBy: '4 options that fit, sorted by cost over the first 5 years, lowest first.',
          filters: ['Showing Bank of Ireland options, as you asked.'],
          options: [option, option, option, option],
          routes: [],
        },
      },
    }
    const lines = savedPlanDigestLines(claimed)
    expect(lines.join('\n')).toMatch(/Home comparison: 4 mortgage options for a €350,000 home/)
    // Every option is in the digest, so a follow-up about any of them can be answered.
    expect(lines.filter((line) => line.startsWith('Option '))).toHaveLength(4)
    expect(lines.join('\n')).toMatch(
      /Conditions: 4 Year Fixed HVM BER C is for loans of €250,000 or more\./,
    )
    const card = savedPlanCard(claimed)
    expect(card.type === 'saved_plan' && card.comparison?.total).toBe(4)
    expect(card.type === 'saved_plan' && card.comparison?.options[0]?.monthly).toBe('€1,362/mo')
    expect(card.type === 'saved_plan' && card.comparison?.options[0]?.lead).toBe('€49,338 / 5 yrs')
    expect(card.type === 'saved_plan' && card.comparison?.options).toHaveLength(3)
    expect(card.type === 'saved_plan' && card.figures).toMatch(/ · €350k$/)
  })

  it('falls back to the first debt step when there are no products', () => {
    const base = plan()
    const lines = savedPlanDigestLines({
      id: PLAN_ID,
      plan: { ...base, combination: { products: [] } },
    })
    expect(lines.at(-1)).toMatch(/The debt step in it: Car loan: part paid from the lump sum/)
  })
})

describe('the facts a plan states', () => {
  it('maps the situation onto catalogue keys, and nothing it cannot map cleanly', () => {
    const facts = Object.fromEntries(factsFromPlan(plan()).map((fact) => [fact.key, fact]))
    expect(Object.keys(facts).sort()).toEqual(
      [
        'assets.savingsBalance',
        'expenditure.monthlyOther',
        'expenditure.monthlyRent',
        'goals.monthlySaving',
        'goals.primaryObjective',
        'goals.savingsTarget',
        'goals.targetDate',
        'income.netMonthly',
        'liabilities.monthlyLoanRepayments',
      ].sort(),
    )
    expect(facts['income.netMonthly']).toEqual({
      key: 'income.netMonthly',
      subject: 'primary',
      value: 3_900,
    })
    expect(facts['assets.savingsBalance']?.value).toBe(25_000)
    expect(facts['goals.primaryObjective']?.value).toBe('House deposit')
    expect(facts['goals.targetDate']?.value).toBe('2028-11')
  })

  it('never records gross income as basic salary', () => {
    const base = plan()
    const facts = factsFromPlan({
      ...base,
      situation: { ...base.situation, income: { annualGross: 72_000 } },
    })
    expect(facts.map((fact) => fact.key)).not.toContain('income.annualBasic')
  })

  it('leaves loan repayments out unless every loan states one', () => {
    const base = plan()
    const facts = factsFromPlan({
      ...base,
      situation: {
        ...base.situation,
        debts: [
          ...base.situation.debts,
          { id: 'loan-2', label: 'Credit union loan', kind: 'personal_loan', balance: 2_000 },
        ],
      },
    })
    expect(facts.map((fact) => fact.key)).not.toContain('liabilities.monthlyLoanRepayments')
  })

  it('sums credit card balances and takes the target only for a saving goal', () => {
    const base = plan()
    const facts = factsFromPlan({
      ...base,
      goals: [{ id: 'debt', kind: 'pay_off_debt', label: 'Clear the cards', targetAmount: 3_000 }],
      situation: {
        ...base.situation,
        debts: [
          { id: 'a', label: 'Visa', kind: 'credit_card', balance: 1_200.4 },
          { id: 'b', label: 'Mastercard', kind: 'credit_card', balance: 800 },
        ],
      },
      debts: [],
    })
    const keys = facts.map((fact) => fact.key)
    expect(keys).not.toContain('goals.savingsTarget')
    expect(facts.find((fact) => fact.key === 'liabilities.creditCardBalance')?.value).toBe(2_000)
  })
})

describe('which plans have been shown', () => {
  it('reads plan ids from persisted cards and passes over anything else', () => {
    expect(
      shownPlans([
        { cards: [{ type: 'saved_plan', planId: PLAN_ID }, { type: 'status' }] },
        { cards: 'not an array' },
        { cards: [{ type: 'saved_plan' }] },
      ]),
    ).toEqual(new Set([PLAN_ID]))
  })
})

describe('dates', () => {
  it('reads months and days for people', () => {
    expect(monthOf('2028-06')).toBe('June 2028')
    expect(monthOf('2028-06-30')).toBe('June 2028')
    expect(monthOf('nonsense')).toBe('nonsense')
    expect(dayOf('2026-11-09T23:30:00Z')).toBe('9 Nov 2026')
  })
})

const route = (id: PlanRoute['id'], line: string): PlanRoute => ({
  id,
  name: id,
  mechanism: 'How it helps.',
  status: 'potential',
  line,
  reason: null,
  missing: null,
  keysOn: id === 'second_hand' ? '2028-07' : null,
  conditions: ['A condition.'],
  confirmed: true,
  sources: [{ fact: 'A rule.', url: 'https://www.example.ie/rule', checkedOn: '2026-11-10' }],
})

const ROUTES: PlanRoute[] = [
  route('second_hand', 'Second-hand: deposit and costs saved around July 2028'),
  route('new_build_help_to_buy', 'New build with Help to Buy: up to €35,000 towards the deposit'),
  route('first_home_scheme', 'First Home Scheme: shared equity on a new build, under the limit'),
  route('local_authority_home_loan', 'Local Authority Home Loan: income over the limit'),
  route('affordable_purchase', 'Affordable purchase: depends on the council'),
]

const homePlan = (routes: PlanRoute[] | undefined): unknown => {
  const base = plan()
  return {
    ...base,
    comparison: {
      kind: 'home',
      headline: 'At these figures, the deposit and buying costs are in place around July 2028.',
      priceEur: 350_000,
      sortBy: 'five_year_cost',
      sortedBy: '1 option that fits.',
      filters: [],
      options: [
        {
          lender: 'Bank of Ireland',
          kind: '4-year fixed',
          productName: '4 Year Fixed HVM BER C',
          ratePct: 3.2,
          monthlyEur: 1362.27,
          fiveYearCostEur: 49338.1,
          keysOn: '2028-07',
          confirmed: true,
          conditions: [],
        },
      ],
      ...(routes === undefined ? {} : { routes }),
    },
  }
}

describe('routes to a home on a saved plan', () => {
  it('reach the card in their order', () => {
    const card = savedPlanCard({ id: PLAN_ID, plan: marketPlanSchema.parse(homePlan(ROUTES)) })
    expect(cardSchema.parse(card)).toEqual(card)
    expect(card.type === 'saved_plan' && card.routes).toEqual(ROUTES)
  })

  it('give the model three lines and the count, as facts, never a pick', () => {
    const lines = savedPlanDigestLines({
      id: PLAN_ID,
      plan: marketPlanSchema.parse(homePlan(ROUTES)),
    })
    const at = lines.findIndex((line) => line.startsWith('Routes to a home: 5'))
    expect(at).toBeGreaterThan(-1)
    expect(lines[at]).toMatch(/none is best, fastest or recommended/)
    expect(lines.slice(at + 1, at + 5)).toEqual([
      'Route: Second-hand: deposit and costs saved around July 2028',
      'Route: New build with Help to Buy: up to €35,000 towards the deposit',
      'Route: First Home Scheme: shared equity on a new build, under the limit',
      'More routes: 2',
    ])
  })

  it('load as none from a plan stored before routes', () => {
    const old = homePlan(undefined)
    expect(marketPlanSchema.safeParse(upgradeStoredPlan(old)).success).toBe(true)
    const parsed = marketPlanSchema.parse(upgradeStoredPlan(old))
    expect(parsed.comparison?.routes).toEqual([])
    const card = savedPlanCard({ id: PLAN_ID, plan: parsed })
    expect(card.type === 'saved_plan' && card.routes).toEqual([])
    expect(savedPlanDigestLines({ id: PLAN_ID, plan: parsed }).join('\n')).not.toMatch(
      /Routes to a home/,
    )
  })

  it('upgrades an old plan that still says recommendation and has no routes', () => {
    const { combination, ...rest } = plan()
    const old = { ...rest, recommendation: combination, comparison: undefined }
    const parsed = marketPlanSchema.parse(upgradeStoredPlan(old))
    expect(parsed.combination).toEqual(combination)
    expect(parsed.comparison).toBeUndefined()
  })
})

describe('the arrival message (2026-11-12)', () => {
  const arrival = {
    keysOn: null,
    readyLine: 'Not reached at this pace',
    readyNote: null,
    factParts: ['€40,000 deposit', '+ €4,000 stamp duty', '+ €3,000 legal and survey'],
    progress: null,
    tiles: [{ label: 'Savings', value: 'up to 3.11%', lines: ['17 accounts'] }],
    assumptions: ['Rent not given'],
    hookQuestion: {
      key: 'home_price',
      question: 'Roughly what price, or which area?',
      why: 'The price sets the keys date and the loan.',
    },
  }
  const withArrival = (): MarketPlan => marketPlanSchema.parse({ ...exampleMarketPlan(), arrival })

  it('is the plan card, carrying the arrival, with the hook question and what it moves as text', () => {
    const message = arrivalMessage({ id: PLAN_ID, plan: withArrival() })
    expect(message.content).toBe(
      'Roughly what price, or which area? The price sets the keys date and the loan.',
    )
    expect(message.content).toBe(planOpening(withArrival()))
    expect(message.cards).toHaveLength(1)
    const card = cardSchema.parse(message.cards[0])
    expect(card.type === 'saved_plan' && card.arrival).toEqual(arrival)
  })

  it('is found in the transcript by its card and its words, and nothing else', () => {
    const claimed = { id: PLAN_ID, plan: withArrival() }
    const opening = planOpening(claimed.plan)
    expect(
      arrivedWith(claimed, [{ role: 'assistant', content: opening, cards: ['saved_plan'] }]),
    ).toBe(true)
    expect(arrivedWith(claimed, [{ role: 'assistant', content: opening, cards: [] }])).toBe(false)
    expect(
      arrivedWith(claimed, [
        {
          role: 'assistant',
          content: 'Here it is. Where would you like to start?',
          cards: ['saved_plan'],
        },
      ]),
    ).toBe(false)
  })

  it('leaves the card without an arrival for a plan saved before it', () => {
    const card = savedPlanCard({ id: PLAN_ID, plan: plan() })
    expect(card.type === 'saved_plan' && card.arrival).toBeUndefined()
  })
})
