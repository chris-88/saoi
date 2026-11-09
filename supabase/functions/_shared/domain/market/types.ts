import type { ProductView } from '../../contracts/market-tools.ts'
import type { MarketProduct } from '../../market/schema.ts'

/**
 * One stored version of a market row, as the engine is handed it: the record and when Saoi saw
 * it begin and end. The caller loads every version (current and superseded) once; the engine
 * reads the current ones for figures and the rest for "last changed" and the rate history.
 */
export type MarketRecord = {
  readonly product: MarketProduct
  /** When this version was first seen: the date its figures took the shape they have. */
  readonly firstSeenAt: string
  /** When it was replaced. Null: current. */
  readonly supersededAt: string | null
}

/**
 * The market as the engine reasons on it: one comparable view per product, plus the records
 * behind each view for detail and history.
 */
export type Market = {
  readonly products: readonly ProductView[]
  /** Every version of every row folded into each product view, by view id. */
  readonly recordsOf: ReadonlyMap<string, readonly MarketRecord[]>
  /** A row id (`aib:deposit.c3743`) to the view it was folded into. */
  readonly viewOfRow: ReadonlyMap<string, string>
}

/** `YYYY-MM-DD`: the day figures are worked out from. Passed in; the domain reads no clock. */
export type AsOf = string
