import { boiSnapshot } from './boi.snapshot.ts'
import { bunqSnapshot } from './bunq.snapshot.ts'
import { mocoSnapshot } from './moco.snapshot.ts'
import type { MarketProduct, MarketSnapshot } from './schema.ts'

/** Every provider's committed snapshot. A new provider's generated file is added here. */
export const MARKET_SNAPSHOTS: readonly MarketSnapshot[] = [boiSnapshot, bunqSnapshot, mocoSnapshot]

/** The fallback when `market_products` is empty: every provider's committed products. */
export const snapshotProducts: readonly MarketProduct[] = MARKET_SNAPSHOTS.flatMap(
  (snapshot) => snapshot.products,
)
