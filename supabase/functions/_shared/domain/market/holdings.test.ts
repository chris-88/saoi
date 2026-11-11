import { describe, expect, it } from 'vitest'
import { buildPlanRequestSchema } from '../../contracts/market-tools.ts'
import { planProgressSchema } from '../../contracts/holdings.ts'
import { exampleMarketPlan } from '../../contracts/market-plan.example.ts'
import type { MarketPlan } from '../../contracts/market-plan.ts'
import { adviceWordsIn } from '../../market/disclosures.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import {
  type HoldingFigures,
  holdingLine,
  holdingsFromPlan,
  planProgress,
  reminderForHolding,
} from './holdings.ts'
import { normaliseMarket } from './normalise.ts'
import { buildPlan } from './plan.ts'

const AS_OF = '2026-11-10'
const marketPlanExample = exampleMarketPlan()
const CREATED = '2026-11-10T09:00:00.000Z'

/** The €400k example: €30,000 saved, €1,000 a month, a second-hand home by June 2028. */
const HOME_400K: MarketPlan = buildPlan(
  normaliseMarket(MARKET_FIXTURE),
  buildPlanRequestSchema.parse({
    situation: {
      monthlySaving: 1_000,
      savings: [{ label: 'Savings', balance: 30_000 }],
      firstTimeBuyer: true,
      income: { annualGross: 100_000 },
    },
    goals: [{ id: 'home', kind: 'house_deposit', label: 'First home', targetDate: '2028-06' }],
    homePrice: 400_000,
    propertyKind: 'second_hand',
  }),
  AS_OF,
  CREATED,
).plan

const savings = (balance: number, monthlyAmountEur: number | null = null): HoldingFigures => ({
  kind: 'savings',
  balance,
  monthlyAmountEur,
})

/** Words that would make a progress line praise or instruct. */
const PRAISE_OR_INSTRUCTION = /\b(well done|keep|should|great|good)\b/i

describe('holdingsFromPlan', () => {
  it('seeds the savings and the debts, kinds mapped, noted on the plan’s date', () => {
    const plan: MarketPlan = {
      ...marketPlanExample,
      situation: {
        ...marketPlanExample.situation,
        savings: [
          { label: 'Current account', balance: 25_000, provider: 'AIB', aerPct: 0 },
          { label: '12-month fixed term deposit', balance: 10_000, aerPct: 2.5 },
        ],
        debts: [
          {
            id: 'car',
            label: 'Car loan',
            kind: 'car_finance',
            balance: 9_000,
            ratePct: 8.5,
            monthlyRepayment: 350,
          },
          { id: 'cu', label: 'Credit union', kind: 'other', balance: 2_000 },
        ],
      },
    }
    expect(holdingsFromPlan(plan, '2026-11-09')).toEqual([
      {
        kind: 'current',
        label: 'Current account',
        provider: 'AIB',
        productId: null,
        balance: 25_000,
        ratePct: 0,
        monthlyAmountEur: null,
        fixedUntil: null,
        notedOn: '2026-11-09',
        source: 'plan',
      },
      expect.objectContaining({
        kind: 'deposit',
        label: '12-month fixed term deposit',
        ratePct: 2.5,
      }),
      expect.objectContaining({
        kind: 'car_finance',
        balance: 9_000,
        ratePct: 8.5,
        monthlyAmountEur: 350,
      }),
      expect.objectContaining({
        kind: 'other_debt',
        label: 'Credit union',
        ratePct: null,
        monthlyAmountEur: null,
      }),
    ])
  })

  it('seeds nothing from an empty situation', () => {
    const plan = {
      ...marketPlanExample,
      situation: { ...marketPlanExample.situation, savings: [], debts: [] },
    }
    expect(holdingsFromPlan(plan, '2026-11-09')).toEqual([])
  })
})

