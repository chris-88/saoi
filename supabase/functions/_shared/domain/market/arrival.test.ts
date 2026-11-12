import { describe, expect, it } from 'vitest'
import { marketPlanSchema } from '../../contracts/market-plan.ts'
import { buildPlanRequestSchema } from '../../contracts/market-tools.ts'
import { adviceWordsIn } from '../../market/disclosures.ts'
import { ARRIVAL_FALLBACK_OPENING, arrivalOpening } from './arrival.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import { buildPlan } from './plan.ts'

/**
 * The arrival a home plan carries (2026-11-12, the first-home experience, "2. The card" and
 * "3. Arrival"), on the experience's worked example: a couple on €110,000 between them with
 * €32,000 saved, looking at a €400,000 new build, tax paid not given.
 */

const market = normaliseMarket(MARKET_FIXTURE)
const AS_OF = '2026-11-12'
const CREATED = '2026-11-12T09:00:00.000Z'

const home = (extra: Record<string, unknown> = {}) =>
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

describe('the arrival on a home plan', () => {
  const result = home()
  const arrival = result.plan.arrival

  it('words the host card’s headline: the month before interest, Help to Buy left out', () => {
    expect(arrival?.keysOn).toMatch(/^\d{4}-\d{2}$/)
    expect(arrival?.readyLine).toMatch(/^[A-Z][a-z]+ \d{4}$/)
    expect(arrival?.readyNote).toBe('Before interest')
    expect(arrival?.factParts).toEqual([
      '€40,000 deposit',
      '+ €4,000 stamp duty',
      '+ €3,000 legal and survey',
      'Help to Buy up to €35,000 not counted',
    ])
    expect(arrival?.progress).toEqual({
      savedEur: 32_000,
      neededEur: 47_000,
      monthlySavingEur: 1_500,
    })
  })

  it('gives the three tiles in order, a rate and a count, never a lender', () => {
    expect(arrival?.tiles.map((tile) => tile.label)).toEqual([
      'Savings',
      'Mortgage',
      'Could afford',
    ])
    expect(arrival?.tiles[0]?.value).toMatch(/^up to \d+\.\d{2}%$/)
    expect(arrival?.tiles[0]?.lines[0]).toMatch(/^€[\d,]+ interest by [A-Z][a-z]{2} 2028$/)
    expect(arrival?.tiles[0]?.lines[1]).toMatch(/^\d+ accounts?$/)
    expect(arrival?.tiles[1]?.value).toBe('€360,000')
    expect(arrival?.tiles[1]?.lines[0]).toMatch(/^from \d+\.\d{2}%, €[\d,]+\/mo$/)
    expect(arrival?.tiles[1]?.lines[1]).toMatch(/^\d+ options?, 30 years$/)
    expect(arrival?.tiles[2]).toEqual({
      label: 'Could afford',
      value: 'up to €488,000',
      lines: ['4× income, 90% loan', '30 years'],
    })
    const tiles = JSON.stringify(arrival?.tiles)
    for (const view of market.products) expect(tiles).not.toContain(view.providerName)
  })

  it('names what was taken as given, and the question the app opens with', () => {
    expect(arrival?.assumptions).toEqual(['First-time buyer', 'New build', 'Rent not given'])
    expect(arrival?.hookQuestion).toEqual({
      key: 'tax_paid',
      question: 'How much Income Tax and DIRT have you both paid over the last four years?',
      why: 'It decides whether Help to Buy covers the €35,000.',
    })
    expect(arrivalOpening(arrival)).toBe(
      'How much Income Tax and DIRT have you both paid over the last four years? It decides whether Help to Buy covers the €35,000.',
    )
  })

  it('passes the plan contract and holds no advice words', () => {
    expect(marketPlanSchema.parse(result.plan).arrival).toEqual(arrival)
    expect(adviceWordsIn(JSON.stringify(arrival))).toEqual([])
    expect(adviceWordsIn(ARRIVAL_FALLBACK_OPENING)).toEqual([])
    expect(arrivalOpening(undefined)).toBe(ARRIVAL_FALLBACK_OPENING)
  })

  it('counts Help to Buy once tax paid covers it', () => {
    const counted = home({ taxPaidLastFourYearsEur: 50_000 }).plan.arrival
    expect(counted?.factParts.at(-1)).toBe('− €35,000 Help to Buy')
    expect(counted?.readyNote).toBeNull()
    expect(counted?.hookQuestion?.key).not.toBe('tax_paid')
  })

  it('says what was assumed when nothing was said', () => {
    const bare = buildPlan(
      market,
      buildPlanRequestSchema.parse({
        situation: {
          income: { annualGross: 110_000 },
          monthlySaving: 1_500,
          savings: [{ label: 'Deposit saved', balance: 32_000 }],
          outgoings: { rentMonthly: 2_000 },
        },
        goals: [{ id: 'home', kind: 'house_deposit', label: 'Buying a home' }],
        homePrice: 400_000,
      }),
      AS_OF,
      CREATED,
    ).plan.arrival
    expect(bare?.assumptions).toEqual([
      'First-time buyer, assumed',
      'Second-hand, assumed',
      'Rent €2,000 a month',
    ])
  })

  it('is left out of a plan with no home, and a plan without one still parses', () => {
    const savings = buildPlan(
      market,
      buildPlanRequestSchema.parse({
        situation: {
          monthlySaving: 500,
          savings: [{ label: 'Savings', balance: 10_000 }],
        },
        goals: [{ id: 'rainy', kind: 'emergency_fund', label: 'Rainy-day money' }],
      }),
      AS_OF,
      CREATED,
    )
    expect(savings.plan.arrival).toBeUndefined()
    const { arrival: _dropped, ...stored } = result.plan
    expect(marketPlanSchema.parse(stored).arrival).toBeUndefined()
  })
})
