import { snapshotProducts } from '../market/snapshots.ts'
import { type MarketProduct, marketProductSchema } from '../market/schema.ts'
import type { Db } from './case-repository.ts'

/**
 * Market data as a turn should use it: the current rows of `market_products`, or the committed
 * snapshot when the table is empty or unreadable (a fresh database, CI, a local stack nobody
 * has refreshed). Each row is re-validated on the way out; one that no longer matches the
 * schema is skipped with a note in the logs, so a product shows no rate rather than a wrong one.
 */

export type LoadedMarket = {
  readonly products: readonly MarketProduct[]
  /** Whether the rows came from the database rather than the committed snapshot. */
  readonly loaded: boolean
}

/** A row as stored. Snake case, because it is the table's. */
export type MarketRow = {
  readonly provider: string
  readonly product_id: string
  readonly category: string
  readonly provider_product_name: string
  readonly rates: unknown
  readonly conditions: unknown
  readonly source_url: string
  readonly checked_at: string
  readonly effective_from: string | null
}

export const MARKET_COLUMNS =
  'provider, product_id, category, provider_product_name, rates, conditions, source_url, checked_at, effective_from'

export function rowFor(product: MarketProduct): MarketRow {
  return {
    provider: product.provider,
    product_id: product.productId,
    category: product.category,
    provider_product_name: product.providerProductName,
    rates: product.rates,
    conditions: product.conditions,
    source_url: product.sourceUrl,
    checked_at: product.checkedAt,
    effective_from: product.effectiveFrom,
  }
}

export function productsFromRows(rows: readonly MarketRow[]): readonly MarketProduct[] {
  return rows.flatMap((row) => {
    const parsed = marketProductSchema.safeParse({
      provider: row.provider,
      productId: row.product_id,
      category: row.category,
      providerProductName: row.provider_product_name,
      rates: row.rates,
      conditions: row.conditions,
      sourceUrl: row.source_url,
      // Postgres hands back `2026-11-09 12:00:00+00`; the schema wants ISO.
      checkedAt: new Date(row.checked_at).toISOString(),
      effectiveFrom: row.effective_from,
    })
    if (!parsed.success) {
      console.error(
        `market_products row ${row.provider}/${row.product_id} does not match its schema; skipped`,
      )
      return []
    }
    return [parsed.data]
  })
}

/** The current version of every provider product. */
export async function loadMarket(client: Db): Promise<LoadedMarket> {
  const result = await client
    .from('market_products')
    .select(MARKET_COLUMNS)
    .is('superseded_at', null)
  const rows = (result.data ?? []) as MarketRow[]

  if (result.error !== null || rows.length === 0) {
    return { products: snapshotProducts, loaded: false }
  }
  return { products: productsFromRows(rows), loaded: true }
}
