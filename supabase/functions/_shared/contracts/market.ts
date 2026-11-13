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

/**
 * The admin's market categories (Chris, 2026-11-13). One to one with the schema's
 * (`MARKET_CATEGORIES`): `savings` is the regular saver, `deposits` money placed (fixed term,
 * and the instant-access and notice accounts CCPC lists in the same table; `access` tells them
 * apart).
 */
export const ADMIN_MARKET_CATEGORIES = [
  'savings',
  'deposits',
  'mortgages',
  'loans',
  'credit_cards',
  'current_accounts',
] as const
export type AdminMarketCategory = (typeof ADMIN_MARKET_CATEGORIES)[number]

/**
 * One product as the comparison engine sees it, for the admin's market screen
 * (`GET /api/admin/market/views`): a bank-direct row and its CCPC twin are one entry, and CCPC's
 * one-row-per-term deposits one ladder.
 */
export const adminMarketViewSchema = z
  .object({
    id: z
      .string()
      .describe('The engine’s view id: `<provider>:<productId>`, or `…ladder_…` for a ladder.'),
    provider: z.string().describe('The provider id: `boi`, `aib`.'),
    providerName: z
      .string()
      .describe('The readable name (`Bank of Ireland`); the id when none is recorded.'),
    category: z.enum(ADMIN_MARKET_CATEGORIES),
    categoryLabel: z
      .string()
      .describe('"Savings", "Deposits", "Mortgages", "Loans", "Credit cards", "Current accounts".'),
    name: z.string().describe('The product’s name; a ladder’s without the term.'),
    headline: z
      .object({
        ratePct: z.number().nullable(),
        label: z.string().describe('"2.48% AER", "3.20% initial", "APR 9.90%"; empty when none.'),
      })
      .describe('The one figure for a list. A ladder shows its shortest term’s.'),
    termMonths: z
      .number()
      .int()
      .nullable()
      .describe(
        'A deposit’s term (a ladder’s shortest), a mortgage’s fixed period, a loan’s longest term. Null for variable or none.',
      ),
    termLabel: z
      .string()
      .nullable()
      .describe('"18 months", "6 to 18 months", "4-year fixed", "variable", "up to 7 years".'),
    ladder: z
      .array(z.object({ months: z.number().int(), ratePct: z.number() }))
      .describe('A deposit’s terms and rates, shortest first. Empty for anything else.'),
    access: z
      .string()
      .nullable()
      .describe('Savings and deposits: "Instant access", "31 days’ notice", "Fixed term".'),
    lines: z.array(z.string()).describe('The rates as the comparison engine words them.'),
    conditions: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .describe(
        'Limits, fees, bonus, guarantee, who can open it, the checks the data cannot make, attribution.',
      ),
    unknown: z.array(z.string()).describe('What the source does not state, in words.'),
    checkedAt: z.string().describe('The oldest check of the rows the figures rest on.'),
    lastChangedAt: z.string().nullable(),
    stale: z.boolean().describe('Checked more than 8 whole days before `asOf`.'),
    retired: z
      .boolean()
      .describe(
        'Always false today: the engine builds views from current rows only, so a withdrawn product is not listed.',
      ),
    sources: z
      .array(
        z.object({
          source: z.enum(MARKET_SOURCES),
          rowId: z.string().describe('`<provider>:<productId>` of the row.'),
          url: z.string().nullable(),
          checkedAt: z.string(),
        }),
      )
      .describe('Every current row folded into the view: the figures’ rows, then any set aside.'),
  })
  .describe('One product as the comparison engine sees it: one entry per product, not per row.')

export const adminMarketViewsSchema = z.object({
  asOf: z.string().describe('When the views were built (ISO).'),
  views: z.array(adminMarketViewSchema),
})

export type AdminMarketView = z.infer<typeof adminMarketViewSchema>
export type AdminMarketViews = z.infer<typeof adminMarketViewsSchema>
