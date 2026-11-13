import type { DepositTerms } from '../../contracts/market-tools.ts'
import { KEYS_BUFFER_MONTHS } from '../../market/mortgage-incentives.ts'
import { monthName } from './home-arithmetic.ts'
import { addMonths, simulateDeposit } from './simulate.ts'
import type { AsOf } from './types.ts'

/**
 * Which fixed term fits a home plan (Chris, 2026-11-13: "clamp the fixed term deposit options to
 * the timeline it's actually going to take the user to save that amount, with a little bit of
 * buffer, so that if the rate will accelerate their savings plan we might need to readjust what
 * product is best for them").
 *
 * The rule: a fixed term fits when it ends at least `KEYS_BUFFER_MONTHS` before the keys month,
 * and the keys month is the one the customer's plan reaches with that product's own interest,
 * not the plan's current keys month. A deposit that earns more brings the keys forward, so a
 * term that fits the plan's month can stop fitting once its own interest is counted: it is
 * judged again after the run, and the next shorter term is tried. Pure.
 */

/** What the plan runs on: what is held, what is saved each month, what is needed at the keys. */
export type KeysRun = {
  readonly savedEur: number
  readonly monthlyEur: number
  /** The cash needed at the keys; null when the case does not carry it (a date given only). */
  readonly neededEur: number | null
  /**
   * YYYY-MM: the plan's keys month, or the date given. The keys month when it cannot be worked
   * out (nothing needed is known, or it is not reached within `KEYS_RUN_MAX_MONTHS`).
   */
  readonly keysMonth: string
  readonly asOf: AsOf
}

/** How far a run looks for the keys month: twenty years. */
export const KEYS_RUN_MAX_MONTHS = 240

/** The one sentence that states the rule, for a card's basis. */
export const TERM_FIT_RULE =
  `A fixed term is shown when it ends at least ${KEYS_BUFFER_MONTHS === 1 ? 'one month' : `${String(KEYS_BUFFER_MONTHS)} months`} before the keys month that its own interest gives, ` +
  'with what is held and saved each month; where its interest brings the keys inside a longer term, the next shorter term is shown.'

/**
 * YYYY-MM the money needed at the keys is held, with `terms` taking what it takes of the sum held
 * and the monthly saving and earning its own interest (after DIRT, `simulateDeposit`), and the
 * rest counted before interest. After a fixed term ends, or a rate with nothing stated after it,
 * what it holds is counted as it stands and the saving carries on before interest. This month
 * when the money is already held; null when it is not reached within `KEYS_RUN_MAX_MONTHS`.
 * With nothing needed known, the plan's keys month.
 */
export function keysMonthWith(
  terms: DepositTerms,
  run: KeysRun,
  termMonths: number | null,
): string | null {
  const needed = run.neededEur
  if (needed === null) return run.keysMonth
  if (run.savedEur >= needed) return addMonths(run.asOf, 0)
  const { figures, months } = simulateDeposit(terms, {
    lumpSum: run.savedEur,
    monthly: run.monthlyEur,
    horizonMonths: KEYS_RUN_MAX_MONTHS,
    termMonths: termMonths ?? undefined,
    asOf: run.asOf,
  })
  const known = figures.knownMonths
  const placedMonthly = run.monthlyEur - figures.notPlaced.monthly
  const last = known === 0 ? 0 : (months[known - 1]?.balance ?? 0)
  for (let month = 1; month <= KEYS_RUN_MAX_MONTHS; month += 1) {
    const inProduct =
      month <= known ? (months[month - 1]?.balance ?? 0) : last + placedMonthly * (month - known)
    const held = inProduct + figures.notPlaced.lumpSum + figures.notPlaced.monthly * month
    if (held >= needed) return addMonths(run.asOf, month)
  }
  return null
}

/** Whether money back in `endsOn` is in hand at least the buffer before the keys month. */
export const endsInTime = (endsOn: string, keysOn: string): boolean =>
  endsOn <= addMonths(keysOn, -KEYS_BUFFER_MONTHS)

/** One term judged: when it ends and the keys month with its own interest. */
export type JudgedTerm = {
  readonly months: number
  /** YYYY-MM the term ends. */
  readonly endsOn: string
  /** YYYY-MM the keys come in with this term's interest. */
  readonly keysOn: string
}

export type TermFit = {
  /** The longest term that ends in time; null when none does. */
  readonly fit: JudgedTerm | null
  /**
   * Longer terms that end in time for the plan's keys month but not for the keys month their
   * own interest brings: the reason the shorter term is the one shown.
   */
  readonly pushedOut: readonly JudgedTerm[]
}

/**
 * The longest rung of a fixed-term ladder that ends at least the buffer before the keys month
 * its own interest gives (the higher rate where two are as long), with the longer rungs its
 * interest put out of time.
 */
export function termThatFits(terms: DepositTerms, run: KeysRun): TermFit {
  const rungs = [...terms.ladder].sort((a, b) => b.months - a.months || b.aerPct - a.aerPct)
  const pushedOut: JudgedTerm[] = []
  const tried = new Set<number>()
  for (const rung of rungs) {
    if (tried.has(rung.months)) continue
    tried.add(rung.months)
    const endsOn = addMonths(run.asOf, rung.months)
    const keysOn = keysMonthWith(terms, run, rung.months) ?? run.keysMonth
    const judged = { months: rung.months, endsOn, keysOn }
    if (endsInTime(endsOn, keysOn)) return { fit: judged, pushedOut }
    if (endsInTime(endsOn, run.keysMonth)) pushedOut.push(judged)
  }
  return { fit: null, pushedOut }
}

/** "18 months ends May 2028; with its interest the keys come in April 2028." */
export function pushedOutLine(term: JudgedTerm): string {
  return `${String(term.months)} months ends ${monthName(term.endsOn)}; with its interest the keys come in ${monthName(term.keysOn)}.`
}

/** "Ends May 2028; with its interest the keys come in July 2028." */
export function fitLine(term: JudgedTerm): string {
  return `The ${String(term.months)}-month term ends ${monthName(term.endsOn)}; with its interest the keys come in ${monthName(term.keysOn)}.`
}
