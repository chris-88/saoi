import type { MarketSource } from '../../supabase/functions/_shared/market/boi-sources.ts'
import type { MarketSnapshot, Provider } from '../../supabase/functions/_shared/market/schema.ts'
import type { Parser } from './boi.ts'

/**
 * One product read from the provider's site. `alsoRead` names further pages on the same origin
 * whose words the parser needs too (an FAQ stating who can open it); their HTML is appended to
 * the product page's, each page fetched once a run.
 */
export type ProviderSource = MarketSource & {
  readonly parse: Parser
  readonly alsoRead?: readonly string[]
}

/**
 * Everything the refresh needs to know about one provider. Adding a provider is one of these
 * (its sources, a parser per source, its committed snapshot) and a line in `providers.ts`;
 * nothing in `refresh.ts` names a provider.
 */
export type MarketProvider = {
  readonly provider: Provider
  /** robots.txt is read from here, and every URL below is checked against it. */
  readonly origin: string
  readonly sources: readonly ProviderSource[]
  /** A page naming the provider's current rate sheet, where it has one. */
  readonly rateSheet?: {
    readonly page: string
    readonly read: (html: string) => { url: string; asOf: string | null } | null
  }
  /** The committed snapshot: the diff's baseline without --db, and what --snapshot rewrites. */
  readonly snapshot: MarketSnapshot
}
