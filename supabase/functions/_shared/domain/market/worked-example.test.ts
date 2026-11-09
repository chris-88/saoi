import { describe, expect, it } from 'vitest'
import { marketPlanSchema } from '../../contracts/market-plan.ts'
import {
  buildPlanRequestSchema,
  buildPlanResponseSchema,
  debtResponseSchema,
  mortgageResponseSchema,
  reviewResponseSchema,
  type Situation,
} from '../../contracts/market-tools.ts'
import { debts } from './debt.ts'
import { euro } from './figures.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { affordability, switchMortgage } from './mortgage.ts'
import { normaliseMarket } from './normalise.ts'
import { buildPlan } from './plan.ts'
import { review } from './review.ts'

/**
 * The design note's worked example: "€25k in my current account, I can save €800 a month,
 * house deposit in two years, a car loan at 9%". Figures the customer did not give (the loan's
 * balance and repayment, income, outgoings, the deposit target) are the plan contract example's.
 */

const market = normaliseMarket(MARKET_FIXTURE)
const AS_OF = '2026-11-09'
const CREATED = '2026-11-09T12:30:00.000Z'

const situation: Situation = {
  income: { annualGross: 62_000, netMonthly: 3_900 },
  outgoings: { rentMonthly: 1_650, otherMonthly: 900 },
  monthlySaving: 800,
  savings: [{ label: 'Current account', balance: 25_000, aerPct: 0, access: 'current_account' }],
  debts: [
    {
      id: 'car-loan',
      label: 'Car loan',
      kind: 'car_finance',
      balance: 9_000,
      ratePct: 9,
      monthlyRepayment: 280,
      monthsRemaining: 36,
    },
  ],
  firstTimeBuyer: true,
}
const deposit = {
  id: 'deposit',
  kind: 'house_deposit' as const,
  label: 'House deposit',
  targetAmount: 35_000,
  targetDate: '2028-11',
  priority: 1,
}

/** Nothing the API returns tells anyone what to do. */
const noAdvice = (value: unknown) => {
  const text = JSON.stringify(value).toLowerCase()
  expect(text).not.toMatch(/you should|we recommend|you must|our advice/)
}

describe('worked example: review_situation', () => {
  const result = review(market, { situation, goals: [deposit] }, AS_OF)

  it('finds the idle €25,000, the 9% loan, and no emergency fund beyond the current account', () => {
    const kinds = result.findings.map((finding) => finding.kind)
    expect(kinds).toContain('idle_money')
    expect(kinds).toContain('debt_costs_more_than_savings_earn')
    const idle = result.findings.find((finding) => finding.kind === 'idle_money')
    expect(idle?.figures['earnsNow']).toBe(0)
    expect(idle?.figures['couldEarnInstantAccess']).toBeGreaterThan(300)
    const loan = result.findings.find(
      (finding) => finding.kind === 'debt_costs_more_than_savings_earn',
    )
    expect(loan?.figures['annualInterest']).toBe(810)
    expect(loan?.figures['interestRemaining']).toBeGreaterThan(0)
  })

  it('suggests goals and passes its contract', () => {
    expect(result.candidateGoals.map((goal) => goal.kind)).toEqual(
      expect.arrayContaining(['pay_off_debt', 'grow_savings']),
    )
    expect(() => reviewResponseSchema.parse(result)).not.toThrow()
    expect(result.next).toMatch(/saoi_build_plan/)
    expect(result.next).toMatch(/24 hours/)
    noAdvice(result)
  })
})

describe('worked example: mortgage affordability', () => {
  it('applies the Central Bank limits to a first-time buyer', () => {
    const result = affordability(market, {
      mode: 'affordability',
      buyer: 'first_time_buyer',
      annualGrossIncome: 62_000,
      deposit: 45_000,
    })
    expect(result.maxLoanByIncome).toBe(248_000)
    expect(result.maxPriceByDeposit).toBe(450_000)
    expect(result.maxPrice).toBe(293_000)
    expect(result.bindingLimit).toBe('income')
    expect(result.limits).toMatchObject({ loanToIncome: 4, maxLtvPct: 90 })
    expect(result.options.length).toBeGreaterThan(0)
    expect(() => mortgageResponseSchema.parse(result)).not.toThrow()
    noAdvice(result)
  })

  it('applies 3.5 times income to second and subsequent buyers, and sizes a deposit for a price', () => {
    const result = affordability(market, {
      mode: 'affordability',
      buyer: 'second_and_subsequent',
      annualGrossIncome: 100_000,
      deposit: 30_000,
      propertyValue: 400_000,
    })
    expect(result.maxLoanByIncome).toBe(350_000)
    expect(result.forProperty).toMatchObject({
      depositNeeded: 40_000,
      depositShortfall: 10_000,
      loanNeeded: 370_000,
      withinIncomeLimit: false,
    })
  })
})

