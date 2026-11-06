import { describe, expect, it } from 'vitest'
import { demoProducts } from './products.ts'

/**
 * The catalogue against itself.
 *
 * A product with variants has its rates in two places the moment somebody writes one into
 * `illustrativeTerms` as well, and the two drift silently: the mortgage advertised "3.85% for 3
 * years" in prose while the card offered 3.1%, 3.3%, 3.4% and 3.9%. Saoirse read both, quoted the
 * prose, and told the customer to go by the card — looking wrong because the data was.
 */
describe('the product catalogue', () => {
  const withVariants = Object.values(demoProducts).filter(
    (product) => (product.variants ?? []).length > 0,
  )

  it('has variants on the products that have figures worth comparing', () => {
    expect(withVariants.length).toBeGreaterThan(0)
  })

  it('never states an interest rate in prose as well as in a variant', () => {
    for (const product of withVariants) {
      for (const term of product.illustrativeTerms) {
        // Only rate labels. "5% of the balance" is a minimum repayment, which no variant
        // carries, so prose is the right and only home for it.
        if (!/\brate\b|\bAPR\b/i.test(term.label)) continue

        expect(
          term.value,
          `${product.name}: "${term.label}" restates a rate the variants already hold`,
        ).not.toMatch(/\d\s*%/)
      }
    }
  })

  it('never contradicts its own variants about the term on offer', () => {
    for (const product of withVariants) {
      const longest = Math.max(...(product.variants ?? []).map((variant) => variant.maxMonths ?? 0))

      for (const term of product.illustrativeTerms) {
        const years = /(\d+)\s*(?:to\s*\d+\s*)?years?/.exec(term.value)
        if (years === null || !/term/i.test(term.label)) continue

        // A prose term shorter than a variant on sale is how "1 to 5 years" ended up beside a
        // seven-year loan.
        const stated = Number(years[1] ?? 0)
        const upTo = /up to/i.test(term.value) ? stated : stated
        expect(
          upTo * 12,
          `${product.name}: prose says ${term.value}, a variant runs to ${String(longest)} months`,
        ).toBeGreaterThanOrEqual(longest)
      }
    }
  })

  it('gives every variant a rate and a name, which the quote card renders', () => {
    for (const product of withVariants) {
      for (const variant of product.variants ?? []) {
        expect(variant.name.length, product.name).toBeGreaterThan(0)
        expect(variant.annualRate, `${product.name}/${variant.name}`).toBeGreaterThan(0)
        expect(variant.annualRate, `${product.name}/${variant.name}`).toBeLessThan(1)
      }
    }
  })
})
