/**
 * Which CCPC rows are the Demo Bank catalogue's market-priced products.
 *
 * The catalogue (`tenants/demo/knowledge-base.ts`) is Bank of Ireland's retail offering, and six
 * of its savings and deposit products take every figure from the market: CCPC's rows for Bank
 * of Ireland, since CCPC is the source of every rate (Chris, 2026-11-13; they were read from
 * Bank of Ireland's own pages before). CCPC names products its own way and lists Advantage as
 * one row per term, so the pairing is by name, recorded here once, and the overlay
 * (`tenants/demo/market.ts`) folds the terms into the catalogue's one ladder.
 *
 * A CCPC product that matches no pair is not a catalogue product: "31 Day Set Notice Account" is
 * a different product from "365 31-Day Notice".
 */

export type CatalogueCcpcPair = {
  readonly provider: string
  /** The catalogue's product id. */
  readonly catalogueId: string
  /** Matches CCPC's product name. */
  readonly ccpcName: RegExp
  readonly category: 'savings' | 'deposit'
  /** For one rung of a ladder: which term. */
  readonly termMonths?: number
}

export const CATALOGUE_CCPC_PAIRS: readonly CatalogueCcpcPair[] = [
  {
    provider: 'boi',
    catalogueId: 'savings.supersaver',
    ccpcName: /^SuperSaver/i,
    category: 'savings',
  },
  {
    provider: 'boi',
    catalogueId: 'savings.goalsaver',
    ccpcName: /^GoalSaver/i,
    category: 'savings',
  },
  {
    provider: 'boi',
    catalogueId: 'savings.mortgagesaver',
    ccpcName: /^MortgageSaver/i,
    category: 'savings',
  },
  {
    provider: 'boi',
    catalogueId: 'savings.instant_access',
    ccpcName: /^Instant Access Demand/i,
    category: 'deposit',
  },
  {
    provider: 'boi',
    catalogueId: 'savings.notice_31_day',
    ccpcName: /^365 31-?Day Notice/i,
    category: 'deposit',
  },
  ...[6, 12, 18].map((months) => ({
    provider: 'boi',
    catalogueId: 'savings.advantage_fixed',
    ccpcName: new RegExp(`^Advantage ${String(months)} Month Fixed`, 'i'),
    category: 'deposit' as const,
    termMonths: months,
  })),
]

/** The catalogue products whose figures come from the market. */
export const CATALOGUE_MARKET_PRODUCT_IDS: ReadonlySet<string> = new Set(
  CATALOGUE_CCPC_PAIRS.map((pair) => pair.catalogueId),
)
