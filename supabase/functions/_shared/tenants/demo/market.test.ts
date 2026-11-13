import { describe, expect, it } from 'vitest'
import { ccpcSnapshot } from '../../market/ccpc.snapshot.ts'
import { CCPC_ATTRIBUTION, type MarketProduct } from '../../market/schema.ts'
import { productsFromRows, rowFor } from '../../db/market.ts'
import { combinationsFor, combinationsSection } from './combinations.ts'
import { demoKnowledgeBase } from './knowledge-base.ts'
import { catalogueRecords, marketOf, publishedProducts, withMarketData } from './market.ts'
import { rateOf } from './rates.ts'
import { savingsOptionsFrom } from './savings-options.ts'

/**
 * Market data is the only source of a figure for a product the market covers: CCPC's rows for
 * Bank of Ireland, paired to the catalogue by name (2026-11-13). These pin the overlay with rows
 * that are not the committed snapshot, so they prove the consumers read the record and not the
 * catalogue, and they keep passing when CCPC's figures move.
 */

const CCPC_TOOL =
  'https://www.ccpc.ie/manage-your-money/saving-and-investments/compare-savings-accounts/lump-sum-savings-comparison-tool'

/** One CCPC row: by default, the six-month rung of Advantage. */
const record = (overrides: Partial<MarketProduct>): MarketProduct => ({
  provider: 'boi',
  source: 'ccpc',
  productId: 'deposit.c9006',
  category: 'deposit',
  providerProductName: 'Advantage 6 Month Fixed Term Account 25% Access',
  rates: { kind: 'deposit', aerPct: 1.11, basis: 'fixed', termMonths: 6, noticeDays: 0 },
  conditions: { takesMonthly: false, takesLumpSum: true, minLumpSumEur: 7000 },
  sourceUrl: CCPC_TOOL,
  attribution: CCPC_ATTRIBUTION,
  checkedAt: '2026-11-09T10:00:00.000Z',
  effectiveFrom: null,
  ...overrides,
})

const twelve = record({
  productId: 'deposit.c9012',
  providerProductName: 'Advantage 12 Month Fixed Term Account 25% Access',
  rates: { kind: 'deposit', aerPct: 1.22, basis: 'fixed', termMonths: 12, noticeDays: 0 },
  checkedAt: '2026-11-09T11:00:00.000Z',
})

const product = (products: readonly { id: string }[], id: string) => {
  const found = products.find((candidate) => candidate.id === id)
  expect(found, id).toBeDefined()
  return found!
}

describe('laying market data over the catalogue', () => {
  const products = withMarketData(demoKnowledgeBase.products, [record({}), twelve])
  const advantage = product(products, 'savings.advantage_fixed') as (typeof products)[number]

  it('folds CCPC’s terms into the catalogue’s ladder, with the source and the day checked', () => {
    expect(marketOf(advantage)?.rates).toMatchObject({
      aerPct: null,
      basis: 'fixed',
      terms: [
        { months: 6, aerPct: 1.11 },
        { months: 12, aerPct: 1.22 },
      ],
    })
    expect(marketOf(advantage)?.source).toBe('ccpc')
    expect(advantage.source_urls).toEqual([CCPC_TOOL])
    // The oldest check of the rows it rests on.
    expect(advantage.last_verified).toBe('2026-11-09')
    expect(advantage.pricing_and_rates['source_rate_as_of']).toBe('2026-11-09')
  })

  it('drops the catalogue’s own figures for every product the market covers', () => {
    const superSaver = product(products, 'savings.supersaver') as (typeof products)[number]

    expect(superSaver.pricing_and_rates['snapshot']).toBeUndefined()
    // Covered, but no record this time: no figure at all, never last month's.
    expect(rateOf(superSaver)).toBeNull()
  })

  it('lays only Bank of Ireland’s CCPC rows over the catalogue, paired by name', () => {
    for (const elsewhere of [
      record({ provider: 'aib' }),
      record({ source: 'bank' }),
      record({ providerProductName: 'Deposit Plus 6 Month Fixed Term Account' }),
    ]) {
      const over = withMarketData(demoKnowledgeBase.products, [elsewhere])
      expect(marketOf(product(over, 'savings.advantage_fixed') as (typeof over)[number])).toBeNull()
    }
  })

  it('reads CCPC’s two balance bands as the cap and the rate above it', () => {
    const goalSaver = catalogueRecords([
      record({
        productId: 'savings.c895',
        category: 'savings',
        providerProductName: 'GoalSaver Account',
        rates: {
          kind: 'deposit',
          aerPct: 2,
          basis: null,
          tiers: [
            { minEur: 20, maxEur: 14999, aerPct: 2 },
            { minEur: 15000, maxEur: 30000, aerPct: 0.5 },
          ],
        },
        conditions: { takesMonthly: true, minMonthlyEur: 20, maxMonthlyEur: 2000 },
      }),
    ]).get('savings.goalsaver')
    expect(goalSaver?.rates).toMatchObject({ tierCapEur: 15000, aboveTierAerPct: 0.5 })
  })

  it('leaves products the market does not cover as they were', () => {
    const card = product(demoKnowledgeBase.products, 'card.classic')
    expect(product(products, 'card.classic')).toBe(card)
  })

  it('is what the card, the engine and the prompt read', () => {
    expect(rateOf(advantage)).toEqual({
      headline: 'up to 1.22% AER fixed',
      note: '12m: 1.22%, 6m: 1.11%',
    })

    const option = savingsOptionsFrom(products).find((o) => o.id === 'savings.advantage_fixed')
    expect(option?.terms?.map((term) => term.months)).toEqual([6, 12])
    expect(option?.terms?.[0]?.annualRate).toBeCloseTo(0.0111, 6)
    expect(option?.terms?.[1]?.annualRate).toBeCloseTo(0.0122, 6)
    expect(option?.minLumpSum).toBe(7000)
    // No record, no option.
    expect(savingsOptionsFrom(products).map((o) => o.id)).toEqual(['savings.advantage_fixed'])
  })
})

