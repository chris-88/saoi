import { describe, expect, it } from 'vitest'
import { demoCombinations, combinationsSection } from './combinations.ts'
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
    // The section's own instructions are checked where there is a combination to carry them.
  })

  /*
   * The deposit stack quoted MortgageSaver's bonus conditions from Bank of Ireland's own page.
   * CCPC states the €2,000 and the mortgage, not the months, the minimum or the window, so since
   * CCPC is the only source (2026-11-13) there is no combination to quote: nothing is assumed.
   * Its arithmetic is covered in `market.test.ts` with rows that state the bonus in full.
   */
  it('offers no deposit stack while the bonus conditions are not stated', () => {
    expect(demoCombinations.map((combination) => combination.id)).not.toContain('deposit_stack')
    expect(combinationsSection()).toBe('')
  })
})
