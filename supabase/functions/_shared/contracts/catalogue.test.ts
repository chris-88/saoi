import { describe, expect, it } from 'vitest'
import { demoKnowledgeBase } from '../tenants/demo/knowledge-base.ts'
import { demoMortgageRates } from '../tenants/demo/mortgage-rates.ts'
import { knowledgeProductSchema, mortgageRateSchema } from './catalogue.ts'

/**
 * The editor's boundary must accept the published data, every row of it.
 *
 * These schemas decide what a presenter may save. If they are stricter than the pack, the first
 * thing they refuse is Demo Bank's own catalogue, and "restore published" fails on the row
 * it is restoring.
 */
describe('the published catalogue passes its own schema', () => {
  it('accepts every compiled product', () => {
    for (const product of demoKnowledgeBase.products) {
      const parsed = knowledgeProductSchema.safeParse(product)
      expect(
        parsed.success,
        `${product.id}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues[0])}`,
      ).toBe(true)
    }
    expect(demoKnowledgeBase.products.length).toBeGreaterThan(20)
  })

  it('accepts every compiled mortgage rate', () => {
    for (const rate of demoMortgageRates.rates) {
      const parsed = mortgageRateSchema.safeParse(rate)
      expect(
        parsed.success,
        `${rate.id}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues[0])}`,
      ).toBe(true)
    }
    expect(demoMortgageRates.rates).toHaveLength(133)
  })
})

describe('what the editor refuses', () => {
  const product = demoKnowledgeBase.products[0]
  const rate = demoMortgageRates.rates[0]

  it('refuses an id that does not look like one', () => {
    expect(knowledgeProductSchema.safeParse({ ...product, id: 'SuperSaver' }).success).toBe(false)
    expect(knowledgeProductSchema.safeParse({ ...product, id: 'savings.' }).success).toBe(false)
  })

  it('refuses a rate that is not a number a bank would publish', () => {
    expect(mortgageRateSchema.safeParse({ ...rate, interest_rate_pct: -1 }).success).toBe(false)
    expect(mortgageRateSchema.safeParse({ ...rate, interest_rate_pct: 45 }).success).toBe(false)
    expect(mortgageRateSchema.safeParse({ ...rate, ber: 'A0' }).success).toBe(false)
    expect(mortgageRateSchema.safeParse({ ...rate, customer_types: [] }).success).toBe(false)
  })

  it('refuses a source that is not a url', () => {
    expect(
      knowledgeProductSchema.safeParse({ ...product, source_urls: ['the website'] }).success,
    ).toBe(false)
  })
})
