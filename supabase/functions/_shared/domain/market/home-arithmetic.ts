import { BUYING_COSTS } from '../../market/mortgage-incentives.ts'
import { addMonths, round2 } from './simulate.ts'
import type { AsOf } from './types.ts'

/**
 * The arithmetic of the cash at the keys, shared by the home calculator's headline and the
 * routes (`routes.ts`), so a route's keys date and the headline's agree on the same inputs.
 * Savings are counted before interest (stated where it is shown).
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** "June 2028" for "2028-06". */
export const monthName = (yyyyMm: string): string => {
  const [year, month] = yyyyMm.split('-')
  return `${MONTHS[Number(month) - 1] ?? month ?? ''} ${year ?? ''}`.trim()
}

/** "Jun 2028" for "2028-06": the short form a route line fits in. */
export const shortMonth = (yyyyMm: string): string => {
  const [year, month] = yyyyMm.split('-')
  return `${(MONTHS[Number(month) - 1] ?? month ?? '').slice(0, 3)} ${year ?? ''}`.trim()
}

/** Whole months from the month of `from` to `yyyyMm` (0 for the same month; never negative). */
export function monthsBetween(from: AsOf, yyyyMm: string): number {
  const a = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1
  const b = Number(yyyyMm.slice(0, 4)) * 12 + Number(yyyyMm.slice(5, 7)) - 1
  return Math.max(0, b - a)
}

export const stampDutyAt = (price: number): number =>
  round2((price * BUYING_COSTS.stampDutyPct) / 100)

export type KeysFigures = {
  readonly loanEur: number
  readonly depositEur: number
  readonly stampDutyEur: number
  /** Deposit plus stamp duty and fees, less Help to Buy counted. */
  readonly neededEur: number
  /** YYYY-MM it is saved at this pace; null when it never is. */
  readonly reachedOn: string | null
}

/** The cash needed at the keys for a price and the month it is saved, before interest. */
export function keysAt(
  input: {
    readonly priceEur: number
    /** The Central Bank income limit; null when no income was given. */
    readonly maxLoanEur: number | null
    readonly maxLtvPct: number
    readonly savedEur: number
    readonly monthlyEur: number
    /** Help to Buy counted towards the deposit (0 when it is not). */
    readonly helpToBuyEur: number
  },
  asOf: AsOf,
): KeysFigures {
  const loan = round2(
    Math.min((input.priceEur * input.maxLtvPct) / 100, input.maxLoanEur ?? Infinity),
  )
  const deposit = round2(input.priceEur - loan)
  const stamp = stampDutyAt(input.priceEur)
  const needed = round2(
    Math.max(0, deposit + stamp + BUYING_COSTS.legalAndSurveyEur - input.helpToBuyEur),
  )
  let reachedOn: string | null = null
  if (input.savedEur >= needed) reachedOn = addMonths(asOf, 0)
  else if (input.monthlyEur > 0) {
    reachedOn = addMonths(asOf, Math.ceil((needed - input.savedEur) / input.monthlyEur))
  }
  return { loanEur: loan, depositEur: deposit, stampDutyEur: stamp, neededEur: needed, reachedOn }
}