describe('the combination follows the rates', () => {
  /*
   * The deposit stack needs MortgageSaver's bonus conditions in full. CCPC states the €2,000 and
   * the mortgage only, so with CCPC's rows there is no combination (2026-11-13); these rows
   * state the bonus in full to keep the arithmetic covered for a source that does.
   */
  const catalogue = (superSaverPct: number) =>
    withMarketData(demoKnowledgeBase.products, [
      record({
        productId: 'savings.c5047',
        category: 'savings',
        providerProductName: 'SuperSaver Account',
        rates: { kind: 'deposit', aerPct: superSaverPct, basis: 'fixed', fixedMonths: 12 },
        conditions: { takesMonthly: true, takesLumpSum: false },
      }),
      record({
        productId: 'savings.c583',
        category: 'savings',
        providerProductName: 'MortgageSaver Account',
        rates: {
          kind: 'deposit',
          aerPct: 2,
          basis: 'variable',
          tierCapEur: 15000,
          aboveTierAerPct: 0.5,
          lumpSumAerPct: 0.5,
        },
        conditions: {
          takesMonthly: true,
          takesLumpSum: true,
          minMonthlyEur: 200,
          maxMonthlyEur: 2500,
          bonus: {
            amountEur: 2000,
            lessDirt: true,
            firstTimeBuyerOnly: true,
            requiresMortgageHere: true,
            minMonthlyEur: 200,
            minMonths: 6,
            minTotalEur: 5000,
            withinMonths: 30,
          },
        },
      }),
    ])
  const stack = (superSaverPct: number) => combinationsFor(catalogue(superSaverPct))

  it('tells Saoirse to let them decide', () => {
    expect(combinationsSection(catalogue(3.5))).toMatch(/let them decide/)
  })

  it('quotes the record’s figures and works the gap out from them', () => {
    const text = stack(3.5)
      .flatMap((c) => c.because)
      .join(' ')
    expect(text).toContain('SuperSaver pays 3.5% AER fixed for the first 12 months')
    // (3.5% - 2%) on an average €6,500 held.
    expect(text).toContain('roughly €98 a year')
  })

  it('is withdrawn when SuperSaver no longer pays more', () => {
    expect(stack(1.5)).toEqual([])
  })
})

describe('the published set', () => {
  it('has a market record, from CCPC, on every product the market covers', () => {
    const records = catalogueRecords(ccpcSnapshot.products)
    expect([...records.keys()].sort()).toEqual([
      'savings.advantage_fixed',
      'savings.goalsaver',
      'savings.instant_access',
      'savings.mortgagesaver',
      'savings.notice_31_day',
      'savings.supersaver',
    ])
    for (const [id, market] of records) {
      expect(market.source, id).toBe('ccpc')
      expect(
        marketOf(product(publishedProducts, id) as (typeof publishedProducts)[number]),
      ).toEqual(market)
    }
  })
})

describe('market_products rows', () => {
  it('round-trip, and a row that no longer fits the schema is skipped', () => {
    const good = rowFor(record({}))
    const bad = {
      ...rowFor(record({ productId: 'savings.c895' })),
      rates: { kind: 'deposit' },
    }

    expect(productsFromRows([{ ...good, checked_at: '2026-11-09 10:00:00+00' }, bad])).toEqual([
      record({}),
    ])
  })
})
