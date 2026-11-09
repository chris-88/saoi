import { snapshotProducts } from '../market/snapshots.ts'
import { type MarketProduct, marketProductSchema } from '../market/schema.ts'
import type { Db } from './case-repository.ts'

/**
 * Market data as a turn should use it: Bank of Ireland's own current rows of `market_products`
 * (the only ones laid over the catalogue), or the committed snapshot when there are none or the
 * table is unreadable (a fresh database, CI, a local stack nobody has refreshed). Each row is
 * re-validated on the way out; one that no longer matches the schema is skipped with a note in
 * the logs, so a product shows no rate rather than a wrong one.
 *
 * Other providers' rows and every CCPC row stay in the table for comparison and the console;
 * they are not read on a turn.
 */

export type LoadedMarket = {
  readonly products: readonly MarketProduct[]
  /** Whether the rows came from the database rather than the committed snapshot. */
  readonly loaded: boolean
}

/** A row as stored. Snake case, because it is the table's. */
export type MarketRow = {
  readonly provider: string
  readonly source: string
  readonly product_id: string
  readonly category: string
  readonly provider_product_name: string
  readonly rates: unknown
  readonly conditions: unknown
  readonly source_url: string
  readonly provider_url: string | null
  readonly source_product_id: string | null
  readonly source_updated_at: string | null
  readonly attribution: string | null
  readonly unknown: readonly string[]
  readonly checked_at: string
  readonly effective_from: string | null
}

export const MARKET_COLUMNS =
  'provider, source, product_id, category, provider_product_name, rates, conditions, source_url, provider_url, source_product_id, source_updated_at, attribution, unknown, checked_at, effective_from'

export function rowFor(product: MarketProduct): MarketRow {
  return {
    provider: product.provider,
    source: product.source,
    product_id: product.productId,
    category: product.category,
    provider_product_name: product.providerProductName,
    rates: product.rates,
    conditions: product.conditions,
    source_url: product.sourceUrl,
    provider_url: product.providerUrl ?? null,
    source_product_id: product.sourceProductId ?? null,
    source_updated_at: product.sourceUpdatedAt ?? null,
    attribution: product.attribution ?? null,
    unknown: [...(product.unknown ?? [])].sort(),
    checked_at: product.checkedAt,
    effective_from: product.effectiveFrom,
  }
}

/** Postgres hands back `2026-11-09 12:00:00+00`; the schema wants ISO. */
const iso = (value: string): string => new Date(value).toISOString()

export function productsFromRows(rows: readonly MarketRow[]): readonly MarketProduct[] {
  return rows.flatMap((row) => {
    const parsed = marketProductSchema.safeParse({
      provider: row.provider,
      source: row.source,
      productId: row.product_id,
      category: row.category,
      providerProductName: row.provider_product_name,
      rates: row.rates,
      conditions: row.conditions,
      sourceUrl: row.source_url,
      ...(row.provider_url === null ? {} : { providerUrl: row.provider_url }),
      ...(row.source_product_id === null ? {} : { sourceProductId: row.source_product_id }),
      ...(row.source_updated_at === null ? {} : { sourceUpdatedAt: iso(row.source_updated_at) }),
      ...(row.attribution === null ? {} : { attribution: row.attribution }),
      ...(row.unknown.length === 0 ? {} : { unknown: [...row.unknown] }),
      checkedAt: iso(row.checked_at),
      effectiveFrom: row.effective_from,
    })
    if (!parsed.success) {
      console.error(
        `market_products row ${row.provider}/${row.source}/${row.product_id} does not match its schema; skipped`,
      )
      return []
    }
    return [parsed.data]
  })
}

/** The current version of every Bank of Ireland product read from its own site. */
export async function loadMarket(client: Db): Promise<LoadedMarket> {
  const result = await client
    .from('market_products')
    .select(MARKET_COLUMNS)
    .eq('provider', 'boi')
    .eq('source', 'bank')
    .is('superseded_at', null)
  const rows = (result.data ?? []) as MarketRow[]

  if (result.error !== null || rows.length === 0) {
    return { products: snapshotProducts, loaded: false }
  }
  return { products: productsFromRows(rows), loaded: true }
}
