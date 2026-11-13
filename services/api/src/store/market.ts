import {
  MARKET_HISTORY_COLUMNS,
  recordsFromRows,
  type MarketHistoryRow,
} from '@shared/db/market.ts'
import { normaliseMarket, type NormaliseOptions } from '@shared/domain/market/normalise.ts'
import type { Market, MarketRecord } from '@shared/domain/market/types.ts'
import type { Db } from './client.ts'
import { must } from './client.ts'

/**
 * Market data for the public comparison routes: every version of every row in
 * `market_products` (current for the figures, superseded for "last changed" and history),
 * normalised once and held briefly. The refresh runs weekly, so ten minutes is fresh enough
 * and spares the database a read on every MCP call.
 *
 * Separate from `loadMarket`, which a turn uses and which reads Bank of Ireland's own rows
 * only: the conversation's behaviour does not change with this.
 */
export interface MarketStore {
  load(): Promise<Market>
}

export const MARKET_CACHE_MS = 10 * 60 * 1000
const PAGE = 1000

/** Holds one normalised market for `ttlMs`; concurrent callers share one load. */
export function cachedMarketStore(
  loadRecords: () => Promise<readonly MarketRecord[]>,
  options: {
    readonly ttlMs?: number
    readonly now?: () => number
    readonly normalise?: NormaliseOptions
  } = {},
): MarketStore {
  const ttl = options.ttlMs ?? MARKET_CACHE_MS
  const now = options.now ?? Date.now
  let held: { at: number; market: Promise<Market> } | null = null
  return {
    load() {
      if (held !== null && now() - held.at < ttl) return held.market
      const market = loadRecords().then((records) => normaliseMarket(records, options.normalise))
      held = { at: now(), market }
      // A failed load is not cached: the next call tries again.
      market.catch(() => {
        held = null
      })
      return market
    },
  }
}

/** `options` as `cachedMarketStore`'s: the admin's views keep Raisin's banks and a shorter hold. */
export function supabaseMarketStore(
  db: Db,
  options: Parameters<typeof cachedMarketStore>[1] = {},
): MarketStore {
  return cachedMarketStore(async () => {
    // Paged: PostgREST returns at most a thousand rows a request, and history only grows.
    const rows: MarketHistoryRow[] = []
    for (let from = 0; ; from += PAGE) {
      const page = must(
        await db
          .from('market_products')
          .select(MARKET_HISTORY_COLUMNS)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1),
        'market products',
      )
      rows.push(...((page ?? []) as MarketHistoryRow[]))
      if ((page ?? []).length < PAGE) break
    }
    return recordsFromRows(rows)
  }, options)
}
