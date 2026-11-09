import { z } from 'zod'
import { MARKET_CATEGORIES, marketConditionsSchema, marketRatesSchema } from '../market/schema.ts'

/**
 * One stored version of a provider product, as the admin console reads it (`GET
 * /api/admin/market-products`). Snake case where the table is, camel case nowhere: this is the
 * row. `supersededAt` null marks the current version.
 */
export const marketProductVersionSchema = z.object({
  provider: z.string(),
  category: z.enum(MARKET_CATEGORIES),
  productId: z.string(),
  providerProductName: z.string(),
  rates: marketRatesSchema,
  conditions: marketConditionsSchema,
  sourceUrl: z.string(),
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
