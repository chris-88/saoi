import { HELP_TO_BUY } from '../../market/first-home-rules.ts'
import {
  INCOME_TAX_SOURCES,
  incomeTaxYear,
  type IncomeTaxYear,
} from '../../market/income-tax-rules.ts'
import type { TaxPaidEstimate } from '../../contracts/market-tools.ts'
import { euro } from './figures.ts'
import { round2 } from './simulate.ts'
import type { AsOf } from './types.ts'

/**
 * Help to Buy is capped at the Income Tax and DIRT paid over the four tax years before the
 * application, a figure almost no one knows offhand (Chris, 2026-11-19: "roughly calc a user's
 * tax paid over the last few years to show them if they qualify"). This works it out from the
 * gross income the customer gave, year by year on Revenue's own bands and credits, so a new-build
 * result can carry a Help to Buy figure instead of "depends on tax paid, not given".
 *
 * An estimate, stated as one: the income is taken as the same in each of the four years, each
 * applicant is taxed singly as a PAYE employee with the personal and Employee credits, and nothing
 * else: no pension contributions, no joint assessment, no Rent Tax Credit or other reliefs (each
 * would lower it), and no DIRT. The real figure is on each year's Statement of Liability in
 * myAccount; a tax-paid figure given replaces the estimate everywhere. For most buyers the
 * estimate is well above the cap or 10% of the price, and then it is the cap, not the tax, that
 * sets the refund; `taxLimitsHelpToBuyBy` says how much the tax takes off when it does.
 */

export const TAX_PAID_CHECK =
  'The exact figure is on each year’s Statement of Liability under Review your tax in Revenue myAccount; a figure given replaces this estimate.'

/** Income Tax for one person for one year: the bands, less the credits, never below zero. */
export function incomeTaxFor(grossEur: number, rules: IncomeTaxYear): number {
  const atStandard = Math.min(grossEur, rules.standardRateBandEur)
  const atHigher = Math.max(0, grossEur - rules.standardRateBandEur)
  const gross = (atStandard * rules.standardRatePct) / 100 + (atHigher * rules.higherRatePct) / 100
  return round2(Math.max(0, gross - rules.personalCreditEur - rules.employeeCreditEur))
}

export type TaxPaidEstimateInput = {
  /** Gross income a year for each applicant, each taxed singly. */
  readonly incomesEur: readonly number[]
  readonly asOf: AsOf
}

/** Null when no income was given (or it is all zero): nothing to estimate from. */
export function estimateTaxPaid(input: TaxPaidEstimateInput): TaxPaidEstimate | null {
  const incomes = input.incomesEur.filter((g) => g > 0)
  if (incomes.length === 0) return null
  const applicationYear = Number(input.asOf.slice(0, 4))
  const taxYears = Array.from(
    { length: HELP_TO_BUY.taxYears },
    (_, i) => applicationYear - HELP_TO_BUY.taxYears + i,
  )
  let offChart = false
  const years = taxYears.map((year) => {
    const { rules, onChart } = incomeTaxYear(year)
    if (!onChart) offChart = true
    const taxEur = incomes.reduce((sum, gross) => sum + incomeTaxFor(gross, rules), 0)
    return { year, chartYear: rules.year, taxEur: round2(taxEur) }
  })
  const totalEur = round2(years.reduce((sum, y) => sum + y.taxEur, 0))
  const first = taxYears[0] ?? applicationYear
  const last = taxYears[taxYears.length - 1] ?? applicationYear
  const incomeWords =
    incomes.length === 1
      ? `${euro(incomes[0] ?? 0)} a year`
      : `${incomes.map((g) => euro(g)).join(' and ')} a year`
  const assumptions = [
    `The income (${incomeWords}) is taken as the same in each year from ${String(first)} to ${String(last)}, the four tax years before an application this year.`,
    `${incomes.length === 1 ? 'Taxed singly' : 'Each taxed singly'} as a PAYE employee with the personal and Employee credits only: no pension contributions, no joint assessment, no Rent Tax Credit and no other reliefs, each of which would lower the figure.`,
    'DIRT on savings interest also counts towards Help to Buy and is not estimated here.',
    ...(offChart
      ? [
          `A year not on Revenue’s chart (${taxYears
            .filter((y) => years.find((r) => r.year === y)?.chartYear !== y)
            .map(String)
            .join(', ')}) is taken on the nearest year’s bands and credits.`,
        ]
      : []),
  ]
  return {
    totalEur,
    applicationYear,
    years,
    incomesEur: incomes,
    line: `About ${euro(totalEur)} of Income Tax over ${String(first)} to ${String(last)}, estimated from ${incomeWords}.`,
    check: TAX_PAID_CHECK,
    assumptions,
    sources: [...INCOME_TAX_SOURCES],
  }
}

/** Tax paid as a result rests on it: the figure given, else the estimate, else nothing. */
export type TaxPaid =
  | { readonly basis: 'given'; readonly eur: number; readonly estimate: null }
  | { readonly basis: 'estimated'; readonly eur: number; readonly estimate: TaxPaidEstimate }
  | { readonly basis: 'not_given'; readonly eur: undefined; readonly estimate: null }

export function resolveTaxPaid(
  given: number | undefined,
  estimateFrom: TaxPaidEstimateInput,
): TaxPaid {
  if (given !== undefined) return { basis: 'given', eur: given, estimate: null }
  const estimate = estimateTaxPaid(estimateFrom)
  if (estimate === null) return { basis: 'not_given', eur: undefined, estimate: null }
  return { basis: 'estimated', eur: estimate.totalEur, estimate }
}

/** One gross figure for two applicants is split evenly: the least tax two people pay on it. */
export function incomesOf(
  annualGrossEur: number | undefined,
  joint: boolean | undefined,
): readonly number[] {
  if (annualGrossEur === undefined) return []
  return joint === true ? [annualGrossEur / 2, annualGrossEur / 2] : [annualGrossEur]
}

/**
 * How far the estimate is from mattering: Help to Buy at a price is the lesser of the share of
 * the price, the cap and the tax paid, so the tax sets it only below `upTo`. Positive when the
 * estimate is the limit (the amount lost against `upTo`); zero when the cap or the price is.
 */
export function taxLimitsHelpToBuyBy(upToEur: number, taxPaidEur: number): number {
  return round2(Math.max(0, upToEur - taxPaidEur))
}
