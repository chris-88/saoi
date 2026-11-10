import { describe, expect, it } from 'vitest'
import { cardSchema } from '../contracts/cards.ts'
import { marketPlanSchema, type MarketPlan } from '../contracts/market-plan.ts'
import { exampleMarketPlan } from '../contracts/market-plan.example.ts'
import {
  dayOf,
  factsFromPlan,
  monthOf,
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
  it('lists the steps in the plan’s order and names the first as next', () => {
    const lines = savedPlanDigestLines({ id: PLAN_ID, plan: plan() })
    expect(lines[0]).toBe('Title: House deposit by November 2028')
    expect(lines).toContain(
      'Step 1: Monthly saving, SuperSaver Account with Bank of Ireland, €500 a month. Check first: Paid by direct debit from a Bank of Ireland current account',
    )
    expect(lines.at(-1)).toMatch(
      /^Next: monthly saving with Bank of Ireland \(SuperSaver Account\)/,
    )
  })

  it('falls back to the first debt step when there are no products', () => {
    const base = plan()
    const lines = savedPlanDigestLines({
      id: PLAN_ID,
      plan: { ...base, combination: { products: [] } },
    })
    expect(lines.at(-1)).toMatch(/^Next: Car loan: part paid from the lump sum in this plan\./)
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
