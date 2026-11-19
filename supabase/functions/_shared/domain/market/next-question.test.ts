import { describe, expect, it } from 'vitest'
import { buildPlanRequestSchema } from '../../contracts/market-tools.ts'
import { adviceWordsIn } from '../../market/disclosures.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import { buildPlan } from './plan.ts'

/**
 * The one question (`rankQuestions`), for a home: tax paid joins the candidates when a new
 * build's Help to Buy is conditional (2026-11-12, the first-home experience, "3. Arrival").
 */

const market = normaliseMarket(MARKET_FIXTURE)
const AS_OF = '2026-11-12'
const CREATED = '2026-11-12T09:00:00.000Z'

/** The spec's couple: €110,000 between them, €32,000 saved, a €400,000 new build. */
const couple = (extra: Record<string, unknown> = {}) =>
  buildPlan(
    market,
    buildPlanRequestSchema.parse({
      situation: {
        income: { annualGross: 110_000 },
        monthlySaving: 1_500,
        savings: [{ label: 'Deposit saved', balance: 32_000, access: 'instant' }],
        firstTimeBuyer: true,
      },
      goals: [{ id: 'home', kind: 'house_deposit', label: 'Buying a home', targetDate: '2028-06' }],
      homePrice: 400_000,
      propertyKind: 'new_build',
      buyingTogether: true,
      ...extra,
    }),
    AS_OF,
    CREATED,
  )

const keys = (result: ReturnType<typeof couple>) =>
  [result.nextQuestion, ...result.laterQuestions].map((item) => item?.key)

