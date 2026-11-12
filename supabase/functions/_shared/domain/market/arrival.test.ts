import { describe, expect, it } from 'vitest'
import { cardSchema, upgradeStoredCard } from '../../contracts/cards.ts'
import { marketPlanSchema, upgradeStoredPlan } from '../../contracts/market-plan.ts'
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

  it('gives the three tiles in order, the headline number alone, never a lender', () => {
    expect(arrival?.tiles.map((tile) => tile.label)).toEqual([
      'Savings',
      'Mortgage',
      'Could afford',
    ])
    const [savings, mortgage, afford] = arrival?.tiles ?? []
    // Savings: "up to" above the rate; the interest to the keys month darker; the count quiet.
    expect(savings?.qualifier).toBe('up to')
    expect(savings?.value).toMatch(/^\d+\.\d{2}%$/)
    expect(savings?.sub).toHaveLength(2)
    expect(savings?.sub[0]).toMatch(/^€[\d,]+ interest$/)
    expect(savings?.sub[1]).toMatch(/^by [A-Z][a-z]{2} \d{4}$/)
    expect(savings?.quiet[0]).toMatch(/^\d+ accounts?$/)
    expect(savings?.detail[0]).toMatch(
      /^Interest after DIRT on the deposit money to [A-Z][a-z]+ \d{4}, the keys month$/,
    )
    expect(savings?.detail[1]).toMatch(/^Top rate among the \d+ accounts? that take this saving/)
    // Mortgage: the lowest monthly repayment, the loan and the lowest rate under it.
    expect(mortgage?.qualifier).toBe('from')
    expect(mortgage?.value).toMatch(/^€[\d,]+\/mo$/)
    expect(mortgage?.sub[0]).toBe('€360,000 loan')
    expect(mortgage?.sub[1]).toMatch(/^from \d+\.\d{2}%$/)
    expect(mortgage?.quiet[0]).toMatch(/^\d+ options?$/)
    expect(mortgage?.detail[0]).toMatch(
      /^From €[\d,]+ to €[\d,]+ a month over 30 years, at each option’s initial rate$/,
    )
    expect(mortgage?.detail[1]).toMatch(
      /^The lowest monthly and the lowest rate among \d+ first-time-buyer options? at 90% loan-to-value, one per lender, rate type and fixed period; no lender is picked$/,
    )
    expect(mortgage?.detail.slice(2)).toEqual([
      'Lenders decide what they lend and at what rate.',
      'The three statutory mortgage warnings apply.',
    ])
    expect(afford).toEqual({
      label: 'Could afford',
      qualifier: 'up to',
      value: '€488,000',
      sub: ['4× income', '90% loan'],
      lines: ['4× income', '90% loan'],
      quiet: [],
      detail: [
        'The most the Central Bank limits allow: 4 times income at 90% loan, over 30 years',
        'That price needs a €48,800 deposit.',
      ],
    })
    const tiles = JSON.stringify(arrival?.tiles)
    for (const view of market.products) expect(tiles).not.toContain(view.providerName)
    for (const tile of arrival?.tiles ?? []) {
      expect(tile.value).not.toMatch(/up to|from/)
      // One short phrase per line: the app breaks only between them on a ~95px tile.
      for (const line of [...tile.sub, ...tile.quiet])
        expect(line.length, line).toBeLessThanOrEqual(16)
      expect(adviceWordsIn(JSON.stringify(tile))).toEqual([])
      // The old tile shape, for app builds cached before 2026-11-12.
      expect(tile.lines).toEqual([...tile.sub, ...tile.quiet])
    }
  })

  it('runs the savings to the keys month, the month the headline names', () => {
    const savings = arrival?.tiles[0]
    // "September 2027" on the headline is "Sep 2027" on the tile.
    const [month = '', year = ''] = (arrival?.readyLine ?? '').split(' ')
    const short = `${month.slice(0, 3)} ${year}`
    expect(savings?.sub[1]).toBe(`by ${short}`)
    expect(savings?.detail[0]).toContain(arrival?.readyLine ?? 'missing')
  })

  it('runs the savings to the date given when the keys are not reached at this pace', () => {
    const slow = home({
      situation: {
        income: { annualGross: 110_000 },
        savings: [{ label: 'Deposit saved', balance: 32_000, access: 'instant' }],
        firstTimeBuyer: true,
      },
    }).plan.arrival
    expect(slow?.keysOn).toBeNull()
    expect(slow?.tiles[0]?.sub[1]).toBe('by Jun 2028')
    expect(slow?.tiles[0]?.detail[0]).toMatch(/to June 2028, the date given for the keys$/)
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

/** The tiles a plan or card stored before 2026-11-12 carries. */
const OLD_TILES = [
  { label: 'Savings', value: 'up to 3.11%', lines: ['€879 interest by Jun 2028', '17 accounts'] },
  { label: 'Mortgage', value: '€360,000', lines: ['from 3.25%, €1,567/mo', '5 options, 30 years'] },
  { label: 'Could afford', value: 'up to €488,000', lines: ['4× income, 90% loan', '30 years'] },
]

describe('arrivals stored before the structured tiles', () => {
  const stored = { ...home().plan, arrival: { ...home().plan.arrival, tiles: OLD_TILES } }

  it('fails the new contract as stored, and reads through the upgrade', () => {
    expect(marketPlanSchema.safeParse(stored).success).toBe(false)
    const tiles = marketPlanSchema.parse(upgradeStoredPlan(stored)).arrival?.tiles
    expect(tiles?.[0]).toEqual({
      label: 'Savings',
      qualifier: 'up to',
      value: '3.11%',
      sub: ['17 accounts'],
      quiet: [],
      detail: ['€879 interest by Jun 2028'],
      lines: ['€879 interest by Jun 2028', '17 accounts'],
    })
    expect(tiles?.[0]?.lines).toEqual(['€879 interest by Jun 2028', '17 accounts'])
    expect(tiles?.[1]).toMatchObject({ qualifier: null, value: '€360,000' })
    expect(tiles?.[2]).toMatchObject({ qualifier: 'up to', value: '€488,000' })
  })

  it('reads a stored saved_plan card the same way, and leaves new tiles and other cards alone', () => {
    const card = {
      type: 'saved_plan',
      planId: '99999999-9999-4999-8999-999999999999',
      title: 'Buying a home',
      summary: 'From the card.',
      goals: [],
      products: [],
      debts: [],
      basis: 'The basis.',
      assumptions: [],
      attributions: [],
      routes: [],
      arrival: stored.arrival,
      createdAt: '2026-11-12T09:00:00.000Z',
      dataCheckedAt: '2026-11-12T09:00:00.000Z',
    }
    expect(cardSchema.safeParse(card).success).toBe(false)
    const parsed = cardSchema.parse(upgradeStoredCard(card))
    expect(parsed.type === 'saved_plan' && parsed.arrival?.tiles[0]?.value).toBe('3.11%')
    const current = home().plan.arrival
    expect(upgradeStoredPlan({ arrival: current })).toEqual({ arrival: current })
    const other = { type: 'status' }
    expect(upgradeStoredCard(other)).toBe(other)
  })

  it('fills lines on a stored new-shape tile that has none, sub then quiet', () => {
    const { lines: _lines, ...bare } = home().plan.arrival?.tiles[0] ?? {}
    const readBack = marketPlanSchema.parse(
      upgradeStoredPlan({
        ...home().plan,
        arrival: { ...home().plan.arrival, tiles: [bare] },
      }),
    ).arrival?.tiles[0]
    expect(readBack?.lines).toEqual([...(readBack?.sub ?? []), ...(readBack?.quiet ?? [])])
    expect(readBack?.lines.length).toBeGreaterThan(0)
  })
})
