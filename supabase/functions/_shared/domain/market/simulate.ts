import type { DepositTerms, SavingsFigures } from '../../contracts/market-tools.ts'

/**
 * Money held in one deposit or savings product, month by month.
 *
 * Interest accrues each month at a twelfth of the AER on the balance and is credited every
 * twelve months and at the end, as banks credit it, so a year of a lump sum earns exactly the
 * AER. DIRT at 33% comes off interest when it is credited (none where the product is
 * DIRT-free). A balance in a band earns the band's rate. A lump sum earns the product's lump-sum
 * rate where it has one. Monthly saving is capped at the product's maximum; what it cannot take
 * is reported, not placed.
 *
 * The projection runs only as far as the rates are known. A fixed term ends at maturity; an
 * introductory rate with no stated reversion ends with the period. Either way the figures stop
 * there and say why: an unknown rate is never read as zero, and never assumed to hold.
 */

export const DIRT_RATE = 0.33

export type DepositInput = {
  readonly lumpSum: number
  readonly monthly: number
  readonly horizonMonths: number
  /** For a ladder: the term to use. Default the longest that ends by the horizon. */
  readonly termMonths?: number | undefined
  /** `YYYY-MM-DD`: month 1 is the month after this. */
  readonly asOf?: string | undefined
}

export type SimulatedMonth = {
  readonly month: number
  readonly date: string
  readonly paidIn: number
  readonly balance: number
  readonly netInterest: number
}

export type Simulation = {
  readonly figures: SavingsFigures
  readonly months: readonly SimulatedMonth[]
}

export const round2 = (value: number): number => Math.round(value * 100) / 100

/** A month's interest on a balance at an annual rate, credited yearly: a twelfth of the AER. */
export const monthlyOfAer = (aerPct: number): number => aerPct / 100 / 12

/** `P · r / (1 − (1 + r)^−n)`, with `r` the monthly rate as a fraction. */
export function annuityPayment(principal: number, monthlyRate: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0
  if (monthlyRate === 0) return principal / months
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months))
}

/** `YYYY-MM` for month `n` after `asOf`. */
export function addMonths(asOf: string, months: number): string {
  const [year, month] = asOf.split('-').map(Number)
  const index = (year ?? 1970) * 12 + ((month ?? 1) - 1) + months
  const y = Math.floor(index / 12)
  const m = (index % 12) + 1
  return `${String(y)}-${String(m).padStart(2, '0')}`
}

/** Months from `asOf` to a `YYYY-MM` or `YYYY-MM-DD` target; at least one. */
export function monthsUntil(asOf: string, target: string): number {
  const [ay, am] = asOf.split('-').map(Number)
  const [ty, tm] = target.split('-').map(Number)
  return Math.max(1, ((ty ?? 0) - (ay ?? 0)) * 12 + ((tm ?? 0) - (am ?? 0)))
}

/** The longest term that ends by the horizon; the higher rate where two are as long. */
export function bestRung(
  ladder: DepositTerms['ladder'],
  horizonMonths: number,
): DepositTerms['ladder'][number] | null {
  const fits = ladder.filter((rung) => rung.months <= horizonMonths)
  return [...fits].sort((a, b) => b.months - a.months || b.aerPct - a.aerPct)[0] ?? null
}

/** What can go in: the amounts the product takes, within its limits. */
export function placement(
  terms: DepositTerms,
  lumpSum: number,
  monthly: number,
): { readonly lump: number; readonly monthly: number } {
  const lump =
    lumpSum > 0 && terms.takesLumpSum === true && lumpSum >= (terms.minLumpSumEur ?? 0)
      ? Math.min(lumpSum, terms.maxLumpSumEur ?? lumpSum)
      : 0
  const regular =
    monthly > 0 &&
    terms.access !== 'fixed_term' &&
    terms.takesMonthly === true &&
    monthly >= (terms.minMonthlyEur ?? 0)
      ? Math.min(monthly, terms.maxMonthlyEur ?? monthly)
      : 0
  return { lump, monthly: regular }
}

/** Interest for a month on a balance across bands, at the given annual rates. */
function bandedInterest(
  balance: number,
  bands: DepositTerms['bands'],
  rateOf: (aer: number) => number,
) {
  let interest = 0
  for (const band of bands) {
    const top = band.toEur ?? Number.POSITIVE_INFINITY
    const inBand = Math.max(0, Math.min(balance, top) - band.fromEur)
    interest += inBand * monthlyOfAer(rateOf(band.aerPct))
  }
  return interest
}

