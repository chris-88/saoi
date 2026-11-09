import { z } from 'zod'

/**
 * Market data: what a provider publishes about a product, read from a public source on a date.
 *
 * One record per provider product per source. A record is read either from the provider's own
 * website (`source: 'bank'`, deep: the conditions Saoi's engine reasons on) or from the
 * Competition and Consumer Protection Commission's comparison tables (`source: 'ccpc'`, broad:
 * every provider CCPC lists, in every category it compares). The two sit side by side with
 * their own history, so a CCPC row and a bank-direct row for the same product can be compared.
 *
 * A record states what its source says and nothing else. A field the source leaves out is
 * absent; a field Saoi would need and the source does not give is named in `unknown`, so no
 * consumer can read its absence as zero. Prose the source gives (introductory offers, bonuses,
 * extra information) is kept verbatim in `conditions.prose`, and every field CCPC states is kept
 * verbatim in `conditions.details`.
 *
 * Stored as versioned rows in `market_products` (a changed record is a new row, the old one is
 * superseded). Bank-direct Bank of Ireland data is also committed as `boi.snapshot.ts`, which is
 * the fallback when the table is empty.
 */

/** Provider ids are the bank's, whichever source the row came from: `boi`, `aib`, `ptsb`. */
export const providerIdSchema = z.string().regex(/^[a-z0-9_]{2,40}$/)
export type Provider = z.infer<typeof providerIdSchema>

export const MARKET_SOURCES = ['bank', 'ccpc'] as const
export type MarketSource = (typeof MARKET_SOURCES)[number]

/** What has to travel with every row read from CCPC (its re-use terms). */
export const CCPC_ATTRIBUTION =
  'Source: Competition and Consumer Protection Commission, www.ccpc.ie'

/**
 * Savings: regular saving by direct debit. Deposit: money placed, on demand, notice or term.
 * The rest are borrowing and day-to-day banking, read from CCPC only so far.
 */
export const MARKET_CATEGORIES = [
  'savings',
  'deposit',
  'mortgage',
  'loan',
  'credit_card',
  'current_account',
] as const
export type MarketCategory = (typeof MARKET_CATEGORIES)[number]

/** A percentage as published, e.g. 2.48 for 2.48% AER. Zero is a real rate (no interest). */
const savingPct = z.number().nonnegative().max(20)
const lendingPct = z.number().nonnegative().max(80)
const eur = z.number().nonnegative().max(100_000_000)

