/**
 * Mortgage arithmetic.
 *
 * Here rather than in the tenant folder because an annuity is an annuity: the rates are Bank of
 * Ireland's, the formula is nobody's (Invariant 11, §32).
 *
 * It exists for the same reason the quote engine does — a model asked to work out a monthly
 * repayment in prose will produce a plausible number, and a plausible number is the worst kind
 * of wrong in a conversation about somebody's mortgage.
 */

/**
 * The level monthly payment that clears `principal` over `termYears` at `annualRatePct`.
 *
 * The standard annuity formula. A zero rate is handled separately because the general form
 * divides by zero there, and a zero rate is not hypothetical — a tracker at 0% margin in a
 * zero-rate world is exactly this.
 */
export function monthlyRepayment(
  principalEur: number,
  annualRatePct: number,
  termYears: number,
): number {
  const months = Math.round(termYears * 12)
  if (months <= 0 || principalEur <= 0) return 0

  const monthlyRate = annualRatePct / 100 / 12
  if (monthlyRate === 0) return principalEur / months

  return (principalEur * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months))
}

/** Everything paid over the full term, principal and interest together. */
export function totalRepaid(
  principalEur: number,
  annualRatePct: number,
  termYears: number,
): number {
  return monthlyRepayment(principalEur, annualRatePct, termYears) * Math.round(termYears * 12)
}

/**
 * What the fixed period itself costs, before it reverts to whatever comes next.
 *
 * Deliberately not a whole-term figure. A four-year fixed rate says nothing about year five,
 * and quoting thirty years of a rate that is guaranteed for four would be inventing the other
 * twenty-six.
 */
export function paidDuringFixedPeriod(
  principalEur: number,
  annualRatePct: number,
  termYears: number,
  fixedYears: number,
): number {
  return (
    monthlyRepayment(principalEur, annualRatePct, termYears) *
    Math.round(Math.min(fixedYears, termYears) * 12)
  )
}