/** One buyer, a price and the kind of home given; the rest varies by test. */
const single = (situation: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  buildPlan(
    market,
    buildPlanRequestSchema.parse({
      situation: {
        monthlySaving: 1_000,
        savings: [{ label: 'Deposit saved', balance: 25_000, access: 'instant' }],
        ...situation,
      },
      goals: [{ id: 'home', kind: 'house_deposit', label: 'Buying a home', targetDate: '2028-06' }],
      homePrice: 350_000,
      propertyKind: 'second_hand',
      ...extra,
    }),
    AS_OF,
    CREATED,
  )

const allQuestions = (result: ReturnType<typeof single>) =>
  [result.nextQuestion, ...result.laterQuestions].filter((item) => item !== null)

/** A spread of nothing, quoted: "by up to €0", "by 0 months". */
const ZERO = /€0(?![\d,.])|\b0 months?\b|nothing in these figures/

/** The couple with no income given: nothing to estimate tax paid from. */
const noIncome = (extra: Record<string, unknown> = {}) =>
  couple({
    situation: {
      monthlySaving: 1_500,
      savings: [{ label: 'Deposit saved', balance: 32_000, access: 'instant' }],
      firstTimeBuyer: true,
    },
    ...extra,
  })

describe('the next question: tax paid', () => {
  it('is not asked when the estimate from the income is well above what the price allows', () => {
    // €110,000 between two: about €81,480 of Income Tax over four years; 30% less still covers
    // the €35,000, so nothing is at stake in the answer.
    const result = couple()
    expect(result.home?.helpToBuyConditional).toBe(false)
    expect(result.home?.taxPaidBasis).toBe('estimated')
    expect(result.home?.helpToBuyEur).toBe(35_000)
    expect(keys(result)).not.toContain('tax_paid')
  })

  it('asks whether the estimate is right when it sets the refund, scored by what a lower figure takes off', () => {
    // €40,000 a year: about €17,940 over 2022 to 2025, under the €20,000 that 10% of €200,000
    // allows; 30% less (€12,558) would take €5,382 off.
    const result = single(
      { income: { annualGross: 40_000 }, firstTimeBuyer: true },
      { homePrice: 200_000, propertyKind: 'new_build' },
    )
    expect(result.home?.taxPaidBasis).toBe('estimated')
    expect(result.home?.helpToBuyEur).toBe(17_940)
    const question = allQuestions(result).find((item) => item.key === 'tax_paid')
    expect(question).toMatchObject({
      key: 'tax_paid',
      question:
        'Is about €17,940 of Income Tax and DIRT over the last four tax years right? It is estimated from the income; the exact figure is on each year’s Statement of Liability in Revenue myAccount.',
      why: 'Help to Buy of €17,940 rests on it: a figure 30% lower would take €5,382 off.',
      scoreEur: 5_382,
    })
    expect(adviceWordsIn(JSON.stringify(question))).toEqual([])
  })

  it('asks what Help to Buy turns on when there is no income to estimate from, scored by the amount at stake', () => {
    const result = noIncome()
    expect(result.home?.helpToBuyConditional).toBe(true)
    const question = allQuestions(result).find((item) => item.key === 'tax_paid')
    expect(question).toMatchObject({
      key: 'tax_paid',
      question: 'How much Income Tax and DIRT have you both paid over the last four years?',
      why: 'It decides whether Help to Buy covers the €35,000.',
      scoreEur: 35_000,
    })
    expect(question?.spread.keysMonths).toBeGreaterThan(0)
    expect(adviceWordsIn(JSON.stringify(question))).toEqual([])
  })

  it('words it for one buyer when nobody else is buying', () => {
    const question = allQuestions(noIncome({ buyingTogether: false })).find(
      (item) => item.key === 'tax_paid',
    )
    expect(question?.question).toBe(
      'How much Income Tax and DIRT have you paid over the last four years?',
    )
  })

  it('is not asked once tax paid is given, nor for a second-hand home', () => {
    expect(keys(couple({ taxPaidLastFourYearsEur: 50_000 }))).not.toContain('tax_paid')
    expect(keys(noIncome({ taxPaidLastFourYearsEur: 50_000 }))).not.toContain('tax_paid')
    expect(keys(couple({ propertyKind: 'second_hand' }))).not.toContain('tax_paid')
  })
})

describe('what a question moves, said in their figures (2026-11-12)', () => {
  it('says whether the limits reach the price when the price is given and the income is not', () => {
    const income = allQuestions(single({ firstTimeBuyer: true })).find(
      (item) => item.key === 'income',
    )
    expect(income?.why).toMatch(
      /^It decides whether the Central Bank limits reach the €350,000: a €315,000 mortgage \(90%\) needs about €79,000 a year at 4 times income/,
    )
    expect(income?.why).not.toMatch(ZERO)
  })

  it('never quotes a spread of nothing, whichever question it is', () => {
    const results = [
      single({ firstTimeBuyer: true }),
      single({ income: { annualGross: 80_000 } }),
      single({ income: { annualGross: 80_000 }, firstTimeBuyer: true }),
      single(
        { income: { annualGross: 80_000 }, firstTimeBuyer: true },
        { propertyKind: undefined },
      ),
      single({ income: { annualGross: 80_000 } }, { homePrice: undefined }),
      single({
        income: { annualGross: 80_000 },
        firstTimeBuyer: true,
        debts: [{ id: 'car', label: 'Car loan', kind: 'car_finance', balance: 9_000, ratePct: 9 }],
      }),
      couple(),
      couple({ propertyKind: undefined, homePrice: undefined }),
    ]
    for (const result of results) {
      for (const item of allQuestions(result)) {
        expect(item.why, item.key).not.toMatch(ZERO)
        expect(adviceWordsIn(`${item.question} ${item.why}`), item.key).toEqual([])
      }
    }
  })
})

describe('the next question: first-time buyer', () => {
  it('asks the one thing assumed when it decides whether the limits reach the price', () => {
    // €350,000 needs a €315,000 mortgage: €320,000 at 4 times €80,000 covers it, €280,000 at
    // 3.5 times does not, so €35,000 of the €40,000 gap moves their figures.
    const result = single({ income: { annualGross: 80_000 } })
    expect(result.nextQuestion).toMatchObject({
      key: 'first_time_buyer',
      question: 'Is this your first home, never having owned one before?',
    })
    expect(result.nextQuestion?.scoreEur).toBeGreaterThanOrEqual(35_000)
    expect(result.nextQuestion?.scoreEur).toBeLessThan(40_000)
    expect(result.nextQuestion?.why).toMatch(
      /^It sets the Central Bank limit on €80,000 a year: €320,000 as a first-time buyer, €280,000 otherwise, and only the first covers the €315,000 mortgage the €350,000 needs/,
    )
    expect(result.plan.arrival?.hookQuestion?.key).toBe('first_time_buyer')
  })

  it('counts nothing from the limits when both cover the price', () => {
    // €110,000: €440,000 at 4 times, €385,000 at 3.5 times; the €400,000 needs €360,000.
    const result = couple({
      situation: {
        income: { annualGross: 110_000 },
        monthlySaving: 1_500,
        savings: [{ label: 'Deposit saved', balance: 32_000, access: 'instant' }],
      },
    })
    const first = allQuestions(result).find((item) => item.key === 'first_time_buyer')
    expect(first?.scoreEur).toBeLessThan(35_000)
    expect(first?.why).toMatch(
      /^It sets the Central Bank limit on €110,000 a year: €440,000 as a first-time buyer, €385,000 otherwise, and both cover the €360,000 mortgage the €400,000 needs/,
    )
    expect(first?.why).not.toMatch(/rates lenders/)
  })

  it('scores the spread in the most the limits allow when no price is given', () => {
    // €320,000 and €280,000 at 90%: €355,000 against €311,000.
    const result = single({ income: { annualGross: 80_000 } }, { homePrice: undefined })
    const first = [result.nextQuestion, ...result.laterQuestions].find(
      (item) => item?.key === 'first_time_buyer',
    )
    expect(first?.scoreEur).toBeGreaterThanOrEqual(44_000)
  })

  it('words it for both, and is not asked once it is given', () => {
    expect(
      single({ income: { annualGross: 80_000 } }, { buyingTogether: true }).nextQuestion?.question,
    ).toBe('Is this a first home for both of you, neither having owned one before?')
    expect(keys(single({ income: { annualGross: 80_000 }, firstTimeBuyer: false }))).not.toContain(
      'first_time_buyer',
    )
  })
})
