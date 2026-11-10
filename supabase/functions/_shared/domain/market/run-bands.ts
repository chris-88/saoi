import type { HomeCalculatorRequest, HomeCalculatorResponse } from '../../contracts/market-tools.ts'
import { isLocalArea, type LocalArea } from '../../market/areas.ts'
import { monthsBetween } from './home-arithmetic.ts'
import type { AsOf } from './types.ts'

/**
 * The anonymous record of one home-calculator run (`calculator_runs`, decision
 * `2026-11-10-saoi-routes-card`): evidence for HomeOwn of who uses the calculator and how far
 * they are from the keys. Bands only: no raw figure, no identifier, no free text, the day and
 * never the time. A county is kept only when it is on the fixed list.
 */

export const INCOME_BANDS = ['<40k', '40-60k', '60-80k', '80-100k', '100-150k', '150k+'] as const
export const GAP_MONTHS_BANDS = ['0', '1-6', '7-12', '13-24', '25-48', '48+', 'never'] as const
export const RENT_BANDS = ['<1000', '1000-1500', '1500-2000', '2000-2500', '2500+'] as const
/** For a run where the figure the band rests on was not given. */
export const UNKNOWN_BAND = 'unknown'

export type IncomeBand = (typeof INCOME_BANDS)[number] | typeof UNKNOWN_BAND
export type GapMonthsBand = (typeof GAP_MONTHS_BANDS)[number] | typeof UNKNOWN_BAND
export type RentBand = (typeof RENT_BANDS)[number]

/** Gross income a year, both applicants together. Each band includes its lower bound. */
export function incomeBand(eur: number | null): IncomeBand {
  if (eur === null) return UNKNOWN_BAND
  if (eur < 40_000) return '<40k'
  if (eur < 60_000) return '40-60k'
  if (eur < 80_000) return '60-80k'
  if (eur < 100_000) return '80-100k'
  if (eur < 150_000) return '100-150k'
  return '150k+'
}

/**
 * Months from today to the month the cash at the keys is saved. `never`: a figure was needed
 * and is not reached at this pace. `unknown`: there was no figure to reach (no price).
 */
export function gapMonthsBand(months: number | null, needed: boolean): GapMonthsBand {
  if (!needed) return UNKNOWN_BAND
  if (months === null) return 'never'
  if (months <= 0) return '0'
  if (months <= 6) return '1-6'
  if (months <= 12) return '7-12'
  if (months <= 24) return '13-24'
  if (months <= 48) return '25-48'
  return '48+'
}

/** Rent a month. Each band includes its lower bound. Null: rent was not given. */
export function rentBand(eur: number | undefined): RentBand | null {
  if (eur === undefined) return null
  if (eur < 1_000) return '<1000'
  if (eur < 1_500) return '1000-1500'
  if (eur < 2_000) return '1500-2000'
  if (eur < 2_500) return '2000-2500'
  return '2500+'
}

/** The county, only when it is on the fixed list; anything else is never kept. */
export const countyOf = (value: unknown): LocalArea | null => (isLocalArea(value) ? value : null)

/** One `calculator_runs` row, as the table's columns. */
export type CalculatorRun = {
  readonly ran_on: string
  readonly kind: 'home'
  readonly income_band: IncomeBand
  readonly gap_months_band: GapMonthsBand
  readonly target_met: boolean | null
  readonly county: LocalArea | null
  readonly rent_band: RentBand | null
  readonly property_kind: NonNullable<HomeCalculatorRequest['propertyKind']> | null
  readonly first_time_buyer: boolean | null
}

/** The row for one home-calculator run: what the customer gave, banded, and the day. */
export function homeCalculatorRun(
  request: HomeCalculatorRequest,
  result: HomeCalculatorResponse,
  asOf: AsOf,
): CalculatorRun {
  const reached = result.figures.depositReachedOn
  return {
    ran_on: asOf.slice(0, 10),
    kind: 'home',
    income_band: incomeBand(result.figures.incomeEur),
    gap_months_band: gapMonthsBand(
      reached === null ? null : monthsBetween(asOf, reached),
      result.figures.neededAtKeysEur !== null,
    ),
    target_met: result.figures.targetDateMet,
    county: countyOf(request.county),
    rent_band: rentBand(request.monthlyRentEur),
    property_kind: request.propertyKind ?? null,
    first_time_buyer: request.firstTimeBuyer ?? null,
  }
}