export function simulateDeposit(terms: DepositTerms, input: DepositInput): Simulation {
  const horizon = input.horizonMonths
  const placed = placement(terms, input.lumpSum, input.monthly)
  const notPlaced = {
    lumpSum: round2(input.lumpSum - placed.lump),
    monthly: round2(input.monthly - placed.monthly),
  }

  // ---- How far the rates are known ------------------------------------------------------
  const rung =
    terms.access === 'fixed_term'
      ? input.termMonths === undefined
        ? bestRung(terms.ladder, horizon)
        : (terms.ladder.find((r) => r.months === input.termMonths) ?? null)
      : null
  let known = horizon
  let stop: SavingsFigures['stop'] = null
  if (terms.access === 'fixed_term') {
    if (rung === null) {
      known = 0
      stop = {
        afterMonths: 0,
        reason: `No term on offer ends within ${String(horizon)} months.`,
      }
    } else if (rung.months < horizon) {
      known = rung.months
      stop = {
        afterMonths: rung.months,
        reason: `The ${String(rung.months)}-month term ends at month ${String(rung.months)} and the balance is returned. What it earns after that is not known, so the figures stop there.`,
      }
    }
  } else if (
    terms.introductory !== null &&
    terms.introductory.thenAerPct === null &&
    terms.introductory.months < horizon
  ) {
    known = terms.introductory.months
    stop = {
      afterMonths: known,
      reason: `The introductory rate lasts ${String(known)} months and the rate after it is not stated, so the figures stop at month ${String(known)}.`,
    }
  }

  const fixedRate = rung?.aerPct ?? null
  const headline = terms.aerPct
  const rateAt = (month: number) => (aer: number) => {
    const intro = terms.introductory
    if (intro === null || intro.thenAerPct === null || month <= intro.months) return aer
    // After the introductory period the headline band reverts; other bands are as stated.
    return aer === headline ? intro.thenAerPct : aer
  }

  // ---- Month by month --------------------------------------------------------------------
  const separateLump = terms.lumpSumAerPct !== null && fixedRate === null
  let lumpPot = known > 0 ? placed.lump : 0
  let regularPot = 0
  let paidIn = lumpPot
  let gross = 0
  let dirt = 0
  let balanceMonths = 0
  const months: SimulatedMonth[] = []

  let accrued = 0
  for (let month = 1; month <= known; month += 1) {
    regularPot += placed.monthly
    paidIn += placed.monthly
    if (!separateLump) {
      regularPot += lumpPot
      lumpPot = 0
    }
    const held = lumpPot + regularPot
    balanceMonths += held

    let interest: number
    if (fixedRate !== null) interest = held * monthlyOfAer(fixedRate)
    else {
      const regular = bandedInterest(regularPot, terms.bands, rateAt(month))
      const lump = separateLump ? lumpPot * monthlyOfAer(terms.lumpSumAerPct ?? 0) : 0
      interest = regular + lump
    }
    const tax = terms.dirtApplies ? interest * DIRT_RATE : 0
    gross += interest
    dirt += tax
    accrued += interest - tax
    // Credited once a year and at the end; from then on it earns at the account's bands.
    if (month % 12 === 0 || month === known) {
      regularPot += accrued
      accrued = 0
    }

    months.push({
      month,
      date: input.asOf === undefined ? `+${String(month)}` : addMonths(input.asOf, month),
      paidIn: round2(paidIn),
      balance: round2(lumpPot + regularPot + accrued),
      netInterest: round2(gross - dirt),
    })
  }

  const net = gross - dirt
  return {
    figures: {
      kind: 'savings',
      horizonMonths: horizon,
      knownMonths: known,
      termMonths: rung?.months ?? null,
      paidIn: round2(paidIn),
      grossInterest: round2(gross),
      dirt: round2(dirt),
      netInterest: round2(net),
      endBalance: round2(lumpPot + regularPot),
      netRatePct: balanceMonths === 0 ? 0 : round2((net / (balanceMonths / 12)) * 100),
      stop,
      notPlaced: known === 0 ? { lumpSum: input.lumpSum, monthly: input.monthly } : notPlaced,
    },
    months,
  }
}
