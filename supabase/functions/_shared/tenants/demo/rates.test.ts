import { describe, expect, it } from 'vitest'
import { boiSnapshot } from '../../market/boi.snapshot.ts'
import { publishedProducts } from './market.ts'
import { rateOf } from './rates.ts'

const byId = (id: string) => {
  const product = publishedProducts.find((candidate) => candidate.id === id)
  expect(product, `${id} has gone from the pack`).toBeDefined()
  return product!
}

/**
 * For a deposit account the rate is the whole question.
 *
 * The comparison card showed features and no figure, which made three savings accounts look
 * interchangeable when one of them pays a full percentage point more than another.
 */
/** The figures as the committed market snapshot has them, so these hold when the site moves. */
const market = (id: string) => {
  const record = boiSnapshot.products.find((candidate) => candidate.productId === id)
  expect(record, `${id} has gone from the market snapshot`).toBeDefined()
  return record!.rates
}

describe('reading a rate out of the pack', () => {
  it('leads with the introductory rate and says what follows it', () => {
    const rate = rateOf(byId('savings.supersaver'))

    expect(rate?.headline).toBe(
      `${String(market('savings.supersaver').aerPct)}% AER fixed for 12 months`,
    )
    expect(rate?.note).toMatch(/then the standard/i)
  })

  it('quotes the tiered rate with the tier, not just the flattering half', () => {
    const rate = rateOf(byId('savings.mortgagesaver'))

    const rates = market('savings.mortgagesaver')

    expect(rate?.headline).toBe(`${String(rates.aerPct)}% AER variable on monthly savings`)
    // 0.5% above €15,000 is the part that decides whether the strategy is any good.
    expect(rate?.note).toContain(`${String(rates.aboveTierAerPct)}%`)
    expect(rate?.note).toContain(`€${(rates.tierCapEur ?? 0).toLocaleString('en-IE')}`)
  })

  it('reads a plain variable rate', () => {
    expect(rateOf(byId('savings.instant_access'))?.headline).toBe(
      `${String(market('savings.instant_access').aerPct)}% AER variable`,
    )
  })

  it('reads a term ladder, longest first', () => {
    const rate = rateOf(byId('savings.advantage_fixed'))

    const terms = market('savings.advantage_fixed').terms ?? []
    const best = Math.max(...terms.map((term) => term.aerPct))
    const six = terms.find((term) => term.months === 6)

    expect(rate?.headline).toBe(`up to ${String(best)}% AER fixed`)
    expect(rate?.note).toContain(`6m: ${String(six?.aerPct)}%`)
    expect(rate?.note?.indexOf('18m')).toBe(0)
  })

  it('leads a card on the APR a customer is actually shown', () => {
    const rate = rateOf(byId('card.classic'))

    expect(rate?.headline).toBe('22.1% APR typical')
    expect(rate?.note).toContain('16.12%')
  })

  it('reads a monthly fee where that is the figure that matters', () => {
    expect(rateOf(byId('current.personal'))?.headline).toBe('€6 a month')
    expect(rateOf(byId('current.basic'))?.headline).toBe('No monthly fee')
  })

  it('returns nothing rather than inventing one', () => {
    // The pack carries no mortgage rate table and no premiums, and says so itself.
    expect(rateOf(byId('mortgage.first_time_buyer'))).toBeNull()
    expect(rateOf(byId('protection.mortgage'))).toBeNull()
  })

  it('never produces an empty or malformed headline', () => {
    for (const product of publishedProducts) {
      const rate = rateOf(product)
      if (rate === null) continue

      expect(rate.headline.trim().length, product.id).toBeGreaterThan(2)
      expect(rate.headline, product.id).not.toContain('undefined')
      expect(rate.headline, product.id).not.toMatch(/NaN/)
    }
  })

  it('reads a figure for most of the savings family, which is the point', () => {
    const savings = publishedProducts.filter((p) => p.family === 'saving')
    const withRate = savings.filter((p) => rateOf(p) !== null)

    expect(withRate.length).toBeGreaterThanOrEqual(savings.length - 2)
  })
})