describe('planProgress on a house deposit (the €400k plan)', () => {
  it('carries the cash needed at the keys in the plan', () => {
    expect(HOME_400K.comparison?.neededAtKeysEur).toBe(47_000)
  })

  it('states €33,000 held a month on, against the plan’s path, as a fact', () => {
    const progress = planProgress(HOME_400K, [savings(33_000)], '2026-12-11')
    expect(progress).toEqual({
      goal: 'house_deposit',
      goalLabel: 'First home',
      savedNowEur: 33_000,
      savedFrom: 'holdings',
      neededEur: 47_000,
      monthlyEur: 1_000,
      monthAtThisPace: '2028-02',
      planExpectedNowEur: 31_000,
      differenceEur: 2_000,
      line: "€33,000 of €47,000 saved; at €1,000 a month that is February 2028, €2,000 ahead of the plan's path.",
    })
    expect(() => planProgressSchema.parse(progress)).not.toThrow()
  })

  it('says behind, uses the accounts’ own monthly amounts, and sums current, savings and deposit', () => {
    const progress = planProgress(
      HOME_400K,
      [
        savings(20_000, 800),
        { kind: 'current', balance: 2_000, monthlyAmountEur: null },
        { kind: 'deposit', balance: 5_000, monthlyAmountEur: null },
        { kind: 'credit_card', balance: 1_500, monthlyAmountEur: 100 },
      ],
      '2027-05-01',
    )
    // The plan's path: €30,000 and six months of €1,000.
    expect(progress).toMatchObject({
      savedNowEur: 27_000,
      monthlyEur: 800,
      planExpectedNowEur: 36_000,
      differenceEur: -9_000,
    })
    // €20,000 to go at €800: 25 months from May 2027.
    expect(progress?.line).toBe(
      "€27,000 of €47,000 saved; at €800 a month that is June 2029, €9,000 behind the plan's path.",
    )
  })

  it('falls back to the plan’s own figures when no account is entered', () => {
    const progress = planProgress(HOME_400K, [], '2026-12-11')
    expect(progress).toMatchObject({ savedNowEur: 30_000, savedFrom: 'plan', differenceEur: null })
    expect(progress?.line).toBe(
      'No accounts entered yet; the plan had €30,000 of €47,000 saved; at €1,000 a month that is May 2028.',
    )
  })

  it('states the amount is held once it is, and the plan’s path exactly', () => {
    expect(planProgress(HOME_400K, [savings(48_000)], '2026-11-20')?.line).toBe(
      "€48,000 saved, €47,000 needed at the keys, €18,000 ahead of the plan's path.",
    )
    expect(planProgress(HOME_400K, [savings(30_000)], '2026-11-20')?.line).toMatch(
      /, on the plan's path\.$/,
    )
  })

  it('uses the goal’s target for a plan saved without the cash at the keys', () => {
    const progress = planProgress(marketPlanExample, [savings(26_000)], '2026-12-01')
    expect(progress).toMatchObject({ goal: 'house_deposit', neededEur: 35_000 })
  })
})

describe('planProgress on a debt goal', () => {
  const plan: MarketPlan = {
    ...marketPlanExample,
    goals: [{ id: 'debt', kind: 'pay_off_debt', label: 'Clear the car loan', priority: 1 }],
    combination: { products: [] },
    debts: [],
    situation: {
      ...marketPlanExample.situation,
      debts: [
        {
          id: 'car',
          label: 'Car loan',
          kind: 'car_finance',
          balance: 9_000,
          ratePct: 8.5,
          monthlyRepayment: 400,
        },
        {
          id: 'home',
          label: 'Mortgage',
          kind: 'mortgage',
          balance: 200_000,
          monthlyRepayment: 1_000,
        },
      ],
    },
  }

  it('states the balance now against the plan’s and the months left at the repayment', () => {
    const progress = planProgress(
      plan,
      [
        { kind: 'car_finance', balance: 6_500, monthlyAmountEur: 400 },
        { kind: 'mortgage', balance: 199_000, monthlyAmountEur: 1_000 },
        savings(5_000),
      ],
      '2027-03-15',
    )
    expect(progress).toEqual({
      goal: 'pay_off_debt',
      goalLabel: 'Clear the car loan',
      owedNowEur: 6_500,
      owedFrom: 'holdings',
      planOwedEur: 9_000,
      changeEur: -2_500,
      monthlyEur: 400,
      monthsLeft: 17,
      clearedIn: '2028-08',
      line: '€6,500 owed, €9,000 when the plan was made; at €400 a month that is 17 months, to August 2028, before interest.',
    })
    expect(() => planProgressSchema.parse(progress)).not.toThrow()
  })

  it('states nothing owed, and the plan’s figures when no debt is entered', () => {
    expect(
      planProgress(
        plan,
        [{ kind: 'car_finance', balance: 0, monthlyAmountEur: null }],
        '2027-03-15',
      )?.line,
    ).toBe('Nothing owed now, €9,000 when the plan was made.')
    expect(planProgress(plan, [], '2027-03-15')?.line).toBe(
      'No debts entered yet; the plan had €9,000 owed; at €400 a month that is 23 months, to February 2029, before interest.',
    )
  })

  it('is null for a plan with neither goal', () => {
    const other: MarketPlan = {
      ...plan,
      goals: [{ id: 'rainy', kind: 'emergency_fund', label: 'Rainy day' }],
    }
    expect(planProgress(other, [], '2027-03-15')).toBeNull()
  })
})

