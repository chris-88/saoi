import { describe, expect, it } from 'vitest'
import { taxPaidEstimateSchema } from '../../contracts/market-tools.ts'
import { adviceWordsIn } from '../../market/disclosures.ts'
import { HELP_TO_BUY } from '../../market/first-home-rules.ts'
import { INCOME_TAX_YEARS, incomeTaxYear } from '../../market/income-tax-rules.ts'
import {
  estimateTaxPaid,
  incomeTaxFor,
  incomesOf,
  resolveTaxPaid,
  taxLimitsHelpToBuyBy,
} from './tax-paid.ts'

const year = (y: number) => {
  const found = INCOME_TAX_YEARS.find((r) => r.year === y)
  if (found === undefined) throw new Error(`no ${String(y)}`)
  return found
}

describe('income tax for one year', () => {
  it('taxes a single PAYE earner on Revenue’s 2025 band and credits', () => {
    // €50,000: 20% of €44,000 (€8,800) + 40% of €6,000 (€2,400) = €11,200, less €4,000 credits.
    expect(incomeTaxFor(50_000, year(2025))).toBe(7_200)
  })
  it('is never below zero: the credits cover a low income', () => {
    // €15,000 at 20% is €3,000, under the €3,400 credits of 2022.
    expect(incomeTaxFor(15_000, year(2022))).toBe(0)
  })
  it('falls back to the nearest year on the chart and says so', () => {
    expect(incomeTaxYear(2025).onChart).toBe(true)
    expect(incomeTaxYear(2030)).toEqual({ rules: year(2026), onChart: false })
    expect(incomeTaxYear(2019)).toEqual({ rules: year(2022), onChart: false })
  })
})

describe('the tax-paid estimate', () => {
  it('sums the four tax years before an application this year, oldest first', () => {
    const estimate = estimateTaxPaid({ incomesEur: [50_000], asOf: '2026-11-19' })
    expect(estimate).not.toBeNull()
    if (estimate === null) return
    expect(() => taxPaidEstimateSchema.parse(estimate)).not.toThrow()
    expect(estimate.applicationYear).toBe(2026)
    expect(estimate.years.map((y) => y.year)).toEqual([2022, 2023, 2024, 2025])
    // 2022: 7,360 + 5,280 − 3,400 = 9,240. 2023: 8,000 + 4,000 − 3,550 = 8,450.
    // 2024: 8,400 + 3,200 − 3,750 = 7,850. 2025: 8,800 + 2,400 − 4,000 = 7,200.
    expect(estimate.years.map((y) => y.taxEur)).toEqual([9_240, 8_450, 7_850, 7_200])
    expect(estimate.totalEur).toBe(32_740)
    expect(estimate.line).toBe(
      'About €32,740 of Income Tax over 2022 to 2025, estimated from €50,000 a year.',
    )
    expect(estimate.check).toMatch(/Statement of Liability/)
    expect(estimate.assumptions.join(' ')).toMatch(/same in each year/)
    expect(estimate.assumptions.join(' ')).toMatch(
      /no pension contributions, no joint assessment, no Rent Tax Credit/,
    )
    expect(estimate.assumptions.join(' ')).toMatch(/DIRT/)
    expect(
      adviceWordsIn([estimate.line, estimate.check, ...estimate.assumptions].join(' ')),
    ).toEqual([])
  })
  it('taxes two applicants singly, each on their own income', () => {
    const two = estimateTaxPaid({ incomesEur: [50_000, 50_000], asOf: '2026-11-19' })
    const one = estimateTaxPaid({ incomesEur: [100_000], asOf: '2026-11-19' })
    expect(two?.totalEur).toBe(65_480)
    // One earner on €100,000 pays more than two on €50,000: the band is used once.
    expect(one?.totalEur ?? 0).toBeGreaterThan(two?.totalEur ?? 0)
    expect(two?.incomesEur).toEqual([50_000, 50_000])
    expect(two?.line).toMatch(/€50,000 and €50,000 a year/)
  })
  it('splits one joint figure evenly: the least tax two people pay on it', () => {
    expect(incomesOf(100_000, true)).toEqual([50_000, 50_000])
    expect(incomesOf(100_000, false)).toEqual([100_000])
    expect(incomesOf(100_000, undefined)).toEqual([100_000])
    expect(incomesOf(undefined, true)).toEqual([])
  })
  it('is nothing without an income', () => {
    expect(estimateTaxPaid({ incomesEur: [], asOf: '2026-11-19' })).toBeNull()
    expect(estimateTaxPaid({ incomesEur: [0], asOf: '2026-11-19' })).toBeNull()
  })
  it('states a year it had to take from the nearest chart year', () => {
    const estimate = estimateTaxPaid({ incomesEur: [50_000], asOf: '2028-03-01' })
    expect(estimate?.years.map((y) => y.year)).toEqual([2024, 2025, 2026, 2027])
    expect(estimate?.years[3]).toEqual({ year: 2027, chartYear: 2026, taxEur: 7_200 })
    expect(estimate?.assumptions.join(' ')).toMatch(/not on Revenue’s chart \(2027\)/)
  })
})

describe('resolving tax paid', () => {
  it('prefers the figure given, then the estimate, then nothing', () => {
    expect(resolveTaxPaid(12_000, { incomesEur: [50_000], asOf: '2026-11-19' })).toEqual({
      basis: 'given',
      eur: 12_000,
      estimate: null,
    })
    const estimated = resolveTaxPaid(undefined, { incomesEur: [50_000], asOf: '2026-11-19' })
    expect(estimated.basis).toBe('estimated')
    expect(estimated.eur).toBe(32_740)
    expect(resolveTaxPaid(undefined, { incomesEur: [], asOf: '2026-11-19' })).toEqual({
      basis: 'not_given',
      eur: undefined,
      estimate: null,
    })
  })
  it('says how much of the Help to Buy the tax paid takes away, if any', () => {
    expect(taxLimitsHelpToBuyBy(HELP_TO_BUY.capEur, 32_740)).toBe(2_260)
    expect(taxLimitsHelpToBuyBy(30_000, 32_740)).toBe(0)
  })
})
