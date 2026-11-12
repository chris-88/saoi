import type { DepositTerms } from '../../contracts/market-tools.ts'
import { euro } from './figures.ts'
import { monthName, shortMonth } from './home-arithmetic.ts'
import { pct } from './product.ts'
import { addMonths } from './simulate.ts'
import type { AsOf } from './types.ts'

/**
 * How long a savings rate holds within the months a figure runs to (2026-11-12: a card showed
 * bunq's 3.11% as the headline beside "€581 by Jul 2028", and the customer read it as a rate
 * that would not be realised). The money (`simulateDeposit`) already counts a bonus or an
 * introductory rate for as long as the product states it, then the rate after it where stated,
 * and stops where it is not; this names that period so a card and a sentence can say so.
 *
 * A period is returned only when it ends before the figures do: a rate that holds to the date
 * has nothing to say about its end. A fixed term is not a period here (its term is its kind).
 * Pure.
 */

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const MONTHS_LONG = [
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

export type RatePeriod = {
  /** `bonus`: a threshold bonus (bunq) until its first reset; `introductory`: a stated period. */
  readonly kind: 'bonus' | 'introductory'
  /** The months of the projection the rate lasts. */
  readonly months: number
  /** The end, short, for the card's value: "1 Jan", "Feb 2027". */
  readonly endsShort: string
  /** The end, for a sentence: "1 January", "February 2027". */
  readonly endsLong: string
  /** The rate after it in words ("1.51%", "1.61% to €10,000 and 1.51% above"); null: not stated. */
  readonly after: string | null
  /** For a threshold bonus: the reset days in words ("1 January and 1 July"). */
  readonly resets: string | null
}

/** "1.51%", or "1.61% to €10,000 and 1.51% above" where the balance reaches more than one band. */
export function bandsInWords(bands: DepositTerms['bands'], balance: number): string | null {
  const reached = bands.filter((band, index) => index === 0 || band.fromEur < balance)
  if (reached.length === 0) return null
  if (reached.length === 1) return pct(reached[0]?.aerPct ?? 0)
  const parts = reached.map((band, index) =>
    index === reached.length - 1
      ? `${pct(band.aerPct)} above`
      : `${pct(band.aerPct)} to ${euro(band.toEur ?? band.fromEur)}`,
  )
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`
}

const listWords = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`

/**
 * The period a non-fixed savings rate is stated to last, when it ends within `horizonMonths`.
 * `balance` is about what is held when it ends, for the band the rate after it falls in.
 *
 * A threshold bonus gives way at its first reset after the first month, as `simulateDeposit`
 * models it (`month > 1`); an introductory rate after `introductory.months`.
 */
export function ratePeriod(
  terms: DepositTerms,
  asOf: AsOf,
  horizonMonths: number,
  balance: number,
): RatePeriod | null {
  if (terms.access === 'fixed_term') return null
  const bonus = terms.thresholdBonus
  if (bonus !== null && bonus.resetMonths.length > 0) {
    for (let month = 2; month <= horizonMonths; month += 1) {
      const calendar = Number(addMonths(asOf, month).slice(5, 7))
      if (!bonus.resetMonths.includes(calendar)) continue
      return {
        kind: 'bonus',
        months: month - 1,
        endsShort: `1 ${MONTHS_SHORT[calendar - 1] ?? ''}`,
        endsLong: `1 ${MONTHS_LONG[calendar - 1] ?? ''}`,
        after: bandsInWords(bonus.baseBands, balance),
        resets: listWords(
          [...bonus.resetMonths].sort((a, b) => a - b).map((m) => `1 ${MONTHS_LONG[m - 1] ?? ''}`),
        ),
      }
    }
    return null
  }
  const intro = terms.introductory
  if (intro !== null && intro.months < horizonMonths) {
    const end = addMonths(asOf, intro.months)
    return {
      kind: 'introductory',
      months: intro.months,
      endsShort: shortMonth(end),
      endsLong: monthName(end),
      after: intro.thenAerPct === null ? null : pct(intro.thenAerPct),
      resets: null,
    }
  }
  return null
}

/**
 * One line for a tile or a summary that names a top rate with a period ("3.11% is a bonus rate
 * to 1 January; the interest figure counts the rate after it."), or null when the rate holds to
 * the date. It names no provider: the arrival's tiles never do.
 */
export function ratePeriodLine(period: RatePeriod | null, ratePct: number): string | null {
  if (period === null) return null
  const what = period.kind === 'bonus' ? 'a bonus rate' : 'an introductory rate'
  return (
    `${pct(ratePct)} is ${what} to ${period.endsLong}; ` +
    (period.after === null
      ? 'the rate after it is not stated, so the interest figure stops there.'
      : 'the interest figure counts the rate after it.')
  )
}
