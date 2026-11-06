import { describe, expect, it } from 'vitest'
import { demoKnowledgeBase } from './knowledge-base.ts'
import {
  KB_DISCLAIMER,
  SURFACEABLE_PRODUCTS,
  knowledgeBaseSection,
  surfaceable,
} from './kb-prompt.ts'
import { demoProducts } from './products.ts'

/**
 * The catalogue Saoirse speaks from is real now, and that changes what it may claim.
 *
 * It used to be seven invented products behind a disclaimer saying every figure was made up.
 * That sentence was honest about the old catalogue and would be a lie about this one — in the
 * unusual direction of telling somebody that real published terms were invented.
 */
describe('the knowledge base', () => {
  it('is Demo Bank’s illustrative offering, dated by a stated as-of', () => {
    expect(demoKnowledgeBase.products.length).toBe(61)
    expect(String(demoKnowledgeBase.metadata.as_of)).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    for (const product of demoKnowledgeBase.products) {
      expect(product.source_urls.length, product.id).toBeGreaterThan(0)
      expect(product.last_verified, product.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('keeps back anything the pack says to verify first', () => {
    const held = demoKnowledgeBase.products.filter((product) => !surfaceable(product))

    // The pack flags exactly three, two of which its README names outright.
    expect(held.length).toBeGreaterThan(0)
    expect(held.map((p) => p.id)).toContain('current.young_saver')
    expect(SURFACEABLE_PRODUCTS.length).toBe(demoKnowledgeBase.products.length - held.length)

    const prompt = knowledgeBaseSection()
    for (const product of held) expect(prompt, product.id).not.toContain(`[${product.id}]`)
  })

  it('carries the per-product guardrails, not just the descriptions', () => {
    const prompt = knowledgeBaseSection()

    // Four of the six must_not_say lines are protection saying not to infer health, which is
    // Invariant 6 arrived at independently. Losing them in the rendering would be quiet.
    for (const product of SURFACEABLE_PRODUCTS) {
      for (const rule of product.assistant_usage.must_not_say ?? []) {
        expect(prompt, product.id).toContain(rule)
      }
    }
  })

  it('names what each product ends in, where that is not self-serve', () => {
    const prompt = knowledgeBaseSection()
    const regulated = SURFACEABLE_PRODUCTS.filter(
      (product) => product.advice_model !== 'information_or_self_serve',
    )

    expect(regulated.length).toBeGreaterThan(10)
    expect(prompt).toContain('you take it to the door, not through it')
  })
})

describe('what it may and may not claim', () => {
  const prompt = knowledgeBaseSection()

  it('describes the catalogue as illustrative synthetic figures for a demo bank', () => {
    expect(KB_DISCLAIMER).not.toMatch(/invented for a prototype/i)
    expect(KB_DISCLAIMER).toMatch(/illustrative synthetic retail offering/i)
  })

  it('still refuses to state a rate as current', () => {
    expect(KB_DISCLAIMER).toMatch(/Rates, APR, APRC, premiums, fees and promotions CANNOT/)
    expect(KB_DISCLAIMER).toMatch(/never as today’s rate/i)
  })

  it('keeps the calculation rates apart, and admits they are invented', () => {
    expect(prompt).toContain('# Rates used in calculations')
    expect(prompt).toMatch(/ILLUSTRATIVE and invented, unlike the catalogue above/)
  })

  it('states every rate the quote card can compute from', () => {
    for (const product of Object.values(demoProducts)) {
      for (const variant of product.variants ?? []) {
        expect(prompt, `${product.name}/${variant.name}`).toContain(variant.name)
      }
    }
  })

  it('still refuses to state an approval', () => {
    expect(KB_DISCLAIMER).toMatch(/Never state an eligibility decision, an approval/)
  })
})
