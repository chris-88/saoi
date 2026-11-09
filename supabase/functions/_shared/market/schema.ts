import { z } from 'zod'

/**
 * Market data: what a provider publishes about a product Saoi models, read off the provider's
 * public website on a date.
 *
 * One record per provider product. `rates` is a union on `kind` so a mortgage or a loan can
 * join later as its own member without touching the deposit shape; this slice has only
 * deposits, because savings and deposits are release slice 1. A record states what the page
 * says and nothing else: a field the page does not state is left out, never guessed.
 *
 * Stored as versioned rows in `market_products` (a changed rate is a new row, the old one is
 * superseded) and as the committed snapshot `boi.snapshot.ts`, which `scripts/market/refresh.ts`
 * writes and which is the fallback when the table is empty.
 */

export const PROVIDERS = ['boi'] as const
export type Provider = (typeof PROVIDERS)[number]

/** Savings: regular saving by direct debit. Deposit: money placed, on demand, notice or term. */
export const MARKET_CATEGORIES = ['savings', 'deposit', 'mortgage', 'loan'] as const
export type MarketCategory = (typeof MARKET_CATEGORIES)[number]

/** A percentage as published, e.g. 2.48 for 2.48% AER. */
const pct = z.number().positive().max(20)
const eur = z.number().int().nonnegative().max(10_000_000)

export const depositRatesSchema = z
  .object({
    kind: z.literal('deposit'),
    /** The rate on money held. Null where the product is a term ladder instead. */
    aerPct: pct.nullable(),
    basis: z.enum(['fixed', 'variable']),
    /** How long a fixed headline lasts before it reverts. */
    fixedMonths: z.number().int().positive().max(120).optional(),
    /** What it reverts to, where the page says. */
    thenAerPct: pct.optional(),
    /** Where the headline only applies up to a balance, and what is paid above it. */
    tierCapEur: eur.optional(),
    aboveTierAerPct: pct.optional(),
    /** Where a lump sum earns something other than the headline. */
    lumpSumAerPct: pct.optional(),
    /** A fixed-term ladder, longest last. */
    terms: z
      .array(
        z
          .object({
            months: z.number().int().positive().max(120),
            aerPct: pct,
            /** The gross return over the whole term, where the page states it. */
            termReturnPct: pct.optional(),
          })
          .strict(),
      )
      .min(1)
      .optional(),
  })
  .strict()
  .refine((rates) => rates.aerPct !== null || rates.terms !== undefined, {
    message: 'a deposit needs a headline rate or a term ladder',
  })
  .refine((rates) => (rates.tierCapEur === undefined) === (rates.aboveTierAerPct === undefined), {
    message: 'a tier needs both its cap and the rate above it',
  })

export const marketRatesSchema = z.discriminatedUnion('kind', [depositRatesSchema])

export const savingsBonusSchema = z
  .object({
    amountEur: eur,
    /** Paid less DIRT. */
    lessDirt: z.boolean(),
    firstTimeBuyerOnly: z.boolean(),
    /** Only paid when the mortgage is drawn down with this provider. */
    requiresMortgageHere: z.boolean(),
    minMonthlyEur: eur,
    minMonths: z.number().int().positive(),
    minTotalEur: eur,
    /** The mortgage has to be drawn down within this many months of opening. */
    withinMonths: z.number().int().positive(),
  })
  .strict()

export const marketConditionsSchema = z
  .object({
    takesMonthly: z.boolean(),
    takesLumpSum: z.boolean(),
    minMonthlyEur: eur.optional(),
    maxMonthlyEur: eur.optional(),
    minLumpSumEur: eur.optional(),
    maxLumpSumEur: eur.optional(),
    minAge: z.number().int().positive().max(100).optional(),
    bonus: savingsBonusSchema.optional(),
  })
  .strict()

export const marketProductSchema = z
  .object({
    provider: z.enum(PROVIDERS),
    /** The catalogue id Saoi models the product as, e.g. `savings.supersaver`. */
    productId: z.string().regex(/^[a-z_]+(\.[a-z0-9_]+)+$/),
    category: z.enum(MARKET_CATEGORIES),
    /** The provider's own name for it, as the page heads it. */
    providerProductName: z.string().trim().min(1).max(120),
    rates: marketRatesSchema,
    conditions: marketConditionsSchema,
    sourceUrl: z.url(),
    /** When the page was last read and found to say this. */
    checkedAt: z.iso.datetime({ offset: true }),
    /** The date the rate took effect, where the page says. None of the current pages do. */
    effectiveFrom: z.iso.date().nullable(),
  })
  .strict()

export const marketSnapshotSchema = z
  .object({
    provider: z.enum(PROVIDERS),
    checkedAt: z.iso.datetime({ offset: true }),
    /** The provider's rate sheet, named on its rates page; its date moves when rates do. */
    rateSheet: z.object({ url: z.url(), asOf: z.iso.date().nullable() }).strict().nullable(),
    products: z.array(marketProductSchema).min(1),
  })
  .strict()

export type DepositRates = z.infer<typeof depositRatesSchema>
export type MarketRates = z.infer<typeof marketRatesSchema>
export type MarketConditions = z.infer<typeof marketConditionsSchema>
export type MarketProduct = z.infer<typeof marketProductSchema>
export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>
