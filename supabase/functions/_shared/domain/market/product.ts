import type { ProductDetail } from '../../contracts/market-tools.ts'
import type { MarketRates } from '../../market/schema.ts'
import type { Market } from './types.ts'

/**
 * One product in full: the view, every version Saoi has recorded of the rows behind it, and the
 * source's own words. Takes a view id (`aib:deposit.ladder_personal_fixed_term_deposit`) or the
 * id of any row folded into one (`aib:deposit.c3743`).
 */
export function productDetail(market: Market, id: string): ProductDetail | null {
  const viewId = market.products.some((product) => product.id === id)
    ? id
    : market.viewOfRow.get(id)
  const product = market.products.find((candidate) => candidate.id === viewId)
  if (viewId === undefined || product === undefined) return null
  const records = market.recordsOf.get(viewId) ?? []

  return {
    product,
    history: [...records]
      .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))
      .map((record) => ({
        source: record.product.source,
        productId: record.product.productId,
        from: record.firstSeenAt,
        to: record.supersededAt,
        headline: headlineOf(record.product.rates),
      })),
    verbatim: records
      .filter((record) => record.supersededAt === null)
      .map((record) => ({
        source: record.product.source,
        productId: record.product.productId,
        prose: { ...(record.product.conditions.prose ?? {}) },
        details: { ...(record.product.conditions.details ?? {}) },
      })),
  }
}

const pct = (value: number): string => `${value.toFixed(2)}%`

export function headlineOf(rates: MarketRates): string {
  switch (rates.kind) {
    case 'deposit':
      if (rates.terms !== undefined) {
        return (
          rates.terms.map((term) => `${String(term.months)}m ${pct(term.aerPct)}`).join(', ') +
          ' AER'
        )
      }
      return `${rates.aerPct === null ? 'no headline' : pct(rates.aerPct)} AER${
        rates.termMonths === undefined ? '' : `, ${String(rates.termMonths)} months`
      }`
    case 'mortgage':
      return `${pct(rates.initialRatePct)} ${rates.rateType ?? ''}${
        rates.fixedYears === null ? '' : ` ${String(rates.fixedYears)}y`
      }`.trim()
    case 'loan':
      return `${pct(rates.aprPct)} APR`
    case 'credit_card':
      return rates.aprPct === null ? 'APR not stated' : `${pct(rates.aprPct)} APR`
    case 'current_account':
      return rates.quarterlyFeeEur === null
        ? 'fee not stated'
        : `€${rates.quarterlyFeeEur.toFixed(2)} a quarter`
  }
}
