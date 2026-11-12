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

describe('the next question: tax paid', () => {
  const result = couple()

  it('asks what Help to Buy turns on when it is conditional, scored by the amount at stake', () => {
    expect(result.home?.helpToBuyConditional).toBe(true)
    expect(result.nextQuestion).toMatchObject({
      key: 'tax_paid',
      question: 'How much Income Tax and DIRT have you both paid over the last four years?',
      why: 'It decides whether Help to Buy covers the €35,000.',
      scoreEur: 35_000,
    })
    expect(adviceWordsIn(JSON.stringify(result.nextQuestion))).toEqual([])
  })

  it('measures the spread with none of it and all of it counted', () => {
    expect(result.nextQuestion?.spread.keysMonths).toBeGreaterThan(0)
  })

  it('words it for one buyer when nobody else is buying', () => {
    expect(couple({ buyingTogether: false }).nextQuestion?.question).toBe(
      'How much Income Tax and DIRT have you paid over the last four years?',
    )
  })

  it('is not asked once tax paid is given, nor for a second-hand home', () => {
    expect(keys(couple({ taxPaidLastFourYearsEur: 50_000 }))).not.toContain('tax_paid')
    expect(keys(couple({ propertyKind: 'second_hand' }))).not.toContain('tax_paid')
  })
})
