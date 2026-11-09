import { describe, expect, it } from 'vitest'
import { boiSnapshot } from '../../market/boi.snapshot.ts'
import type { MarketProduct } from '../../market/schema.ts'
import { productsFromRows, rowFor } from '../../db/market.ts'
import { combinationsFor } from './combinations.ts'
import { demoKnowledgeBase } from './knowledge-base.ts'
import { marketOf, publishedProducts, withMarketData } from './market.ts'
import { rateOf } from './rates.ts'
import { savingsOptionsFrom } from './savings-options.ts'

/**
 * Market data is the only source of a figure for a product the refresh covers. These pin the
 * overlay with a record that is not the committed snapshot, so they prove the consumers read
 * the record and not the catalogue, and they keep passing when the site's rates move.
 */

const record = (overrides: Partial<MarketProduct>): MarketProduct => ({
  provider: 'boi',
  source: 'bank',
  productId: 'savings.advantage_fixed',
  category: 'deposit',
  providerProductName: 'Advantage Fixed Term Deposit Account',
  rates: {
    kind: 'deposit',
    aerPct: null,
    basis: 'fixed',
    terms: [
      { months: 6, aerPct: 1.11 },
      { months: 12, aerPct: 1.22 },
    ],
  },
  conditions: { takesMonthly: false, takesLumpSum: true, minLumpSumEur: 7000 },
  sourceUrl: 'https://personalbanking.bankofireland.com/advantage/',
  checkedAt: '2026-11-09T10:00:00.000Z',
  effectiveFrom: null,
  ...overrides,
})

const product = (products: readonly { id: string }[], id: string) => {
  const found = products.find((candidate) => candidate.id === id)
  expect(found, id).toBeDefined()
  return found!
}

describe('laying market data over the catalogue', () => {
  const products = withMarketData(demoKnowledgeBase.products, [record({})])
  const advantage = product(products, 'savings.advantage_fixed') as (typeof products)[number]

  it('carries the record, its source and the date it was checked', () => {
    expect(marketOf(advantage)?.rates).toMatchObject({
      terms: [{ aerPct: 1.11 }, { aerPct: 1.22 }],
    })
    expect(advantage.source_urls).toEqual(['https://personalbanking.bankofireland.com/advantage/'])
    expect(advantage.last_verified).toBe('2026-11-09')
    expect(advantage.pricing_and_rates['source_rate_as_of']).toBe('2026-11-09')
  })

  it('drops the catalogue’s own figures for every product the market covers', () => {
    const superSaver = product(products, 'savings.supersaver') as (typeof products)[number]

    expect(superSaver.pricing_and_rates['snapshot']).toBeUndefined()
    // Covered, but no record this time: no figure at all, never last month's.
    expect(rateOf(superSaver)).toBeNull()
  })

  it('lays only Bank of Ireland records read from its own site over the catalogue', () => {
    for (const elsewhere of [record({ provider: 'aib' }), record({ source: 'ccpc' })]) {
      const over = withMarketData(demoKnowledgeBase.products, [elsewhere])
      expect(marketOf(product(over, 'savings.advantage_fixed') as (typeof over)[number])).toBeNull()
    }
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
  const stack = (superSaverPct: number) =>
    combinationsFor(
      withMarketData(demoKnowledgeBase.products, [
        record({
          productId: 'savings.supersaver',
          category: 'savings',
          rates: { kind: 'deposit', aerPct: superSaverPct, basis: 'fixed', fixedMonths: 12 },
          conditions: { takesMonthly: true, takesLumpSum: false },
        }),
        ...boiSnapshot.products.filter((p) => p.productId === 'savings.mortgagesaver'),
      ]),
    )

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
  it('has a market record on every product the refresh covers', () => {
    for (const market of boiSnapshot.products) {
      expect(
        marketOf(
          product(publishedProducts, market.productId) as (typeof publishedProducts)[number],
        ),
      ).toEqual(market)
    }
  })
})

describe('market_products rows', () => {
  it('round-trip, and a row that no longer fits the schema is skipped', () => {
    const good = rowFor(record({}))
    const bad = {
      ...rowFor(record({ productId: 'savings.goalsaver' })),
      rates: { kind: 'deposit' },
    }

    expect(productsFromRows([{ ...good, checked_at: '2026-11-09 10:00:00+00' }, bad])).toEqual([
      record({}),
    ])
  })
})