describe('no progress line praises or instructs', () => {
  it('holds every line to facts', () => {
    const lines = [
      ...[0, 10_000, 30_000, 33_000, 47_000, 60_000].flatMap((balance) =>
        ['2026-11-10', '2027-06-01', '2029-01-01'].map(
          (today) => planProgress(HOME_400K, [savings(balance)], today)?.line ?? '',
        ),
      ),
      planProgress(HOME_400K, [], '2027-01-01')?.line ?? '',
      planProgress(
        { ...HOME_400K, situation: { ...HOME_400K.situation, monthlySaving: undefined } },
        [savings(1)],
        '2027-01-01',
      )?.line ?? '',
    ]
    for (const line of lines) {
      expect(line).not.toBe('')
      expect(line).not.toMatch(PRAISE_OR_INSTRUCTION)
      expect(adviceWordsIn(line)).toEqual([])
    }
  })
})

describe('reminderForHolding', () => {
  const base = { label: 'AIB mortgage', productId: null }

  it('keeps a fixed rate’s end on a mortgage or a loan, and a deposit’s maturity', () => {
    expect(reminderForHolding({ ...base, kind: 'mortgage', fixedUntil: '2027-03-01' })).toEqual({
      kind: 'fixed_rate_ends',
      label: 'AIB mortgage: fixed rate ends',
      dueOn: '2027-03-01',
      productId: null,
    })
    expect(
      reminderForHolding({ ...base, kind: 'personal_loan', fixedUntil: '2027-03-01' })?.kind,
    ).toBe('fixed_rate_ends')
    expect(
      reminderForHolding({
        kind: 'deposit',
        label: 'BoI 1 year',
        fixedUntil: '2027-11-11',
        productId: 'deposit.fixed12',
      }),
    ).toEqual({
      kind: 'deposit_matures',
      label: 'BoI 1 year: matures',
      dueOn: '2027-11-11',
      productId: 'deposit.fixed12',
    })
    expect(reminderForHolding({ ...base, kind: 'savings', fixedUntil: '2027-01-01' })?.kind).toBe(
      'other',
    )
  })

  it('is null without a date, or once the date has passed', () => {
    expect(reminderForHolding({ ...base, kind: 'mortgage', fixedUntil: null })).toBeNull()
    expect(
      reminderForHolding({ ...base, kind: 'mortgage', fixedUntil: '2026-01-01' }, '2026-11-11'),
    ).toBeNull()
  })
})

describe('holdingLine', () => {
  it('lists the label, balance, rate and noted date', () => {
    expect(
      holdingLine({
        kind: 'mortgage',
        label: 'AIB mortgage',
        provider: 'AIB',
        balance: 240_000,
        ratePct: 3.5,
        monthlyAmountEur: 1_200,
        fixedUntil: '2027-03-01',
        notedOn: '2026-11-11',
      }),
    ).toBe(
      'AIB mortgage (mortgage, AIB): €240,000 owed at 3.5%, €1,200 a month repaid, fixed until 1 Mar 2027; noted 11 Nov 2026',
    )
  })
})