describe('mortgage switch', () => {
  it('works out the monthly and lifetime saving, cashback and break-even', () => {
    const result = switchMortgage(market, {
      mode: 'switch',
      balance: 250_000,
      currentRatePct: 4.5,
      remainingTermYears: 25,
      propertyValue: 400_000,
      switchingCostsEur: 1_500,
    })
    expect(result.current.monthlyRepayment).toBeGreaterThan(1_300)
    expect(result.ltvPct).toBe(62.5)
    const first = result.options[0]
    expect(first).toBeDefined()
    if (first === undefined) return
    expect(first.product.terms.kind === 'mortgage' && first.product.terms.buyerTypes).toContain(
      'switcher',
    )
    expect(first.monthlySaving).toBeCloseTo(
      result.current.monthlyRepayment - first.figures.monthlyRepayment,
      1,
    )
    if (first.monthlySaving > 0) expect(first.breakEvenMonths).not.toBeNull()
    const savings = result.options.map((option) => option.lifetimeSaving ?? -Infinity)
    expect([...savings].sort((a, b) => b - a)).toEqual(savings)
    expect(() => mortgageResponseSchema.parse(result)).not.toThrow()
  })
})

describe('worked example: debt', () => {
  const result = debts(
    market,
    {
      debts: [
        ...situation.debts,
        {
          id: 'card',
          label: 'Credit card',
          kind: 'credit_card',
          balance: 2_000,
          ratePct: 22.9,
          monthlyRepayment: 100,
        },
      ],
      extraMonthly: 200,
      lumpSum: 9_000,
    },
    AS_OF,
  )

  it('costs each debt and orders them highest rate first', () => {
    expect(result.payoffOrder.map((step) => step.debtId)).toEqual(['card', 'car-loan'])
    const car = result.costs.find((cost) => cost.debtId === 'car-loan')
    expect(car?.monthsToClear).toBeGreaterThan(30)
    expect(car?.monthsToClear).toBeLessThanOrEqual(37)
    expect(car?.interestRemaining).toBeGreaterThan(900)
    expect(car?.interestRemaining).toBeLessThan(1_300)
  })

  it('sets overpaying against saving, and lists market refinance rates', () => {
    expect(result.overpayVersusSave.length).toBe(2)
    for (const comparison of result.overpayVersusSave) {
      expect(comparison.interestSavedByOverpaying).toBeGreaterThan(0)
      expect(comparison.difference).toBeCloseTo(
        comparison.interestSavedByOverpaying - comparison.netInterestBySaving,
        1,
      )
    }
    const car = result.refinance.find((item) => item.debtId === 'car-loan')
    expect(car?.options.length).toBeGreaterThan(0)
    expect(() => debtResponseSchema.parse(result)).not.toThrow()
    noAdvice(result)
  })
})

