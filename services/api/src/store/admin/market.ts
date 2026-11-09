import { marketProductVersionSchema, type MarketProductList } from '@shared/contracts/market.ts'
import type { Db } from '../client.ts'
import { must } from '../client.ts'

export type MarketProductFilter = {
  /** All versions, not only the current one. */
  readonly history: boolean
  readonly provider?: string | undefined
  readonly source?: 'bank' | 'ccpc' | undefined
  readonly productId?: string | undefined
}

export interface AdminMarketStore {
  /** Market data rows, grouped by provider and product, newest version first. */
  list(filter: MarketProductFilter): Promise<MarketProductList>
}

export function supabaseAdminMarketStore(db: Db): AdminMarketStore {
  return {
    async list(filter) {
      let query = db
        .from('market_products')
        .select(
          'provider, source, product_id, category, provider_product_name, rates, conditions, source_url, provider_url, source_product_id, source_updated_at, attribution, unknown, effective_from, first_seen_at, checked_at, superseded_at',
        )
        .order('provider', { ascending: true })
        .order('source', { ascending: true })
        .order('product_id', { ascending: true })
        .order('first_seen_at', { ascending: false })
      if (!filter.history) query = query.is('superseded_at', null)
      if (filter.provider !== undefined) query = query.eq('provider', filter.provider)
      if (filter.source !== undefined) query = query.eq('source', filter.source)
      if (filter.productId !== undefined) query = query.eq('product_id', filter.productId)

      const rows = must(await query, 'market products') ?? []
      const items: MarketProductList['items'] = []
      let skipped = 0
      for (const row of rows) {
        const parsed = marketProductVersionSchema.safeParse({
          provider: row.provider,
          source: row.source,
          category: row.category,
          productId: row.product_id,
          providerProductName: row.provider_product_name,
          rates: row.rates,
          conditions: row.conditions,
          sourceUrl: row.source_url,
          providerUrl: row.provider_url,
          sourceProductId: row.source_product_id,
          sourceUpdatedAt:
            row.source_updated_at === null ? null : new Date(row.source_updated_at).toISOString(),
          attribution: row.attribution,
          unknown: row.unknown,
          effectiveFrom: row.effective_from,
          // Postgres may hand back `2026-11-09 12:00:00+00`; the console wants ISO.
          firstSeenAt: new Date(row.first_seen_at).toISOString(),
          checkedAt: new Date(row.checked_at).toISOString(),
          supersededAt:
            row.superseded_at === null ? null : new Date(row.superseded_at).toISOString(),
        })
        if (parsed.success) items.push(parsed.data)
        else skipped += 1
      }
      return { items, skipped }
    },
  }
}
