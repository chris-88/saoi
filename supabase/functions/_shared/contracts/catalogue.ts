import { z } from 'zod'

/**
 * The shapes a product and a mortgage rate must have to be written to the database (§51).
 *
 * These are the compiled files' own shapes, as Zod, so an edit in the console is held to the
 * same standard as the published pack and the test proves every published row passes. A row
 * that fails here is refused with a reason rather than stored and discovered at the next turn,
 * when `selectRates` or the savings engine would meet it.
 *
 * Deliberately not stricter than the pack. `pricing_and_rates` is a free-form object because the
 * pack states pricing in a different shape for almost every family and `rates.ts` reads the
 * shapes it knows; narrowing it here would reject real products.
 */

const line = z.string().trim().min(1).max(600)
const lines = z.array(line)

export const knowledgeProductSchema = z.object({
  /** `family.name`, e.g. `savings.supersaver`. The id is the key everything else uses. */
  id: z
    .string()
    .trim()
    .min(3)
    .max(80)
    // Dotted segments, as many as the pack uses: `savings.supersaver`, `mortgage.rate.high_value`.
    .regex(/^[a-z_]+(\.[a-z0-9_]+)+$/, 'an id looks like savings.supersaver'),
  name: z.string().trim().min(1).max(120),
  family: z.string().trim().min(1).max(60),
  subfamily: z.string().trim().max(60),
  product_type: z.string().trim().max(60),
  catalogue_status: z.string().trim().min(1).max(40),
  source_confidence: z.string().trim().max(40),
  customer_job: z.string().trim().max(600),
  best_for: lines,
  features: lines,
  benefits: lines,
  eligibility: lines,
  constraints_and_cautions: lines,
  pricing_and_rates: z.record(z.string(), z.unknown()),
  application_channels: lines,
  advice_model: z.string().trim().max(60),
  related_products: lines,
  assistant_usage: z.object({
    surface_when: lines.optional(),
    clarify: lines.optional(),
    must_not_say: lines.optional(),
    suppress_when: lines.optional(),
    defer_when: lines.optional(),
    positioning: z.union([lines, line]).optional(),
  }),
  freshness_class: z.string().trim().min(1).max(40),
  last_verified: z.string().trim().min(1).max(40),
  source_urls: z.array(z.string().trim().url().max(400)),
})

export const MORTGAGE_CUSTOMER_TYPES = [
  'first_time_buyer',
  'mover',
  'switcher',
  'existing_demo_mortgage',
  'buy_to_let_new',
] as const

export const BER_BANDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'BER Exempt', 'any'] as const

export const RATE_FAMILIES = [
  'standard_fixed_cashback',
  'high_value_fixed',
  'standard_variable',
  'existing_fixed',
  'buy_to_let_fixed',
  'buy_to_let_variable',
] as const

export const mortgageRateSchema = z.object({
  id: z.string().trim().min(1).max(80),
  customer_types: z.array(z.enum(MORTGAGE_CUSTOMER_TYPES)).min(1),
  rate_family: z.enum(RATE_FAMILIES),
  /** Null on a variable rate, which has no fixed period. */
  term_years: z.number().int().positive().max(40).nullable(),
  ber: z.enum(BER_BANDS),
  interest_rate_pct: z.number().positive().max(30),
  aprc_pct: z.number().positive().max(30).nullable(),
  cashback: z.object({ eligible: z.boolean(), structure: z.string().trim().max(300).optional() }),
  /** The High Value Mortgage floor. A rate with one may not be shown below it. */
  minimum_mortgage_amount_eur: z.number().nonnegative().nullable(),
  notes: lines,
})

export type KnowledgeProductInput = z.infer<typeof knowledgeProductSchema>
export type MortgageRateInput = z.infer<typeof mortgageRateSchema>

/** One row as the console reads it: the payload, whether it is on, and whether it differs from the pack. */
export const catalogueRowSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  /** True when the stored payload differs from the compiled one, or has no compiled counterpart. */
  edited: z.boolean(),
  /** True when the id exists in the compiled set, so "restore published" has something to restore. */
  published: z.boolean(),
  version: z.number().int(),
  updatedAt: z.string(),
})

export const productCatalogueListSchema = z.object({
  /** Whether any row exists. Empty means the functions are reading the compiled files. */
  loaded: z.boolean(),
  rows: z.array(catalogueRowSchema.extend({ product: knowledgeProductSchema })),
})

export const mortgageRatesListSchema = z.object({
  loaded: z.boolean(),
  asOf: z.string(),
  rows: z.array(catalogueRowSchema.extend({ rate: mortgageRateSchema })),
})

export type ProductCatalogueList = z.infer<typeof productCatalogueListSchema>
export type MortgageRatesList = z.infer<typeof mortgageRatesListSchema>