describe('worked example: build_plan', () => {
  const request = buildPlanRequestSchema.parse({ situation, goals: [deposit] })
  const result = buildPlan(market, request, AS_OF, CREATED)

  it('returns a plan that the plan contract accepts', () => {
    expect(() => marketPlanSchema.parse(result.plan)).not.toThrow()
    expect(() => buildPlanResponseSchema.parse(result)).not.toThrow()
    expect(result.plan.title).toBe('House deposit by November 2028')
    expect(result.horizonMonths).toBe(24)
  })

  it('works the car loan out both ways and takes the larger net position', () => {
    const scenario = result.debtScenarios.find((s) => s.debtId === 'car-loan')
    expect(scenario).toBeDefined()
    if (scenario === undefined) return
    expect(scenario.amount).toBe(9_000)
    const better = scenario.chosen === 'cleared' ? scenario.cleared : scenario.kept
    const other = scenario.chosen === 'cleared' ? scenario.kept : scenario.cleared
    expect(better.netPosition).toBeGreaterThanOrEqual(other.netPosition)
    // At 9% against savings rates of 2% to 3.5%, clearing it leaves more.
    expect(scenario.chosen).toBe('cleared')
    const step = result.plan.debts.find((s) => s.debtId === 'car-loan')
    expect(step?.action).toBe('pay_off_first')
    expect(step?.costIfKept).toBeGreaterThan(0)
    expect(step?.costWithStep).toBe(0)
  })

  it('places what is left within the caps, and saves the freed repayment', () => {
    const totals = result.plan.recommendation.totals
    expect(totals?.lumpSum).toBeCloseTo(16_000, 0)
    expect(totals?.monthly).toBeCloseTo(1_080, 0)
    expect(result.plan.recommendation.products.length).toBeLessThanOrEqual(5)
    for (const product of result.plan.recommendation.products) {
      expect(product.goalIds).toEqual(['deposit'])
      expect(product.checks.length).toBeGreaterThan(0)
    }
    expect(result.unplaced).toEqual({ lumpSum: 0, monthly: 0 })
  })

  it('says when the deposit is reached and what it supports', () => {
    expect(result.goalReachedOn).not.toBeNull()
    expect(result.affordability?.deposit).toBeGreaterThan(35_000)
    expect(result.affordability?.maxLoanByIncome).toBe(248_000)
    expect(result.reasoning.join(' ')).toMatch(/House deposit: €35,000 is reached in/)
    noAdvice(result)
  })

  it('locks nothing away without a date, and keeps an emergency fund in instant access', () => {
    const open = buildPlan(
      market,
      buildPlanRequestSchema.parse({
        situation: { ...situation, debts: [] },
        goals: [
          { id: 'grow', kind: 'grow_savings', label: 'Grow savings', priority: 1 },
          { id: 'rainy-day', kind: 'emergency_fund', label: 'Rainy-day money', priority: 2 },
        ],
      }),
      AS_OF,
      CREATED,
    )
    const fund = open.plan.recommendation.products.find((p) => p.role === 'emergency_fund')
    // Three months of €2,550 outgoings.
    expect(fund?.amount).toBeCloseTo(7_650, 0)
    expect(open.plan.assumptions.join(' ')).toMatch(/nothing is locked/)
    expect(() => marketPlanSchema.parse(open.plan)).not.toThrow()
  })
})

