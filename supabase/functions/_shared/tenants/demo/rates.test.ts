import { describe, expect, it } from 'vitest'
import { demoKnowledgeBase } from './knowledge-base.ts'
import { rateOf } from './rates.ts'

const byId = (id: string) => {
  const product = demoKnowledgeBase.products.find((candidate) => candidate.id === id)
  expect(product, `${id} has gone from the pack`).toBeDefined()
  return product!
}

/**
 * For a deposit account the rate is the whole question.
 *
 * The comparison card showed features and no figure, which made three savings accounts look
 * interchangeable when one of them pays a full percentage point more than another.
 */
describe('reading a rate out of the pack', () => {
  it('leads with the introductory rate and says what follows it', () => {
    const rate = rateOf(byId('savings.supersaver'))

    expect(rate?.headline).toBe('3% AER fixed for 12 months')
    expect(rate?.note).toMatch(/then the standard/i)
  })

  it('quotes the tiered rate with the tier, not just the flattering half', () => {
    const rate = rateOf(byId('savings.mortgagesaver'))

    expect(rate?.headline).toBe('2% AER variable on monthly savings')
    // 0.5% above €15,000 is the part that decides whether the strategy is any good.
    expect(rate?.note).toContain('0.5%')
    expect(rate?.note).toContain('€15,000')
  })

  it('reads a plain variable rate', () => {
    expect(rateOf(byId('savings.instant_access'))?.headline).toBe('0.1% AER variable')
  })

  it('reads a term ladder, longest first', () => {
    const rate = rateOf(byId('savings.advantage_fixed'))

    expect(rate?.headline).toBe('up to 2.24% AER fixed')
    expect(rate?.note).toContain('6m: 1.51%')
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
    for (const product of demoKnowledgeBase.products) {
      const rate = rateOf(product)
      if (rate === null) continue

      expect(rate.headline.trim().length, product.id).toBeGreaterThan(2)
      expect(rate.headline, product.id).not.toContain('undefined')
      expect(rate.headline, product.id).not.toMatch(/NaN/)
    }
  })

  it('reads a figure for most of the savings family, which is the point', () => {
    const savings = demoKnowledgeBase.products.filter((p) => p.family === 'saving')
    const withRate = savings.filter((p) => rateOf(p) !== null)

    expect(withRate.length).toBeGreaterThanOrEqual(savings.length - 2)
  })
})