export const depositRatesSchema = z
  .object({
    kind: z.literal('deposit'),
    /** The rate on money held. Null where the product is a term ladder instead. */
    aerPct: savingPct.nullable(),
    /** Null where the source does not say; then `rates.basis` is in `unknown`. */
    basis: z.enum(['fixed', 'variable']).nullable(),
    /** How long a fixed headline lasts before it reverts. */
    fixedMonths: z.number().int().positive().max(120).optional(),
    /** What it reverts to, where the source says. */
    thenAerPct: savingPct.optional(),
    /** Where the headline only applies up to a balance, and what is paid above it. */
    tierCapEur: eur.optional(),
    aboveTierAerPct: savingPct.optional(),
    /** Where a lump sum earns something other than the headline. */
    lumpSumAerPct: savingPct.optional(),
    /** Every balance band as the source lists it, lowest first; `maxEur` null is open-ended. */
    tiers: z
      .array(z.object({ minEur: eur, maxEur: eur.nullable(), aerPct: savingPct }).strict())
      .min(1)
      .optional(),
    /** A fixed-term ladder, longest last. */
    terms: z
      .array(
        z
          .object({
            months: z.number().int().positive().max(120),
            aerPct: savingPct,
            /** The gross return over the whole term, where the page states it. */
            termReturnPct: savingPct.optional(),
          })
          .strict(),
      )
      .min(1)
      .optional(),
    /** One product, one term: a single fixed-term deposit as CCPC lists it. */
    termMonths: z.number().int().positive().max(600).optional(),
    /** Days of notice to withdraw. Zero is instant access. */
    noticeDays: z.number().int().nonnegative().max(1000).optional(),
    /**
     * A bonus rate that moves with a threshold (bunq): every euro earns `bonusAerPct` from the
     * first deposit until the first reset; at each reset (the first day of each month in
     * `resetMonths`) the threshold becomes the highest balance of the past `lookbackMonths`,
     * the balance up to it earns `baseTiers`, and only the part above it earns the bonus.
     * `aerPct` is then the bonus, the "up to" headline.
     */
    thresholdBonus: z
      .object({
        bonusAerPct: savingPct,
        resetMonths: z.array(z.number().int().min(1).max(12)).min(1).max(12),
        lookbackMonths: z.number().int().positive().max(24),
        /** Bands of the part up to the threshold, lowest first; `maxEur` null is open-ended. */
        baseTiers: z
          .array(z.object({ minEur: eur, maxEur: eur.nullable(), aerPct: savingPct }).strict())
          .min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((rates) => rates.aerPct !== null || rates.terms !== undefined, {
    message: 'a deposit needs a headline rate or a term ladder',
  })
  .refine((rates) => (rates.tierCapEur === undefined) === (rates.aboveTierAerPct === undefined), {
    message: 'a tier needs both its cap and the rate above it',
  })

export const MORTGAGE_CUSTOMER_TYPES = ['first_time_buyer', 'mover', 'switcher'] as const

export const mortgageRatesSchema = z
  .object({
    kind: z.literal('mortgage'),
    /** Null for a type CCPC lists that is neither; then `rates.rateType` is in `unknown`. */
    rateType: z.enum(['fixed', 'variable']).nullable(),
    /** The fixed period, in years. Null on a variable rate. */
    fixedYears: z.number().int().positive().max(40).nullable(),
    initialRatePct: lendingPct,
    /** What the rate is expected to become after the fixed period, where the source says. */
    followOnRatePct: lendingPct.nullable(),
    /** CCPC's "rate for full term". Not stated to be the APRC, so the APRC is in `unknown`. */
    fullTermRatePct: lendingPct.nullable(),
    ltvMinPct: z.number().nonnegative().max(100).nullable(),
    ltvMaxPct: z.number().nonnegative().max(100).nullable(),
    /** The BER band the rate is for (`A`, `B3`, `Exempt`), or null when it is for any. */
    ber: z.string().trim().min(1).max(20).nullable(),
    cashback: z.boolean().nullable(),
    /** Which of CCPC's mortgage lists the product appears in. */
    customerTypes: z.array(z.enum(MORTGAGE_CUSTOMER_TYPES)).min(1),
  })
  .strict()

export const loanRatesSchema = z
  .object({
    kind: z.literal('loan'),
    /** CCPC labels the figure "Interest rate (APR)". */
    aprPct: lendingPct,
    rateType: z.enum(['fixed', 'variable']).nullable(),
    maxAmountEur: eur.nullable(),
    maxTermMonths: z.number().int().positive().max(600).nullable(),
    /** CCPC's purpose flags, as it names them: `Personal loans`, `Car loans`, ... */
    purposes: z.array(z.string().trim().min(1).max(60)),
  })
  .strict()

export const creditCardRatesSchema = z
  .object({
    kind: z.literal('credit_card'),
    aprPct: lendingPct.nullable(),
    purchaseRatePct: lendingPct.nullable(),
    cashRatePct: lendingPct.nullable(),
    /** Months of the introductory balance-transfer rate, where stated. */
    balanceTransferIntroMonths: z.number().int().nonnegative().max(120).nullable(),
    balanceTransferIntroPct: lendingPct.nullable(),
  })
  .strict()

export const currentAccountRatesSchema = z
  .object({
    kind: z.literal('current_account'),
    /** The account maintenance fee per quarter, where CCPC states it as a number. */
    quarterlyFeeEur: eur.nullable(),
    creditInterestPct: savingPct.nullable(),
    overdraft: z.boolean().nullable(),
  })
  .strict()

export const marketRatesSchema = z.discriminatedUnion('kind', [
  depositRatesSchema,
  mortgageRatesSchema,
  loanRatesSchema,
  creditCardRatesSchema,
  currentAccountRatesSchema,
])

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

export const INTEREST_PAID = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
  'account_anniversary',
  'maturity',
] as const

/**
 * Who can open a product, read from the provider's own page. Every field is what the page
 * states; a field it does not state is absent, never assumed.
 */
export const eligibilitySchema = z
  .object({
    /** The country the holder must live in. */
    residentIn: z.string().trim().min(1).max(60).optional(),
    /** Closed to citizens of the United States. */
    notForUsCitizens: z.boolean().optional(),
    /** Only individuals, not companies or clubs. */
    individualsOnly: z.boolean().optional(),
    /** Whether joint accounts can be opened. */
    jointAccounts: z.boolean().optional(),
    /** Another account with the provider that has to be held first, in the page's words. */
    needsAccountWithProvider: z.string().trim().min(1).max(120).optional(),
  })
  .strict()

const verbatim = z.record(z.string().max(200), z.string().max(20_000))

export const marketConditionsSchema = z
  .object({
    /** Whether it takes monthly saving and lump sums. Absent where the source does not say. */
    takesMonthly: z.boolean().optional(),
    takesLumpSum: z.boolean().optional(),
    minMonthlyEur: eur.optional(),
    maxMonthlyEur: eur.optional(),
    minLumpSumEur: eur.optional(),
    maxLumpSumEur: eur.optional(),
    minAge: z.number().int().positive().max(100).optional(),
    /** Who can open it, as the provider's own page states it. Absent: not stated. */
    eligibility: eligibilitySchema.optional(),
    /** How often interest is credited, as the provider states it. */
    interestPaid: z.enum(INTEREST_PAID).optional(),
    /**
     * The stated rate is for accounts opened now; accounts already open may earn another rate
     * (MoCo publishes existing accounts' rate only after login).
     */
    rateForNewAccounts: z.boolean().optional(),
    bonus: savingsBonusSchema.optional(),
    /** The source's own prose, verbatim: introductory offers, bonuses, extra information. */
    prose: verbatim.optional(),
    /** Every field the source states, by its own label, verbatim. */
    details: verbatim.optional(),
  })
  .strict()

export const marketProductSchema = z
  .object({
    /** The bank's id, whichever source the row came from. */
    provider: providerIdSchema,
    source: z.enum(MARKET_SOURCES),
    /**
     * Saoi's id for the product. Bank-direct rows use the catalogue id they model
     * (`savings.supersaver`); CCPC rows use `<category>.c<CCPC id>`.
     */
    productId: z.string().regex(/^[a-z_]+(\.[a-z0-9_]+)+$/),
    category: z.enum(MARKET_CATEGORIES),
    /** The provider's own name for it, as the source heads it. */
    providerProductName: z.string().trim().min(1).max(200),
    rates: marketRatesSchema,
    conditions: marketConditionsSchema,
    /** Where the row was read: the bank's page, or the CCPC comparison tool. */
    sourceUrl: z.url(),
    /** The provider's page for the product, where the source links one. */
    providerUrl: z.url().nullable().optional(),
    /** The source's own id for the product (CCPC's), where it has one. */
    sourceProductId: z.string().max(40).nullable().optional(),
    /** When the source says it last edited the record. CCPC states it for cards and accounts. */
    sourceUpdatedAt: z.iso.datetime({ offset: true, local: true }).nullable().optional(),
    /** Required attribution for the source's re-use terms, where there is one. */
    attribution: z.string().max(200).nullable().optional(),
    /** Fields Saoi needs that the source does not give, as paths: `rates.thenAerPct`. */
    unknown: z.array(z.string().max(80)).optional(),
    /** When the row was read and found to say this. */
    checkedAt: z.iso.datetime({ offset: true }),
    /** The date the rate took effect, where the source says. None do so far. */
    effectiveFrom: z.iso.date().nullable(),
  })
  .strict()

export const marketSnapshotSchema = z
  .object({
    provider: providerIdSchema,
    checkedAt: z.iso.datetime({ offset: true }),
    /** The provider's rate sheet, named on its rates page; its date moves when rates do. */
    rateSheet: z.object({ url: z.url(), asOf: z.iso.date().nullable() }).strict().nullable(),
    products: z.array(marketProductSchema).min(1),
  })
  .strict()

export type DepositRates = z.infer<typeof depositRatesSchema>
export type MortgageRates = z.infer<typeof mortgageRatesSchema>
export type LoanRates = z.infer<typeof loanRatesSchema>
export type CreditCardRates = z.infer<typeof creditCardRatesSchema>
export type CurrentAccountRates = z.infer<typeof currentAccountRatesSchema>
export type MarketRates = z.infer<typeof marketRatesSchema>
export type MarketConditions = z.infer<typeof marketConditionsSchema>
export type MarketProduct = z.infer<typeof marketProductSchema>
export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>

/** A savings or deposit record: the only kind the catalogue overlay and the engine read. */
export type DepositMarketProduct = MarketProduct & { readonly rates: DepositRates }

export function isDepositRecord(product: MarketProduct): product is DepositMarketProduct {
  return product.rates.kind === 'deposit'
}

/** The deposit rates of a record, or a thrown error: for tests and generated data only. */
export function depositRatesOf(product: MarketProduct): DepositRates {
  if (product.rates.kind !== 'deposit') {
    throw new Error(`${product.productId} is a ${product.rates.kind}, not a deposit`)
  }
  return product.rates
}