describe('build_plan: what the first Claude test showed (2026-11-09)', () => {
  // As the customer put it: no income, outgoings, repayment or target given.
  const asked: Situation = {
    monthlySaving: 800,
    savings: [{ label: 'Current account', balance: 25_000, access: 'current_account' }],
    debts: [
      {
        id: 'car',
        label: 'Car loan',
        kind: 'car_finance',
        balance: 9_000,
        ratePct: 9,
        monthsRemaining: 36,
      },
    ],
  }
  const goal = {
    id: 'deposit',
    kind: 'house_deposit' as const,
    label: 'House deposit',
    targetDate: '2028-11',
    priority: 1,
  }
  const plan = (extra: Record<string, unknown> = {}) =>
    buildPlan(
      market,
      buildPlanRequestSchema.parse({ situation: asked, goals: [goal], ...extra }),
      AS_OF,
      CREATED,
    )
  const locks = (result: ReturnType<typeof plan>) =>
    result.plan.recommendation.products.filter((p) => /\(\d+ months\)/.test(p.productName))

  it('keeps the money in instant access when a term earns less than the thresholds, with both figures', () => {
    const result = plan()
    expect(result.liquidity.decision).toBe('instant_access')
    expect(result.liquidity.gainEur).toBeGreaterThan(0)
    expect(result.liquidity.gainEur).toBeLessThan(100)
    expect(result.liquidity.lockedNetPosition).not.toBeNull()
    expect(result.liquidity.why).toMatch(/would leave only €[\d.,]+ more/)
    expect(locks(result)).toEqual([])
    expect(() => buildPlanResponseSchema.parse(result)).not.toThrow()
    noAdvice(result)
  })

  it('locks when the thresholds are lowered, and says what instant access would leave', () => {
    const result = plan({ minLockGainEur: 0, minLockGainPctPerYear: 0 })
    expect(result.liquidity.decision).toBe('locked')
    expect(locks(result).length).toBe(1)
    expect(result.whatIf.lines.join(' ')).toMatch(/What if every euro stayed in instant access/)
  })

  it('states where the freed loan repayment goes', () => {
    const result = plan()
    expect(result.reasoning.join(' ')).toMatch(
      /The €284\.73 a month the Car loan took is saved instead .* €1,084\.73 a month goes into the accounts below/,
    )
    expect(result.plan.recommendation.totals?.monthly).toBeCloseTo(1_084.73, 2)
  })

  it('gives what-ifs and the offer to save', () => {
    const result = plan()
    expect(result.whatIf.extraMonthly?.extra).toBe(100)
    // €100 a month for 24 months, plus its interest.
    expect(result.whatIf.extraMonthly?.addsAtHorizon).toBeGreaterThan(2_400)
    expect(result.whatIf.extraMonthly?.addsAtHorizon).toBeLessThan(2_600)
    expect(result.whatIf.lines.join(' ')).toMatch(
      /What if the Car loan were kept instead of cleared/,
    )
    expect(result.next).toMatch(/24 hours/)
    expect(result.next).toMatch(/Saoirse/)
    // Only what exists is promised; what is not built yet says so.
    expect(result.next).toMatch(/coming, not built yet/)
    expect(result.next).not.toMatch(/partner/)
  })

  it('holds a €6,000 buffer apart and keeps everything accessible when asked', () => {
    const result = plan({ emergencyBufferEur: 6_000, keepAccessible: true })
    const buffer = result.plan.recommendation.products.find((p) => p.role === 'emergency_fund')
    expect(buffer?.amount).toBe(6_000)
    const bufferGoal = result.plan.goals.find((g) => g.kind === 'emergency_fund')
    expect(bufferGoal).toMatchObject({ targetAmount: 6_000, label: 'Emergency buffer' })
    expect(buffer?.goalIds).toEqual([bufferGoal?.id])
    expect(result.liquidity.decision).toBe('instant_access')
    expect(result.liquidity.lockedNetPosition).toBeNull()
    expect(locks(result)).toEqual([])
    expect(result.plan.recommendation.totals?.lumpSum).toBeCloseTo(16_000, 0)
    expect(() => marketPlanSchema.parse(result.plan)).not.toThrow()
  })

  it('sizes the buffer from months of outgoings, and says when it cannot', () => {
    const sized = buildPlan(
      market,
      buildPlanRequestSchema.parse({
        situation: { ...asked, outgoings: { rentMonthly: 1_500, otherMonthly: 500 } },
        goals: [goal],
        emergencyBufferMonths: 3,
      }),
      AS_OF,
      CREATED,
    )
    expect(
      sized.plan.recommendation.products.find((p) => p.role === 'emergency_fund')?.amount,
    ).toBe(6_000)
    const unsized = plan({ emergencyBufferMonths: 3 })
    expect(unsized.plan.recommendation.products.some((p) => p.role === 'emergency_fund')).toBe(
      false,
    )
    expect(unsized.reasoning.join(' ')).toMatch(/outgoings were not given/)
  })

  it('locks nothing when the goal date is not certain', () => {
    const result = plan({ goalDateCertain: false, minLockGainEur: 0, minLockGainPctPerYear: 0 })
    expect(result.liquidity.decision).toBe('instant_access')
    expect(locks(result)).toEqual([])
  })

  it('gives the month a target is reached at this pace', () => {
    const result = buildPlan(
      market,
      buildPlanRequestSchema.parse({
        situation: asked,
        goals: [{ ...goal, targetAmount: 30_000 }],
      }),
      AS_OF,
      CREATED,
    )
    expect(result.whatIf.goalReachedAtCurrentPace).toMatch(/^202[78]-\d{2}$/)
    expect(result.whatIf.goalReachedAtCurrentPace).toBe(result.goalReachedOn)
  })

  it('shows each product’s deposit guarantee, with its source', () => {
    const result = plan()
    for (const product of result.plan.recommendation.products) {
      expect(product.depositGuarantee?.scheme).toBeTruthy()
      expect(product.depositGuarantee?.sourceUrl).toMatch(/^https:\/\//)
    }
  })
})

describe('what the host reads first (after the second Claude test)', () => {
  const asked: Situation = {
    monthlySaving: 800,
    savings: [{ label: 'Current account', balance: 25_000, access: 'current_account' }],
    debts: [
      {
        id: 'car',
        label: 'Car loan',
        kind: 'car_finance',
        balance: 9_000,
        ratePct: 9,
        monthsRemaining: 36,
      },
    ],
  }
  const home = {
    id: 'deposit',
    kind: 'house_deposit' as const,
    label: 'House deposit',
    targetDate: '2028-11',
    priority: 1,
  }
  const result = buildPlan(
    market,
    buildPlanRequestSchema.parse({ situation: asked, goals: [home] }),
    AS_OF,
    CREATED,
  )
  const text = result.presentation.join('\n')
  /** Imperatives the host copied in test 2. */
  const DIRECTIVE = /(^|[.:;]\s+)(Clear|Pay off|Set up|Move|Ask|Open|Put|Get)\b/m

  it('leads with money found, then one net figure per scenario, and no orders', () => {
    expect(result.presentation[0]).toBe(result.moneyFound.headline)
    const scenario = result.debtScenarios[0]
    expect(scenario).toBeDefined()
    if (scenario === undefined) return
    expect(text).toContain(`cleared from savings now, ${euro(scenario.cleared.netPosition)}`)
    expect(text).toContain(`kept, ${euro(scenario.kept.netPosition)}`)
    expect(text).toMatch(/everything held less what is still owed/)
    expect(text).not.toMatch(DIRECTIVE)
    expect(result.presentation.at(-1)).toMatch(/the customer decides/)
  })

  it('never shows a gross pot without what is still owed beside it', () => {
    const kept = buildPlan(
      market,
      buildPlanRequestSchema.parse({
        situation: {
          ...asked,
          debts: [
            {
              id: 'car',
              label: 'Car loan',
              kind: 'car_finance',
              balance: 9_000,
              ratePct: 0.5,
              monthsRemaining: 36,
            },
          ],
        },
        goals: [home],
      }),
      AS_OF,
      CREATED,
    )
    const all = [...kept.presentation, ...kept.reasoning, ...kept.whatIf.lines].join('\n')
    expect(kept.plan.debts[0]?.action).toBe('keep_paying')
    expect(all).toMatch(
      /€[\d,]+ net at November 2028, everything held less what is still owed: €[\d,]+ towards the house deposit, less €[\d,]+ still owed on the car loan\./,
    )
    expect(all).not.toMatch(/projected at November 2028/)
  })

  it('carries Help to Buy for a house deposit, even without income', () => {
    expect(result.helpToBuy?.status).toBe('depends')
    expect(result.helpToBuy?.upToEur).toBe(35_000)
    expect(text).toMatch(/Help to Buy: depends, up to €35,000/)
    const withTax = buildPlan(
      market,
      buildPlanRequestSchema.parse({
        situation: asked,
        goals: [home],
        homePrice: 300_000,
        propertyKind: 'new_build',
        taxPaidLastFourYearsEur: 40_000,
      }),
      AS_OF,
      CREATED,
    )
    expect(withTax.helpToBuy).toMatchObject({ status: 'available', amountEur: 30_000 })
    const secondHand = buildPlan(
      market,
      buildPlanRequestSchema.parse({
        situation: asked,
        goals: [home],
        propertyKind: 'second_hand',
      }),
      AS_OF,
      CREATED,
    )
    expect(secondHand.helpToBuy?.status).toBe('not_available')
  })

  it('in the review, leads with money found and gives no orders', () => {
    const reviewed = review(market, { situation: asked, goals: [home] }, AS_OF)
    expect(reviewed.presentation[0]).toBe(reviewed.moneyFound.headline)
    expect(reviewed.presentation.join('\n')).not.toMatch(DIRECTIVE)
    expect(reviewed.candidateGoals.map((goal) => goal.label).join(' ')).not.toMatch(/^Clear |^Put /)
  })
})
