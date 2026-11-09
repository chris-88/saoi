import { z } from 'zod'
import {
  MARKET_CATEGORIES,
  MARKET_SOURCES,
  marketConditionsSchema,
  marketRatesSchema,
} from '../market/schema.ts'

/**
 * One stored version of a provider product, as the admin console reads it (`GET
 * /api/admin/market-products`). Snake case where the table is, camel case nowhere: this is the
 * row. `supersededAt` null marks the current version.
 *
 * `source` says where the row was read: the provider's own site (`bank`) or the CCPC comparison
 * tables (`ccpc`). A CCPC row carries `attribution`, which the console shows with it.
 */
export const marketProductVersionSchema = z.object({
  provider: z.string(),
  source: z.enum(MARKET_SOURCES),
  category: z.enum(MARKET_CATEGORIES),
  productId: z.string(),
  providerProductName: z.string(),
  rates: marketRatesSchema,
  conditions: marketConditionsSchema,
  sourceUrl: z.string(),
  /** The provider's own page for the product, where the source links one. */
  providerUrl: z.string().nullable(),
  /** The source's id for the product (CCPC's). */
  sourceProductId: z.string().nullable(),
  /** When the source says it last edited the record. */
  sourceUpdatedAt: z.string().nullable(),
  /** What has to be shown with the row under the source's re-use terms. */
  attribution: z.string().nullable(),
  /** Fields Saoi needs that the source does not give. */
  unknown: z.array(z.string()),
  effectiveFrom: z.string().nullable(),
  firstSeenAt: z.string(),
  checkedAt: z.string(),
  supersededAt: z.string().nullable(),
})

export const marketProductListSchema = z.object({
  items: z.array(marketProductVersionSchema),
  /** Rows that no longer match the schema and were left out. */
  skipped: z.number().int().nonnegative(),
})

export type MarketProductVersion = z.infer<typeof marketProductVersionSchema>
export type MarketProductList = z.infer<typeof marketProductListSchema>
