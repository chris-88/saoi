import { BOI_MARKET_PRODUCT_IDS } from '../../market/boi-sources.ts'
import { boiSnapshot } from '../../market/boi.snapshot.ts'
import {
  type DepositMarketProduct,
  isDepositRecord,
  type MarketProduct,
  marketProductSchema,
} from '../../market/schema.ts'
import type { KnowledgeProduct } from './kb-types.ts'
import { demoKnowledgeBase } from './knowledge-base.ts'

/**
 * Market data laid over the catalogue.
 *
 * The catalogue (`knowledge-base.ts`, or the console's rows) says what a product is; market
 * data says what it pays today and on what terms, read off the provider's site by
 * `npm run market:refresh`. For every product the market covers, the figures come from the
 * market record and from nowhere else: the catalogue's own `pricing_and_rates.snapshot` is
 * dropped, so a product the refresh has no current row for shows no rate rather than last
 * month's. The record rides on the product as `pricing_and_rates.market`, which is how
 * `rateOf`, the savings engine and the combinations read it without another argument.
 */

export function withMarketData(
  products: readonly KnowledgeProduct[],
  market: readonly MarketProduct[],
): readonly KnowledgeProduct[] {
  /*
   * The catalogue is Bank of Ireland's, so only its records read from its own site lay over it.
   * Other providers' rows, and CCPC's rows for any provider, sit in the same table for comparison
   * and are not put in front of a customer until that is designed.
   */
  const byId = new Map(
    market
      .filter((record) => record.provider === 'boi' && record.source === 'bank')
      .map((record) => [record.productId, record]),
  )

  return products.map((product) => {
    if (!BOI_MARKET_PRODUCT_IDS.has(product.id)) return product
    const record = byId.get(product.id)
    const {
      snapshot: _stale,
      source_rate_as_of: _staleAsOf,
      ...pricing
    } = product.pricing_and_rates

    return {
      ...product,
      pricing_and_rates: {
        ...pricing,
        ...(record === undefined
          ? {}
          : { market: record, source_rate_as_of: record.checkedAt.slice(0, 10) }),
      },
      source_urls: record === undefined ? product.source_urls : [record.sourceUrl],
      last_verified: record === undefined ? product.last_verified : record.checkedAt.slice(0, 10),
    }
  })
}

/** The market record a product carries, if any. Re-validated: the product came from a row. */
export function marketOf(product: KnowledgeProduct): DepositMarketProduct | null {
  const parsed = marketProductSchema.safeParse(product.pricing_and_rates['market'])
  return parsed.success && isDepositRecord(parsed.data) ? parsed.data : null
}

/** The published catalogue with the committed market snapshot over it: the default everywhere. */
export const publishedProducts: readonly KnowledgeProduct[] = withMarketData(
  demoKnowledgeBase.products,
  boiSnapshot.products,
)
