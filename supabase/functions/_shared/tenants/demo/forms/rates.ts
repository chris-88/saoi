import { demoProducts } from '../products.ts'

/**
 * The rate a loan quote is computed at.
 *
 * The form knows the amount and the term; it does not carry a rate, because the real journey
 * gets one from a pricing service this prototype has no access to. So the quote is computed
 * against the published catalogue instead, which is the same catalogue Saoirse quotes from in
 * conversation. One source for both means a repayment on a packet and a repayment in a chat
 * message cannot disagree.
 *
 * Tenant knowledge, which is why it is here: `_shared/domain/forms` takes a rate and has no
 * opinion about where it came from (Invariant 11).
 */

type Variant = {
  readonly id: string
  readonly annualRate?: number
  readonly minMonths?: number
  readonly maxMonths?: number
  readonly shape?: string
}

/**
 * The published terms, nearest first.
 *
 * The catalogue prices three fixed terms, 36, 60 and 84 months, and a customer may ask for 24.
 * The nearest published term is the honest answer to "what would this cost": it is a real rate
 * from the real list rather than an interpolation nobody offers, and the console says which
 * term it came from.
 */
export function loanAnnualRate(months: number | null): { rate: number; basis: string } | null {
  if (months === null || !Number.isFinite(months) || months <= 0) return null

  /*
   * The personal loan's own terms, and nothing else.
   *
   * A mortgage variant is also shaped as borrowing and is priced far lower, so a scan across
   * the whole catalogue would quote a thirty-year mortgage rate on a two-year car loan when
   * the term happened to fall nearer one of them.
   */
  const product = demoProducts.personal_loan as { variants?: readonly Variant[] }
  const variants = (product.variants ?? []).filter(
    (variant) => typeof variant.annualRate === 'number',
  )

  if (variants.length === 0) return null

  let nearest = variants[0]
  if (!nearest) return null

  for (const variant of variants) {
    const distance = Math.abs((variant.minMonths ?? 0) - months)
    const best = Math.abs((nearest.minMonths ?? 0) - months)
    if (distance < best) nearest = variant
  }

  const rate = nearest.annualRate
  if (rate === undefined) return null

  return {
    rate,
    basis:
      (nearest.minMonths ?? 0) === months
        ? `published ${nearest.id} rate`
        : `published ${nearest.id} rate, the nearest term offered`,
  }
}
