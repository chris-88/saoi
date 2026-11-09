import { describe, expect, it } from 'vitest'
import {
  buildPlanRequestSchema,
  buildPlanResponseSchema,
  reviewRequestSchema,
  reviewResponseSchema,
  type Situation,
} from '../../contracts/market-tools.ts'
import { MARKET_FIXTURE, withoutMocoBankRows } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import { buildPlan } from './plan.ts'
import { review } from './review.ts'

const market = normaliseMarket(MARKET_FIXTURE)
const AS_OF = '2026-11-09'
const car = {
  id: 'car',
  label: 'Car loan',
  kind: 'car_finance' as const,
  balance: 9_000,
  ratePct: 9,
  monthsRemaining: 36,
}
const goal = {
  id: 'deposit',
  kind: 'house_deposit' as const,
  label: 'House deposit',
  targetDate: '2028-11',
  priority: 1,
}
const situation = (aerPct?: number): Situation => ({
  monthlySaving: 800,
  savings: [
    {
      label: 'Current account',
      balance: 25_000,
      access: 'current_account',
      ...(aerPct === undefined ? {} : { aerPct }),
    },
  ],
  debts: [car],
})
const reviewOf = (s: Situation) =>
  review(market, reviewRequestSchema.parse({ situation: s, goals: [goal] }), AS_OF)

describe('money found', () => {
  it('sums its parts, each sourced and dated, and never counts what it does not know', () => {
    const found = reviewOf(situation()).moneyFound
    expect(found.annualEur).toBe(found.parts.reduce((sum, part) => sum + part.annualEur, 0))
    expect(found.parts.map((part) => part.kind)).toEqual(['debt_interest'])
    // The current account's rate was not given: shown, not counted.
    expect(found.notCounted.some((item) => /rate was not given/.test(item.why))).toBe(true)
    for (const part of found.parts) expect(part.checkedAt).not.toBeNull()
    expect(found.headline).toMatch(/^Money found: about €[\d,]+ a year after DIRT/)
    expect(() => reviewResponseSchema.parse(reviewOf(situation()))).not.toThrow()
  })

  it('counts idle cash when its rate is given, against a confirmed rate only', () => {
    // MoCo as CCPC alone lists it: its rate is shown, not counted.
    const ccpcMoco = normaliseMarket(withoutMocoBankRows(MARKET_FIXTURE))
    const request = reviewRequestSchema.parse({ situation: situation(0), goals: [goal] })
    const found = review(ccpcMoco, request, AS_OF).moneyFound
    const idle = found.parts.find((part) => part.kind === 'idle_cash')
    expect(idle).toBeDefined()
    // The money that clears the loan is not counted again as idle.
    expect(idle?.label).toMatch(/€16,000/)
    expect(found.notCounted.some((item) => /CCPC’s one figure/.test(item.why))).toBe(true)
  })

  it('counts MoCo once its own pages confirm the rate', () => {
    const found = reviewOf(situation(0)).moneyFound
    const idle = found.parts.find((part) => part.kind === 'idle_cash')
    expect(idle?.label).toMatch(/MoCo EasySaver/)
    expect(idle?.source).toBe('MoCo’s own site')
    expect(found.notCounted.some((item) => /MoCo/.test(item.label))).toBe(false)
  })

  it('nets the debt interest against what the same money would earn', () => {
    const debt = reviewOf(situation()).moneyFound.parts[0]
    // 9% on a reducing €9,000 for a year, less about 1.1% after DIRT on €9,000.
    expect(debt?.annualEur).toBeGreaterThan(450)
    expect(debt?.annualEur).toBeLessThan(700)
  })

  it('counts a mortgage switch conservatively: no green rate, a band to 90% LTV', () => {
    const found = reviewOf({
      ...situation(),
      debts: [
        {
          id: 'home',
          label: 'Mortgage',
          kind: 'mortgage',
          balance: 250_000,
          ratePct: 4.5,
          monthsRemaining: 300,
        },
      ],
    }).moneyFound
    const sw = found.parts.find((part) => part.kind === 'mortgage_switch')
    expect(sw).toBeDefined()
    expect(sw?.label).not.toMatch(/green/i)
    expect(sw?.detail).toMatch(/Cashback and switching fees are not counted/)
  })

  it('in a plan, uses the plan’s own figures and leaves unconfirmed rates out', () => {
    const result = buildPlan(
      market,
      buildPlanRequestSchema.parse({ situation: situation(0), goals: [goal] }),
      AS_OF,
      '2026-11-09T12:00:00.000Z',
    )
    const debt = result.moneyFound.parts.find((part) => part.kind === 'debt_interest')
    const scenario = result.debtScenarios[0]
    expect(scenario).toBeDefined()
    if (scenario === undefined) return
    expect(debt?.annualEur).toBe(
      Math.round((scenario.cleared.netPosition - scenario.kept.netPosition) / 2),
    )
    for (const product of result.plan.recommendation.products) {
      const counted = result.moneyFound.parts.some((part) =>
        part.label.includes(product.productName),
      )
      if (counted) expect(product.checks.join(' ')).not.toMatch(/not confirmed/)
    }
    expect(() => buildPlanResponseSchema.parse(result)).not.toThrow()
  })
})
