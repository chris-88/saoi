import { describe, expect, it } from 'vitest'
import { demoMortgageRates } from '../tenants/demo/mortgage-rates.ts'
import { demoKnowledgeBase } from '../tenants/demo/knowledge-base.ts'
import {
  asOfFrom,
  canonical,
  differsFromPublished,
  productsFrom,
  publishedRates,
  ratesFrom,
} from './catalogue.ts'

describe('rows into a catalogue', () => {
  const product = demoKnowledgeBase.products[0]
  const rate = demoMortgageRates.rates[0]

  it('keeps a valid, enabled row and drops a disabled one', () => {
    const products = productsFrom([
      { id: product.id, product, enabled: true },
      { id: 'savings.off', product: { ...product, id: 'savings.off' }, enabled: false },
    ])
    expect(products.map((item) => item.id)).toEqual([product.id])
  })

  /** A row that stopped matching its schema is skipped, never handed to the prompt. */
  it('skips a row that no longer matches its schema', () => {
    const products = productsFrom([{ id: 'bad', product: { id: 'bad' }, enabled: true }])
    expect(products).toEqual([])

    const rates = ratesFrom([{ id: 'bad', rate: { id: 'bad' }, enabled: true }])
    expect(rates).toEqual([])
  })

  it('keeps a valid rate', () => {
    expect(ratesFrom([{ id: rate.id, rate, enabled: true }])).toEqual([rate])
  })
})

describe('the date a rate carries', () => {
  const published = '2025-11-26'
  const rate = demoMortgageRates.rates[0]

  it('is the published date while nothing has been edited', () => {
    expect(asOfFrom(published, [{ id: rate.id, rate, updated_at: '2026-10-16T10:00:00Z' }])).toBe(
      published,
    )
  })

  /** An edited rate is not "as of" last November. */
  it('is the latest edit once a row differs from the published set', () => {
    const edited = { ...rate, interest_rate_pct: rate.interest_rate_pct + 0.1 }
    expect(
      asOfFrom(published, [{ id: rate.id, rate: edited, updated_at: '2026-10-16T10:00:00Z' }]),
    ).toBe('2026-10-16')
  })

  it('counts a new row, which has no published counterpart, as an edit', () => {
    expect(asOfFrom(published, [{ id: 'new.row', rate, updated_at: '2026-10-15T09:00:00Z' }])).toBe(
      '2026-10-15',
    )
  })
})

describe('comparing a stored row with the published file', () => {
  /** jsonb hands keys back in its own order, which must not read as an edit. */
  it('ignores key order', () => {
    expect(canonical({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: null } })).toBe(
      canonical({ a: { c: null, d: [1, { e: 3, f: 2 }] }, b: 1 }),
    )
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]))
  })

  it('sees a published rate as unedited whatever order it comes back in', () => {
    const first = demoMortgageRates.rates[0]
    if (first === undefined) throw new Error('no rates')
    const shuffled = Object.fromEntries(Object.entries(first).reverse())
    expect(differsFromPublished(publishedRates(), first.id, shuffled)).toBe(false)
    expect(
      differsFromPublished(publishedRates(), first.id, { ...first, interest_rate_pct: 9.99 }),
    ).toBe(true)
    expect(differsFromPublished(publishedRates(), 'new.made_up', first)).toBe(true)
  })
})
