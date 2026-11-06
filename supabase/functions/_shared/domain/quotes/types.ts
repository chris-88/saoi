/**
 * A version of a product with its own numbers.
 *
 * Here rather than in the tenant catalogue because Invariant 11 runs the other way: portable
 * code defines the shape, and a tenant fills it in. The engine must be able to quote Bank of
 * Ireland's products without knowing they are Demo Bank's.
 *
 * `shape` decides which sums apply. Borrowing amortises, saving compounds, revolving clears a
 * balance at a monthly payment.
 */
export type ProductVariant = {
  readonly id: string
  /** A fact about this option against the others on screen, never a claim about other customers. */
  readonly name: string
  readonly highlight?: string
  readonly shape: 'borrowing' | 'saving' | 'revolving'
  /** Illustrative, like every other figure a tenant supplies. */
  readonly annualRate: number
  /** Where a rate is only held for a while. */
  readonly fixedYears?: number
  readonly minMonths?: number
  readonly maxMonths?: number
  readonly minAmount?: number
  readonly maxAmount?: number
  readonly note?: string
}
