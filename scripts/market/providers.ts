import { boiProvider } from './boi.ts'
import { bunqProvider } from './bunq.ts'
import { mocoProvider } from './moco.ts'
import type { MarketProvider } from './provider.ts'

/** Every provider the refresh runs, in order. A new provider is one line here. */
export const MARKET_PROVIDERS: readonly MarketProvider[] = [boiProvider, bunqProvider, mocoProvider]
