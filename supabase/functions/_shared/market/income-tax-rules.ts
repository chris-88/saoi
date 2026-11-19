/**
 * Irish Income Tax for a PAYE employee, as data the Help to Buy estimate reads: the standard
 * rate band, the two rates and the credits that apply to almost everyone, for the tax years an
 * application made this year or next looks back on. Read from Revenue's "Tax rates, bands and
 * reliefs" chart on 2026-11-19 (published 1 January 2026; it notes the Budget of 6 October 2026
 * without saying which figures move, so 2026 is as printed and 2027 is not on it).
 *
 * What is modelled: single assessment and the personal and Employee (PAYE) credits. Not modelled,
 * and stated in every estimate: joint assessment of a married couple, pension contributions, the
 * Rent Tax Credit and other credits and reliefs (each lowers the figure), and DIRT (which counts
 * for Help to Buy but is not estimated). Rent is left out on purpose: rent a month is an input
 * that changes no figure (CLAUDE.md), and the credit is at most €3,000 over four years. The Earned
 * Income credit for the self-employed equals the Employee credit in every year here, so a
 * self-employed applicant gets the same figure.
 */

import type { RuleSource } from './first-home-rules.ts'

export type IncomeTaxYear = {
  readonly year: number
  /** The most taxed at the standard rate, single or widowed without qualifying children. */
  readonly standardRateBandEur: number
  readonly standardRatePct: number
  readonly higherRatePct: number
  /** The personal tax credit, single. A married couple's is double, which is not modelled. */
  readonly personalCreditEur: number
  /** The Employee (PAYE) tax credit; the Earned Income credit is the same amount each year. */
  readonly employeeCreditEur: number
}

const CHECKED = '2026-11-19'
const CHART =
  'https://www.revenue.ie/en/personal-tax-credits-reliefs-and-exemptions/tax-relief-charts/index.aspx'

export const INCOME_TAX_YEARS: readonly IncomeTaxYear[] = [
  {
    year: 2022,
    standardRateBandEur: 36_800,
    standardRatePct: 20,
    higherRatePct: 40,
    personalCreditEur: 1_700,
    employeeCreditEur: 1_700,
  },
  {
    year: 2023,
    standardRateBandEur: 40_000,
    standardRatePct: 20,
    higherRatePct: 40,
    personalCreditEur: 1_775,
    employeeCreditEur: 1_775,
  },
  {
    year: 2024,
    standardRateBandEur: 42_000,
    standardRatePct: 20,
    higherRatePct: 40,
    personalCreditEur: 1_875,
    employeeCreditEur: 1_875,
  },
  {
    year: 2025,
    standardRateBandEur: 44_000,
    standardRatePct: 20,
    higherRatePct: 40,
    personalCreditEur: 2_000,
    employeeCreditEur: 2_000,
  },
  {
    year: 2026,
    standardRateBandEur: 44_000,
    standardRatePct: 20,
    higherRatePct: 40,
    personalCreditEur: 2_000,
    employeeCreditEur: 2_000,
  },
]

export const INCOME_TAX_SOURCES: readonly RuleSource[] = [
  {
    fact: 'Standard rate band, single: €36,800 (2022), €40,000 (2023), €42,000 (2024), €44,000 (2025 and 2026), balance at 40%; personal and Employee credits €1,700, €1,775, €1,875, €2,000, €2,000',
    url: CHART,
    checkedOn: CHECKED,
  },
  {
    fact: 'Where to find the actual figure: the Statement of Liability for each year, under Review your tax in Revenue myAccount',
    url: 'https://www.revenue.ie/en/online-services/services/paye-services/review-your-tax.aspx',
    checkedOn: CHECKED,
  },
]

/**
 * The year's rules. A year the chart does not have takes its nearest year (the latest for a later
 * one, the earliest for an earlier one) and says so, for the caller to state.
 */
export function incomeTaxYear(year: number): { rules: IncomeTaxYear; onChart: boolean } {
  const exact = INCOME_TAX_YEARS.find((y) => y.year === year)
  if (exact !== undefined) return { rules: exact, onChart: true }
  const first = INCOME_TAX_YEARS[0]
  const latest = INCOME_TAX_YEARS[INCOME_TAX_YEARS.length - 1]
  if (first === undefined || latest === undefined) throw new Error('income tax chart is empty')
  return { rules: year > latest.year ? latest : first, onChart: false }
}
