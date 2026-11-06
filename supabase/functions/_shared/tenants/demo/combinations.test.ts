import { describe, expect, it } from 'vitest'
import { demoCombinations, combinationsSection } from './combinations.ts'
import { demoKnowledgeBase } from './knowledge-base.ts'
import { SURFACEABLE_PRODUCTS } from './kb-prompt.ts'

/**
 * A combination is a claim about two products at once, so both halves have to be true.
 *
 * The one here was prompted by a banker's instinct — MortgageSaver for the balance, SuperSaver
 * for the monthly, rotate after a year — and checking it against the pack changed it: a lump
 * sum in MortgageSaver earns the "other balance" rate of 0.5%, not the 2% headline, which only
 * applies to monthly contributions. The arrangement is still right; the reason is the €2,000
 * bonus rather than the rate.
 */
describe('product combinations', () => {
  it('only ever names products that exist and can be shown', () => {
    const ids = new Set(SURFACEABLE_PRODUCTS.map((product) => product.id))

    for (const combination of demoCombinations) {
      expect(combination.products.length).toBeGreaterThan(1)
      for (const id of combination.products) expect(ids.has(id), id).toBe(true)
    }
  })

  it('states the downside as well as the arithmetic', () => {
    for (const combination of demoCombinations) {
      expect(combination.because.length, combination.id).toBeGreaterThan(0)
      expect(combination.watch.length, combination.id).toBeGreaterThan(0)
    }
  })

  it('never tells the customer it is the right answer', () => {
    // The combination's own words, not the section's instructions — those contain "never say
    // it is the best thing to do", which a blunter check reads as a recommendation.
    const said = demoCombinations
      .flatMap((combination) => [...combination.how, ...combination.because, ...combination.watch])
      .join(' ')
      .toLowerCase()

    expect(said).not.toMatch(/\bbest\b|\byou should\b|\bwe recommend\b|\bideal\b/)
    expect(combinationsSection()).toMatch(/let them decide/)
  })

  it('quotes figures that match the catalogue', () => {
    const find = (id: string) => demoKnowledgeBase.products.find((p) => p.id === id)
    // The generated catalogue is `as const`, so each pricing object narrows to its own literal
    // shape and only some of them have a `snapshot`. Read it through the index signature.
    const snapshot = (id: string) => {
      const pricing = find(id)?.pricing_and_rates as Record<string, unknown> | undefined
      return (pricing?.['snapshot'] ?? {}) as Record<string, number | string>
    }

    const superSaver = snapshot('savings.supersaver')
    const mortgageSaver = snapshot('savings.mortgagesaver')
    const text = combinationsSection()

    // Every number quoted in the deposit stack, checked against where it came from.
    expect(superSaver['aer_fixed_first_12m_pct']).toBe(3)
    expect(mortgageSaver['regular_aer_variable_pct']).toBe(2)
    expect(mortgageSaver['other_balance_aer_pct']).toBe(0.5)
    expect(mortgageSaver['regular_tier_cap_eur']).toBe(15000)
    expect(mortgageSaver['ftb_bonus_before_dirt_eur']).toBe(2000)

    expect(text).toContain('3% AER fixed')
    expect(text).toContain('2% AER on monthly contributions')
    expect(text).toContain('0.5%')
    expect(text).toContain('€15,000 tier')
    expect(text).toContain('€2,000 before DIRT')
  })

  it('carries the bonus conditions, which are what the arrangement turns on', () => {
    const pricing = demoKnowledgeBase.products.find((p) => p.id === 'savings.mortgagesaver')
      ?.pricing_and_rates as Record<string, unknown> | undefined
    const conditions = pricing?.['bonus_conditions']

    expect(Array.isArray(conditions)).toBe(true)

    const text = combinationsSection()
    expect(text).toContain('€200 a month for six consecutive months')
    expect(text).toContain('30 months')
  })
})
