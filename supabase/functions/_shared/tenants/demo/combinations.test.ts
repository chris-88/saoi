import { describe, expect, it } from 'vitest'
import { demoCombinations, combinationsSection } from './combinations.ts'
import { boiSnapshot } from '../../market/boi.snapshot.ts'
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

  it('quotes figures that match the market records', () => {
    const market = (id: string) => {
      const record = boiSnapshot.products.find((p) => p.productId === id)
      expect(record, id).toBeDefined()
      return record!
    }
    const superSaver = market('savings.supersaver').rates
    const mortgageSaver = market('savings.mortgagesaver')
    const euro = (n: number | undefined) => `€${(n ?? 0).toLocaleString('en-IE')}`
    const text = combinationsSection()

    // Every number quoted in the deposit stack, checked against where it came from.
    expect(text).toContain(`${String(superSaver.aerPct)}% AER fixed`)
    expect(text).toContain(`${String(mortgageSaver.rates.aerPct)}% AER on monthly contributions`)
    expect(text).toContain(`${String(mortgageSaver.rates.aboveTierAerPct)}%`)
    expect(text).toContain(`${euro(mortgageSaver.rates.tierCapEur)} tier`)
    expect(text).toContain(`${euro(mortgageSaver.conditions.bonus?.amountEur)} before DIRT`)
  })

  it('carries the bonus conditions, which are what the arrangement turns on', () => {
    const bonus = boiSnapshot.products.find((p) => p.productId === 'savings.mortgagesaver')
      ?.conditions.bonus

    expect(bonus).toMatchObject({ minMonthlyEur: 200, minMonths: 6, withinMonths: 30 })

    const text = combinationsSection()
    expect(text).toContain('€200 a month for six consecutive months')
    expect(text).toContain('30 months')
  })
})
