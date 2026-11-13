import {
  CATALOGUE_CCPC_PAIRS,
  CATALOGUE_MARKET_PRODUCT_IDS,
} from '../../market/catalogue-ccpc-pairs.ts'
import { withProseRead } from '../../market/ccpc-prose.ts'
import { ccpcSnapshot } from '../../market/ccpc.snapshot.ts'
import {
  type DepositMarketProduct,
  type DepositRates,
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
 * data says what it pays today and on what terms: CCPC's rows for Bank of Ireland, since CCPC is
 * the source of every rate (Chris, 2026-11-13), paired to the catalogue by name
 * (`market/catalogue-ccpc-pairs.ts`). For every product the market covers, the figures come
 * from the market record and from nowhere else: the catalogue's own `pricing_and_rates.snapshot`
 * is dropped, so a product with no current row shows no rate rather than last month's. The
 * record rides on the product as `pricing_and_rates.market`, which is how `rateOf`, the savings
 * engine and the combinations read it without another argument.
 */

/**
 * Two balance bands as the cap and the rate above it, the shape the catalogue's engine reads:
 * CCPC's "€0 to €30,000 at 3%, €30,001 to €100,000 at 0.5%" is a €30,000 cap. The boundary is
 * the round figure of the two CCPC states (MortgageSaver: €14,999 and €15,000, so €15,000).
 */
function asCap(rates: DepositRates): DepositRates {
  const [first, second, ...rest] = [...(rates.tiers ?? [])].sort((a, b) => a.minEur - b.minEur)
  if (first === undefined || second === undefined || rest.length > 0) return rates
  if (rates.tierCapEur !== undefined || first.maxEur === null) return rates
  const cap = [first.maxEur, second.minEur].find((value) => value % 100 === 0) ?? first.maxEur
  return { ...rates, tierCapEur: cap, aboveTierAerPct: second.aerPct }
}

/**
 * The catalogue's market records, by catalogue id, from the market's CCPC rows: one row for a
 * product, or Advantage's three terms folded into the one ladder the catalogue describes. What
 * a row's prose states (SuperSaver's twelve fixed months, MortgageSaver's lump-sum limit) is read
 * into it; nothing else is added.
 */
export function catalogueRecords(
  market: readonly MarketProduct[],
): ReadonlyMap<string, DepositMarketProduct> {
  const records = new Map<string, DepositMarketProduct>()
  for (const catalogueId of CATALOGUE_MARKET_PRODUCT_IDS) {
    const pairs = CATALOGUE_CCPC_PAIRS.filter((pair) => pair.catalogueId === catalogueId)
    const rows = market
      .filter((row) => row.source === 'ccpc')
      .flatMap((row) => {
        const pair = pairs.find(
          (candidate) =>
            candidate.provider === row.provider &&
            candidate.category === row.category &&
            candidate.ccpcName.test(row.providerProductName) &&
            (candidate.termMonths === undefined ||
              (row.rates.kind === 'deposit' && row.rates.termMonths === candidate.termMonths)),
        )
        const read = withProseRead(row)
        return pair === undefined || !isDepositRecord(read) ? [] : [{ pair, row: read }]
      })
    const head = rows[0]
    if (head === undefined) continue

    if (head.pair.termMonths === undefined) {
      records.set(catalogueId, {
        ...head.row,
        productId: catalogueId,
        rates: asCap(head.row.rates),
      })
      continue
    }
    const terms = rows
      .flatMap(({ pair, row }) =>
        pair.termMonths === undefined || row.rates.aerPct === null
          ? []
          : [{ months: pair.termMonths, aerPct: row.rates.aerPct }],
      )
      .sort((a, b) => a.months - b.months)
    if (terms.length === 0) continue
    const { termMonths: _term, noticeDays: _notice, ...rates } = head.row.rates
    records.set(catalogueId, {
      ...head.row,
      productId: catalogueId,
      rates: { ...rates, aerPct: null, basis: 'fixed', terms },
      checkedAt: rows.map(({ row }) => row.checkedAt).sort()[0] ?? head.row.checkedAt,
    })
  }
  return records
}

export function withMarketData(
  products: readonly KnowledgeProduct[],
  market: readonly MarketProduct[],
): readonly KnowledgeProduct[] {
  const byId = catalogueRecords(market)

  return products.map((product) => {
    if (!CATALOGUE_MARKET_PRODUCT_IDS.has(product.id)) return product
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

/** The published catalogue with the committed CCPC snapshot over it: the default everywhere. */
export const publishedProducts: readonly KnowledgeProduct[] = withMarketData(
  demoKnowledgeBase.products,
  ccpcSnapshot.products,
)
