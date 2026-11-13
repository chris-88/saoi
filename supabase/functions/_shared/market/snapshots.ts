import { ccpcSnapshot } from './ccpc.snapshot.ts'
import type { MarketProduct, MarketSnapshot } from './schema.ts'

/**
 * The committed snapshot: CCPC's rows, every provider, as the last `--snapshot` refresh read them
 * (Chris, 2026-11-13: CCPC is the source of every rate). The Bank of Ireland, bunq and MoCo
 * snapshots read from their own sites were retired with that decision.
 */
export const MARKET_SNAPSHOTS: readonly MarketSnapshot[] = [ccpcSnapshot]

/** The fallback when `market_products` holds no CCPC rows: every committed product. */
export const snapshotProducts: readonly MarketProduct[] = MARKET_SNAPSHOTS.flatMap(
  (snapshot) => snapshot.products,
)
