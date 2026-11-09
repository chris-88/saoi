import { boiProvider } from './boi.ts'
import type { MarketProvider } from './provider.ts'

/** Every provider the refresh runs, in order. A new provider is one line here. */
export const MARKET_PROVIDERS: readonly MarketProvider[] = [boiProvider]
