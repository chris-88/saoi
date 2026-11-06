/**
 * The arithmetic behind a quote.
 *
 * Here rather than in the model, for the reason every other engine in this codebase exists: a
 * number the model worked out is a number that can be wrong, and a repayment figure is exactly
 * the kind of wrong a customer acts on. Saoirse decides to show a quote and what to say about it;
 * it never does the sums.
 *
 * Standard amortisation throughout. The figures are illustrative — the rates they are computed
 * from are invented — but the computation itself is not approximate.
 */

/** A rate of zero is legal and breaks every formula below, so each one handles it first. */
const monthlyRate = (annualRate: number): number => annualRate / 12

/**
 * What a loan costs each month.
 *
 * `P · r / (1 − (1 + r)^−n)`, the standard annuity payment.
 */
export function repaymentFor(principal: number, annualRate: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0

  const rate = monthlyRate(annualRate)
  if (rate === 0) return principal / months

  return (principal * rate) / (1 - Math.pow(1 + rate, -months))
}

/**
 * How long a loan takes at a given payment, or null when it never finishes.
 *
 * A payment at or below the first month's interest never touches the principal. Returning null
 * rather than a very large number matters: "about 600 years" is arithmetically true and useless,
 * and the customer needs to be told the payment is too small.
 */
export function monthsFor(principal: number, annualRate: number, monthly: number): number | null {
  if (principal <= 0 || monthly <= 0) return null

  const rate = monthlyRate(annualRate)
  if (rate === 0) return Math.ceil(principal / monthly)

  if (monthly <= principal * rate) return null

  return Math.ceil(-Math.log(1 - (principal * rate) / monthly) / Math.log(1 + rate))
}

/** The most that can be borrowed at a given payment and term. */
export function principalFor(monthly: number, annualRate: number, months: number): number {
  if (monthly <= 0 || months <= 0) return 0

  const rate = monthlyRate(annualRate)
  if (rate === 0) return monthly * months

  return (monthly * (1 - Math.pow(1 + rate, -months))) / rate
}

/** Everything paid over the full term. */
export function totalPaid(monthly: number, months: number): number {
  return monthly * months
}

/**
 * What regular saving is worth at the end, with interest.
 *
 * `M · ((1 + r)^n − 1) / r`, the future value of an annuity, plus whatever was there to begin
 * with compounded over the same period.
 */
export function savedAfter(
  monthly: number,
  annualRate: number,
  months: number,
  opening = 0,
): number {
  if (months <= 0) return opening

  const rate = monthlyRate(annualRate)
  const deposits =
    rate === 0 ? monthly * months : (monthly * (Math.pow(1 + rate, months) - 1)) / rate

  return deposits + opening * Math.pow(1 + rate, months)
}

/** How long regular saving takes to reach a target, or null when it never does. */
export function monthsToSave(
  target: number,
  monthly: number,
  annualRate: number,
  opening = 0,
): number | null {
  if (target <= opening) return 0
  if (monthly <= 0) return null

  // Walked forward rather than solved: the closed form for a target with an opening balance is
  // unpleasant, and a few hundred iterations costs nothing.
  const rate = monthlyRate(annualRate)
  let balance = opening

  for (let month = 1; month <= 1200; month += 1) {
    balance = balance * (1 + rate) + monthly
    if (balance >= target) return month
  }

  return null
}
