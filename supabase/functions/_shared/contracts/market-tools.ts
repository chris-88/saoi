import { z } from 'zod'
import { LOCAL_AREAS } from '../market/areas.ts'
import {
  INTEREST_PAID,
  MARKET_CATEGORIES,
  MARKET_SOURCES,
  MORTGAGE_CUSTOMER_TYPES,
} from '../market/schema.ts'
import {
  PLAN_DEBT_KINDS,
  PLAN_GOAL_KINDS,
  marketPlanSchema,
  planDebtSchema,
  planGoalSchema,
} from './market-plan.ts'

/**
 * The public comparison API: `/api/market/*` and `/api/calc/*` on saoi-api, the engine behind
 * the Saoi MCP tools (`saoi_search_products`, `saoi_product`, `saoi_review_situation`,
 * `saoi_savings_projection`, `saoi_mortgage`, `saoi_debt`, `saoi_build_plan`).
 *
 * Every figure is worked out by `_shared/domain/market/` from the market data in
 * `market_products`. Nothing sent is stored except a plan from build-plan or money-check (24
 * hours behind its link unless opened) and one anonymous, banded record per home-calculator run
 * (no figures, no identifiers). The descriptions here become the OpenAPI document, and
 * the MCP tool descriptions are generated from that, so they are written for a model reading
 * them cold: what the field is, its unit, and what an absent value means.
 *
 * Information, not advice: results are ranked by an objective the caller chooses, and say which.
 */

const eur = z.number().nonnegative().max(100_000_000)
const pct = z.number().nonnegative().max(80)
const text = (max: number) => z.string().trim().min(1).max(max)
/** A month or a day: "2028-06" or "2028-06-30". */
const monthOrDay = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'expected YYYY-MM or YYYY-MM-DD')
const horizon = z.number().int().positive().max(480)

// ---------------------------------------------------------------------------------------------
// The comparable product view
// ---------------------------------------------------------------------------------------------

export const ACCESS_KINDS = ['instant', 'notice', 'fixed_term'] as const
export type AccessKind = (typeof ACCESS_KINDS)[number]

export const unknownFieldSchema = z
  .object({
    field: z.string().describe('The path in the source record, e.g. `rates.thenAerPct`.'),
    meaning: z.string().describe('What is not known, in words.'),
  })
  .describe(
    'A figure the source does not give. It is never treated as zero: a calculation that needs it stops and says so.',
  )

export const provenanceSchema = z
  .object({
    source: z
      .enum(MARKET_SOURCES)
      .describe(
        '`bank`: read from the provider’s own website. `ccpc`: read from the Competition and Consumer Protection Commission’s comparison tables.',
      ),
    sourceUrl: z.string().describe('Where the figures were read.'),
    providerUrl: z.string().nullable().describe('The provider’s own page, where known.'),
    checkedAt: z.string().describe('When Saoi last read the source and found these figures.'),
    lastChangedAt: z
      .string()
      .nullable()
      .describe(
        'When Saoi last saw the figures change. Null when they have not changed since Saoi first recorded them.',
      ),
    firstRecordedAt: z.string().describe('When Saoi first recorded this product.'),
    attribution: z
      .string()
      .nullable()
      .describe('Required attribution under the source’s re-use terms. Show it with the figures.'),
    rows: z
      .array(z.object({ source: z.enum(MARKET_SOURCES), productId: z.string() }))
      .describe('The source rows this product view is built from (several for a term ladder).'),
    preferredOver: z
      .array(
        z.object({
          source: z.enum(MARKET_SOURCES),
          productId: z.string(),
          providerProductName: z.string(),
        }),
      )
      .describe(
        'Rows for the same product from another source, set aside because the provider’s own page is read directly.',
      ),
  })
  .describe('Where the figures came from and how fresh they are. Nothing here is estimated.')

export const platformSchema = z
  .object({
    name: z.literal('Raisin'),
    note: z.string(),
  })
  .describe(
    'Opened through a deposit platform rather than with the bank directly. The platform account comes first.',
  )

export const depositGuaranteeSchema = z
  .object({
    scheme: z
      .string()
      .nullable()
      .describe(
        'The scheme that protects the deposit, e.g. "Deposit Guarantee Scheme (Central Bank of Ireland)", "Dutch Deposit Guarantee Scheme (De Nederlandsche Bank)". Null: not recorded.',
      ),
    country: z.string().nullable(),
    coverEur: eur
      .nullable()
      .describe(
        'Cover per person per institution, where a limit is known. Null: no limit recorded (see `note`).',
      ),
    note: z
      .string()
      .nullable()
      .describe(
        'Anything that changes how the cover reads, e.g. a shared licence or a State guarantee with no limit.',
      ),
    basis: z
      .enum(['stated_by_source', 'recorded_by_saoi', 'unknown'])
      .describe(
        '`recorded_by_saoi`: Saoi’s record, read from a primary page (`sourceUrl`, `checkedOn`). `stated_by_source`: the comparison source’s own text names the scheme. `unknown`: neither; confirm with the provider.',
      ),
    sourceUrl: z
      .string()
      .nullable()
      .describe(
        'The primary page the record was read from: the provider’s site, the Central Bank of Ireland, depositguarantee.ie.',
      ),
    checkedOn: z.string().nullable().describe('When that page was read: YYYY-MM-DD.'),
  })
  .describe('Which deposit guarantee scheme covers the money, and where that was read.')

export const depositTermsSchema = z.object({
  kind: z.literal('deposit'),
  access: z
    .enum(ACCESS_KINDS)
    .describe(
      '`instant`: withdraw any time. `notice`: withdraw after `noticeDays`. `fixed_term`: locked for a term.',
    ),
  noticeDays: z.number().int().nonnegative().nullable(),
  aerPct: pct.nullable().describe('The headline AER, percent. Null for a term ladder.'),
  basis: z.enum(['fixed', 'variable']).nullable(),
  bands: z
    .array(z.object({ fromEur: eur, toEur: eur.nullable(), aerPct: pct }))
    .describe('Balance bands, lowest first. A balance in a band earns that band’s rate.'),
  lumpSumAerPct: pct
    .nullable()
    .describe('What a lump sum earns where it differs from the headline.'),
  introductory: z
    .object({
      months: z.number().int().positive(),
      thenAerPct: pct.nullable().describe('The rate after it. Null: not known.'),
    })
    .nullable()
    .describe('A rate guaranteed for a period, and what follows it.'),
  ladder: z
    .array(
      z.object({
        months: z.number().int().positive(),
        aerPct: pct,
        productId: z.string().describe('The source row for this term.'),
      }),
    )
    .describe('Fixed terms on offer, shortest first. Empty when the product is not a ladder.'),
  takesMonthly: z.boolean().nullable().describe('Takes regular monthly saving. Null: not known.'),
  takesLumpSum: z.boolean().nullable().describe('Takes a lump sum. Null: not known.'),
  minMonthlyEur: eur.nullable(),
  maxMonthlyEur: eur.nullable().describe('The most that can be paid in each month.'),
  minLumpSumEur: eur.nullable(),
  maxLumpSumEur: eur.nullable(),
  thresholdBonus: z
    .object({
      bonusAerPct: pct,
      resetMonths: z.array(z.number().int()),
      lookbackMonths: z.number().int(),
      baseBands: z.array(z.object({ fromEur: eur, toEur: eur.nullable(), aerPct: pct })),
    })
    .nullable()
    .describe(
      'A bonus that gives way to base rates (bunq): every euro earns the bonus until the first reset (the first day of each month in `resetMonths`); then the threshold is the highest balance of the past `lookbackMonths`, the balance up to it earns `baseBands`, and only the part above it earns the bonus.',
    ),
  interestPaid: z
    .enum(INTEREST_PAID)
    .nullable()
    .describe('How often interest is credited, as the provider states it. Null: not stated.'),
  rateForNewAccounts: z
    .boolean()
    .describe(
      'The rate is for accounts opened now; an account already open may earn another rate.',
    ),
  dirtApplies: z
    .boolean()
    .describe(
      'Whether DIRT (33%) is deducted from interest. State Savings products are DIRT-free.',
    ),
  bonus: z
    .object({ amountEur: eur, conditions: z.array(z.string()) })
    .nullable()
    .describe('A conditional bonus, kept apart from interest.'),
})

export const mortgageTermsSchema = z.object({
  kind: z.literal('mortgage'),
  rateType: z.enum(['fixed', 'variable']).nullable(),
  fixedYears: z.number().int().positive().nullable(),
  initialRatePct: pct,
  followOnRatePct: pct
    .nullable()
    .describe('What the provider says the rate may become after the fixed period.'),
  fullTermRatePct: pct.nullable().describe('CCPC’s “rate for full term”.'),
  ltvMinPct: z.number().nullable(),
  ltvMaxPct: z.number().nullable(),
  ber: z.string().nullable().describe('The Building Energy Rating the rate is for. Null: any BER.'),
  berFromName: z.boolean().describe('The BER was read from the product’s name.'),
  buyerTypes: z.array(z.enum(MORTGAGE_CUSTOMER_TYPES)),
  cashback: z.object({
    offered: z.boolean().nullable(),
    pct: z
      .number()
      .nullable()
      .describe('Cashback as a percent of the loan, where the source states one.'),
    stated: z.string().nullable().describe('The source’s own words.'),
  }),
  fees: z.record(z.string(), z.string()).describe('Fees as the source states them, verbatim.'),
  highValue: z.boolean().describe('A high-value-mortgage rate (larger loans only).'),
  minLoanEur: eur
    .nullable()
    .describe(
      'The smallest loan the rate is for, where the source states one ("borrowing €250,000 or more"). Null: not stated; for a high-value rate that means the threshold is unknown, not absent.',
    ),
})

export const loanTermsSchema = z.object({
  kind: z.literal('loan'),
  aprPct: pct,
  rateType: z.enum(['fixed', 'variable']).nullable(),
  maxAmountEur: eur.nullable(),
  maxTermMonths: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe('Null where the source gives no unit for the maximum term.'),
  maxTermStated: z.string().nullable().describe('The maximum term as the source states it.'),
  purposes: z.array(z.string()),
  setupFees: z.string().nullable(),
})

export const creditCardTermsSchema = z.object({
  kind: z.literal('credit_card'),
  aprPct: pct.nullable(),
  purchaseRatePct: pct.nullable(),
  cashRatePct: pct.nullable(),
  balanceTransfer: z
    .object({ introMonths: z.number().int().nonnegative(), introPct: pct })
    .nullable(),
})

export const currentAccountTermsSchema = z.object({
  kind: z.literal('current_account'),
  quarterlyFeeEur: eur.nullable(),
  annualFeeEur: eur.nullable(),
  creditInterestPct: pct.nullable(),
  overdraft: z.boolean().nullable(),
})

export const productTermsSchema = z.discriminatedUnion('kind', [
  depositTermsSchema,
  mortgageTermsSchema,
  loanTermsSchema,
  creditCardTermsSchema,
  currentAccountTermsSchema,
])

export const productViewSchema = z
  .object({
    id: z
      .string()
      .describe(
        'Saoi’s id for the product view: `<provider>:<productId>`. Pass it to the product route.',
      ),
    provider: z.string().describe('The provider id: `boi`, `aib`, `ptsb`.'),
    providerName: z.string(),
    name: z.string().describe('The provider’s own name for the product.'),
    category: z.enum(MARKET_CATEGORIES),
    terms: productTermsSchema,
    provenance: provenanceSchema,
    platform: platformSchema.nullable(),
    depositGuarantee: depositGuaranteeSchema.nullable(),
    unknowns: z.array(unknownFieldSchema),
    eligibility: z
      .object({
        minAge: z.number().int().nullable(),
        residentIn: z.string().nullable().describe('The country the holder must live in.'),
        notForUsCitizens: z.boolean().nullable(),
        individualsOnly: z.boolean().nullable(),
        jointAccounts: z.boolean().nullable().describe('Whether joint accounts can be opened.'),
        needsAccountWithProvider: z
          .string()
          .nullable()
          .describe('Another account with the provider to hold first, in its own words.'),
      })
      .nullable()
      .describe(
        'Who can open it, as the provider’s own page states it; a field it does not state is null. Null when no provider page recording it was read.',
      ),
    rateConfirmed: z
      .boolean()
      .describe(
        'False for a savings or deposit rate read only from CCPC with nothing stated about what follows it: the provider may pay it only for a period, or only on part of the balance. Shown as a flag when it ranks in the top three.',
      ),
    checks: z
      .array(z.string())
      .describe(
        'Eligibility the data cannot confirm. The source does not record who can open a product, so check with the provider.',
      ),
  })
  .describe('One product in one comparable shape, whichever source it was read from.')

export type UnknownField = z.infer<typeof unknownFieldSchema>
export type Provenance = z.infer<typeof provenanceSchema>
export type DepositGuarantee = z.infer<typeof depositGuaranteeSchema>
export type DepositTerms = z.infer<typeof depositTermsSchema>
export type MortgageTerms = z.infer<typeof mortgageTermsSchema>
export type LoanTerms = z.infer<typeof loanTermsSchema>
export type CreditCardTerms = z.infer<typeof creditCardTermsSchema>
export type CurrentAccountTerms = z.infer<typeof currentAccountTermsSchema>
export type ProductTerms = z.infer<typeof productTermsSchema>
export type ProductView = z.infer<typeof productViewSchema>

export const productDetailSchema = z.object({
  product: productViewSchema,
  history: z
    .array(
      z.object({
        source: z.enum(MARKET_SOURCES),
        productId: z.string(),
        from: z.string().describe('When Saoi first saw this version.'),
        to: z.string().nullable().describe('When it was replaced. Null: current.'),
        headline: z.string().describe('The headline figure of this version, e.g. "3.00% AER".'),
      }),
    )
    .describe('Every version Saoi has recorded, newest first.'),
  verbatim: z
    .array(
      z.object({
        source: z.enum(MARKET_SOURCES),
        productId: z.string(),
        prose: z.record(z.string(), z.string()),
        details: z.record(z.string(), z.string()),
      }),
    )
    .describe('The source’s own words for each row, unedited: offers, conditions, fees.'),
})
export type ProductDetail = z.infer<typeof productDetailSchema>

// ---------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------

export const OBJECTIVES = [
  'highest_net_return',
  'easiest_access',
  'lowest_total_cost',
  'lowest_monthly_repayment',
] as const
export type Objective = (typeof OBJECTIVES)[number]

export const LOAN_PURPOSES = [
  'personal',
  'car',
  'home_improvement',
  'energy_upgrade',
  'holiday',
  'student',
] as const

export const searchRequestSchema = z
  .object({
    category: z
      .enum(MARKET_CATEGORIES)
      .describe(
        '`savings`: regular monthly saving. `deposit`: a lump sum (instant access, notice, fixed term). `mortgage`, `loan`, `credit_card`, `current_account`.',
      ),
    amount: eur
      .optional()
      .describe(
        'Savings and deposits: the lump sum. Loans: the amount to borrow. Cards: the balance carried.',
      ),
    monthlyAmount: eur.optional().describe('Savings: what is paid in each month.'),
    horizonMonths: horizon
      .optional()
      .describe(
        'Savings and deposits: how long until the money is needed. Default 12. No fixed term longer than this is shown.',
      ),
    access: z
      .enum([...ACCESS_KINDS, 'any'])
      .optional()
      .describe('Savings and deposits: only this kind of access. Default any.'),
    maxNoticeDays: z.number().int().nonnegative().max(1000).optional(),
    providers: z
      .array(z.string().regex(/^[a-z0-9_]{2,40}$/))
      .max(30)
      .optional(),
    buyerType: z
      .enum(MORTGAGE_CUSTOMER_TYPES)
      .optional()
      .describe('Mortgages: whose list to search. Default first_time_buyer.'),
    propertyValue: eur.optional().describe('Mortgages: the property’s value.'),
    loanAmount: eur.optional().describe('Mortgages: the amount to borrow.'),
    termYears: z
      .number()
      .int()
      .min(1)
      .max(40)
      .optional()
      .describe('Mortgages: the term. Default 30.'),
    ber: z
      .string()
      .regex(/^([A-G][1-3]?|Exempt)$/i)
      .optional()
      .describe(
        'Mortgages: the BER. Without it, BER-specific (green) rates are left out and counted.',
      ),
    termMonths: z
      .number()
      .int()
      .positive()
      .max(480)
      .optional()
      .describe('Loans: the term to repay over. Default 60.'),
    purpose: z.enum(LOAN_PURPOSES).optional().describe('Loans: only loans for this purpose.'),
    objective: z
      .enum(OBJECTIVES)
      .optional()
      .describe(
        'What to rank by. Default `highest_net_return` for savings and deposits, `lowest_total_cost` for the rest. `easiest_access` applies to savings and deposits; `lowest_monthly_repayment` to mortgages and loans.',
      ),
    limit: z.number().int().min(1).max(25).optional().describe('How many results. Default 5.'),
  })
  .describe('What to compare and for which figures.')
export type SearchRequest = z.infer<typeof searchRequestSchema>

const stopSchema = z
  .object({
    afterMonths: z.number().int().nonnegative(),
    reason: z.string(),
  })
  .describe('Where a projection stops because the next rate is not known.')

export const savingsFiguresSchema = z.object({
  kind: z.literal('savings'),
  horizonMonths: z.number().int(),
  knownMonths: z
    .number()
    .int()
    .describe(
      'Months the figures cover. Less than the horizon when a rate after that is not known.',
    ),
  termMonths: z.number().int().nullable().describe('The fixed term used, for a ladder.'),
  paidIn: eur,
  grossInterest: eur,
  dirt: eur,
  netInterest: eur.describe('Interest after DIRT over the months covered.'),
  endBalance: eur,
  netRatePct: z
    .number()
    .describe('Interest after DIRT as an annual rate on the money held over the months covered.'),
  stop: stopSchema.nullable(),
  notPlaced: z
    .object({ lumpSum: eur, monthly: eur })
    .describe('Money the product cannot take: above its cap, or a kind it does not take.'),
})

export const mortgageFiguresSchema = z.object({
  kind: z.literal('mortgage'),
  loanAmount: eur,
  ltvPct: z.number().nullable(),
  termYears: z.number().int(),
  monthlyRepayment: eur,
  monthlyAfterFixed: eur.nullable().describe('At the follow-on rate, where stated.'),
  paidDuringFixed: eur.nullable(),
  totalRepaid: eur
    .nullable()
    .describe('Over the whole term, assuming the follow-on rate holds after the fixed period.'),
  cashbackEur: eur.nullable(),
  totalCostAfterCashback: z.number().nullable().describe('Interest over the term less cashback.'),
})

export const loanFiguresSchema = z.object({
  kind: z.literal('loan'),
  amount: eur,
  termMonths: z.number().int(),
  monthlyRepayment: eur,
  totalRepaid: eur,
  totalInterest: eur,
})

export const cardFiguresSchema = z.object({
  kind: z.literal('credit_card'),
  balance: eur,
  interestOver12Months: eur
    .nullable()
    .describe('On the balance held for 12 months with nothing repaid, at the stated rates.'),
})

export const accountFiguresSchema = z.object({
  kind: z.literal('current_account'),
  annualFeeEur: eur.nullable(),
})

export const figuresSchema = z.discriminatedUnion('kind', [
  savingsFiguresSchema,
  mortgageFiguresSchema,
  loanFiguresSchema,
  cardFiguresSchema,
  accountFiguresSchema,
])
export type SavingsFigures = z.infer<typeof savingsFiguresSchema>
export type MortgageFigures = z.infer<typeof mortgageFiguresSchema>
export type LoanFigures = z.infer<typeof loanFiguresSchema>
export type Figures = z.infer<typeof figuresSchema>

export const rankingSchema = z
  .object({
    objective: z.enum(OBJECTIVES),
    basis: z.string().describe('What the ranking measures, stated with the inputs.'),
  })
  .describe(
    'How the results are ordered. Information, not advice: the caller can change the objective.',
  )

export const searchResultSchema = z.object({
  rank: z.number().int().positive(),
  product: productViewSchema,
  figures: figuresSchema,
  flags: z
    .array(z.string())
    .describe('What to know before relying on the figures: platform, eligibility, unknowns.'),
})
export type SearchResult = z.infer<typeof searchResultSchema>

export const searchResponseSchema = z.object({
  ranking: rankingSchema,
  results: z.array(searchResultSchema),
  matched: z.number().int().describe('Products that met the filters, before the limit.'),
  excluded: z
    .array(z.object({ reason: z.string(), count: z.number().int() }))
    .describe('Products left out, and why.'),
  assumptions: z.array(z.string()),
  dataCheckedAt: z.string().nullable().describe('When the oldest figure shown was last checked.'),
  attributions: z.array(z.string()),
})
export type SearchResponse = z.infer<typeof searchResponseSchema>

// ---------------------------------------------------------------------------------------------
// The customer's situation, as their AI describes it
// ---------------------------------------------------------------------------------------------

/** A debt as the customer described it: the plan contract's own shape. */
export const DEBT_KINDS = PLAN_DEBT_KINDS
export const DEBT_PLAN_CHOICES = ['clear', 'keep', 'compare'] as const
export const debtSchema = planDebtSchema.extend({
  plan: z
    .enum(DEBT_PLAN_CHOICES)
    .optional()
    .describe(
      'For saoi_build_plan, what the customer wants modelled for this debt. `compare` (default): worked out both ways, cleared from savings and kept, and the plan takes the one leaving more. `keep`: kept and repaid as it is, still owed in the net position. `clear`: cleared from the savings held. To model keeping a debt, send it with `plan: "keep"`; never leave it out, or the plan has no debt to set against the savings.',
    ),
})
export type Debt = z.infer<typeof debtSchema>

export const heldSavingsSchema = z.object({
  label: text(80).describe('In the customer’s words: "current account", "credit union".'),
  balance: eur,
  provider: text(60).optional(),
  aerPct: pct
    .optional()
    .describe(
      'What it earns now, if the customer said. Absent on a savings account: not known (never treated as zero). Absent on a current account: counted at the credit interest CCPC states for current accounts (0% in practice), with that basis stated.',
    ),
  access: z
    .enum([...ACCESS_KINDS, 'current_account'])
    .optional()
    .describe(
      'Where the money is. `current_account` for money in a current account ("sitting in my current account"): it is counted as earning what CCPC states current accounts pay (0% in practice), so moving it counts as money found. `instant`, `notice`, `fixed_term` for a savings or deposit account. Absent: read from the label ("current account" counts as one).',
    ),
  fixedTermEndsOn: monthOrDay.optional(),
})

/** A goal, in the plan contract's own shape. `targetDate` is "YYYY-MM" or "YYYY-MM-DD". */
export const GOAL_KINDS = PLAN_GOAL_KINDS
export const goalSchema = planGoalSchema
export type Goal = z.infer<typeof goalSchema>

export const situationSchema = z
  .object({
    summary: text(1200).optional().describe('Two or three sentences of what the customer said.'),
    income: z
      .object({
        annualGross: eur
          .optional()
          .describe('Gross income a year, before tax; joint for two applicants.'),
        netMonthly: eur.optional().describe('Take-home pay a month.'),
      })
      .optional(),
    outgoings: z.object({ rentMonthly: eur.optional(), otherMonthly: eur.optional() }).optional(),
    monthlySaving: eur.optional().describe('What they can put aside each month.'),
    savings: z.array(heldSavingsSchema).max(20).default([]),
    debts: z.array(debtSchema).max(20).default([]),
    firstTimeBuyer: z.boolean().optional(),
  })
  .describe('The customer’s circumstances, sent with each call. Every figure is what they said.')
export type Situation = z.infer<typeof situationSchema>

// ---------------------------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Money found: the headline
// ---------------------------------------------------------------------------------------------

export const MONEY_FOUND_KINDS = ['idle_cash', 'debt_interest', 'mortgage_switch'] as const

export const moneyFoundSchema = z
  .object({
    annualEur: z
      .number()
      .describe(
        'The total a year, after DIRT: the sum of `parts`. Nothing in `notCounted` is in it.',
      ),
    headline: z.string().describe('One line for the host to lead with.'),
    parts: z.array(
      z.object({
        kind: z.enum(MONEY_FOUND_KINDS),
        label: z.string(),
        annualEur: z.number(),
        detail: z.string().describe('How the figure is worked out, with its inputs.'),
        source: z
          .string()
          .describe(
            'Where the rate behind it comes from: a provider or CCPC, or the customer’s own figures.',
          ),
        sourceUrl: z.string().nullable(),
        checkedAt: z.string().nullable().describe('When that rate was last checked.'),
      }),
    ),
    notCounted: z
      .array(
        z.object({
          label: z.string(),
          annualEur: z.number().nullable(),
          why: z.string(),
        }),
      )
      .describe(
        'Money that may be there but is not counted: a rate not confirmed beyond CCPC’s one figure, a current rate not given, bonuses, cashback.',
      ),
    basis: z.string(),
  })
  .describe(
    'Money a year the figures support finding: idle cash against the best accessible rate after DIRT, debt interest not paid, a mortgage switch. Each part sourced and dated.',
  )
export type MoneyFound = z.infer<typeof moneyFoundSchema>

export const reviewRequestSchema = z.object({
  situation: situationSchema,
  goals: z.array(goalSchema).max(8).default([]),
})
export type ReviewRequest = z.infer<typeof reviewRequestSchema>

export const FINDING_KINDS = [
  'idle_money',
  'no_emergency_fund',
  'debt_costs_more_than_savings_earn',
  'fixed_term_ending',
  'goal_short_at_current_pace',
  'unknown_rate',
  'help_to_buy',
] as const

export const findingSchema = z.object({
  kind: z.enum(FINDING_KINDS),
  headline: z.string(),
  detail: z.string(),
  figures: z
    .record(z.string(), z.number())
    .describe('The euro figures behind the finding, by name.'),
})
export type Finding = z.infer<typeof findingSchema>

export const reviewResponseSchema = z.object({
  presentation: z
    .array(z.string())
    .describe(
      'Present to the customer: the headline sentences, in order, as options with their figures. Lead with these; the fields below are the detail behind them.',
    ),
  moneyFound: moneyFoundSchema,
  findings: z.array(findingSchema),
  candidateGoals: z.array(
    z.object({ kind: z.enum(GOAL_KINDS), label: z.string(), why: z.string() }),
  ),
  assumptions: z.array(z.string()),
  dataCheckedAt: z.string().nullable(),
  attributions: z.array(z.string()),
  next: z
    .string()
    .describe(
      'For the host to relay: what can be done next, including a plan saved into the Saoi app.',
    ),
})
export type ReviewResponse = z.infer<typeof reviewResponseSchema>

// ---------------------------------------------------------------------------------------------
// Savings projection
// ---------------------------------------------------------------------------------------------

export const projectionRequestSchema = z
  .object({
    horizonMonths: horizon,
    lines: z
      .array(
        z.object({
          productId: z
            .string()
            .max(120)
            .describe('A product view id from search, e.g. `aib:savings.c396`.'),
          lumpSum: eur.optional(),
          monthly: eur.optional(),
          termMonths: z
            .number()
            .int()
            .positive()
            .max(120)
            .optional()
            .describe('For a term ladder: which term. Default the longest within the horizon.'),
        }),
      )
      .max(10)
      .optional()
      .describe(
        'The products and amounts to project. Omit to use the best available for the amounts below.',
      ),
    lumpSum: eur
      .optional()
      .describe('With no `lines`: the lump sum to place in the best available home.'),
    monthly: eur
      .optional()
      .describe(
        'With no `lines`: the monthly saving to place in the best available regular savers.',
      ),
    targetAmount: eur.optional().describe('A goal: the month it is reached is reported.'),
  })
  .describe('Amounts, a horizon, and either named products or "best available".')
export type ProjectionRequest = z.infer<typeof projectionRequestSchema>

export const projectionMonthSchema = z.object({
  month: z.number().int().positive(),
  date: z.string().describe('YYYY-MM'),
  paidIn: eur,
  balance: eur.describe('After DIRT.'),
  netInterest: eur.describe('Cumulative interest after DIRT.'),
})

export const projectionLineSchema = z.object({
  product: productViewSchema,
  lumpSum: eur,
  monthly: eur,
  termMonths: z.number().int().nullable(),
  figures: savingsFiguresSchema,
  months: z.array(projectionMonthSchema),
  notes: z.array(z.string()),
})
export type ProjectionLine = z.infer<typeof projectionLineSchema>

export const projectionResponseSchema = z.object({
  lines: z.array(projectionLineSchema),
  totals: z.object({
    knownThroughMonth: z
      .number()
      .int()
      .describe(
        'The totals run to here: the first month a line stops for want of a rate, or the horizon.',
      ),
    months: z.array(projectionMonthSchema),
    paidIn: eur,
    netInterest: eur,
    balance: eur,
  }),
  goal: z
    .object({
      targetAmount: eur,
      reachedMonth: z.number().int().nullable(),
      reachedOn: z
        .string()
        .nullable()
        .describe('YYYY-MM. Null: not within the months the totals cover.'),
    })
    .nullable(),
  basis: z.string(),
  assumptions: z.array(z.string()),
  dataCheckedAt: z.string().nullable(),
  attributions: z.array(z.string()),
})
export type ProjectionResponse = z.infer<typeof projectionResponseSchema>

// ---------------------------------------------------------------------------------------------
// Mortgage
// ---------------------------------------------------------------------------------------------

export const BUYER_KINDS = ['first_time_buyer', 'second_and_subsequent'] as const

export const affordabilityRequestSchema = z.object({
  mode: z.literal('affordability'),
  buyer: z.enum(BUYER_KINDS).describe('Decides the Central Bank limits that apply.'),
  annualGrossIncome: eur.describe('Gross income a year; joint for two applicants.'),
  deposit: eur.describe('Savings available for the deposit.'),
  propertyValue: eur.optional().describe('A price in mind. Without it, the most the limits allow.'),
  termYears: z.number().int().min(5).max(40).optional().describe('Default 30.'),
  ber: z
    .string()
    .regex(/^([A-G][1-3]?|Exempt)$/i)
    .optional(),
  limit: z.number().int().min(1).max(25).optional(),
})

export const switchRequestSchema = z.object({
  mode: z.literal('switch'),
  balance: eur.describe('What is owed now.'),
  currentRatePct: pct,
  remainingTermYears: z.number().int().min(1).max(40),
  propertyValue: eur
    .optional()
    .describe(
      'For the loan-to-value band. Without it, the LTV is not known and every band is shown.',
    ),
  currentFixedMonthsLeft: z
    .number()
    .int()
    .nonnegative()
    .max(480)
    .optional()
    .describe(
      'Months left on a current fixed rate, if any: breaking it early can cost a fee the data does not give.',
    ),
  switchingCostsEur: eur
    .optional()
    .describe('Legal, valuation and other switching costs, if known. Not estimated when absent.'),
  ber: z
    .string()
    .regex(/^([A-G][1-3]?|Exempt)$/i)
    .optional(),
  limit: z.number().int().min(1).max(25).optional(),
})

export const mortgageRequestSchema = z.discriminatedUnion('mode', [
  affordabilityRequestSchema,
  switchRequestSchema,
])
export type MortgageRequest = z.infer<typeof mortgageRequestSchema>
export type AffordabilityRequest = z.infer<typeof affordabilityRequestSchema>
export type SwitchRequest = z.infer<typeof switchRequestSchema>

export const mortgageOptionSchema = z.object({
  product: productViewSchema,
  figures: mortgageFiguresSchema,
  flags: z.array(z.string()),
})

export const affordabilityResponseSchema = z.object({
  mode: z.literal('affordability'),
  limits: z.object({
    loanToIncome: z.number(),
    maxLtvPct: z.number(),
    source: z.string(),
    allowance: z.string(),
  }),
  maxLoanByIncome: eur,
  maxPriceByDeposit: eur.describe('The most the deposit supports at the LTV limit.'),
  maxPrice: eur.describe(
    'The lower of the two limits: deposit plus the most that can be borrowed.',
  ),
  bindingLimit: z.enum(['income', 'deposit']),
  forProperty: z
    .object({
      propertyValue: eur,
      depositNeeded: eur,
      depositShortfall: eur,
      loanNeeded: eur,
      withinIncomeLimit: z.boolean(),
      ltvPct: z.number(),
    })
    .nullable(),
  loanAmount: eur,
  ltvPct: z.number(),
  options: z.array(mortgageOptionSchema),
  ranking: rankingSchema,
  assumptions: z.array(z.string()),
  dataCheckedAt: z.string().nullable(),
  attributions: z.array(z.string()),
})

export const switchOptionSchema = z.object({
  product: productViewSchema,
  figures: mortgageFiguresSchema,
  monthlySaving: z.number().describe('Positive: cheaper each month than now.'),
  savingOverFixedPeriod: z.number().nullable(),
  lifetimeSaving: z
    .number()
    .nullable()
    .describe(
      'Over the remaining term, assuming the follow-on rate after the fixed period and the current rate held, after cashback and any switching costs given. Null where no follow-on rate is stated.',
    ),
  breakEvenMonths: z
    .number()
    .int()
    .nullable()
    .describe(
      'Months for the monthly saving to repay switching costs less cashback. Null when it never does; 0 when cashback covers them.',
    ),
  flags: z.array(z.string()),
})

export const switchResponseSchema = z.object({
  mode: z.literal('switch'),
  current: z.object({ ratePct: pct, monthlyRepayment: eur, totalRemaining: eur }),
  ltvPct: z.number().nullable(),
  options: z.array(switchOptionSchema),
  ranking: rankingSchema,
  assumptions: z.array(z.string()),
  dataCheckedAt: z.string().nullable(),
  attributions: z.array(z.string()),
})

export const mortgageResponseSchema = z.discriminatedUnion('mode', [
  affordabilityResponseSchema,
  switchResponseSchema,
])
export type AffordabilityResponse = z.infer<typeof affordabilityResponseSchema>
export type SwitchResponse = z.infer<typeof switchResponseSchema>
export type MortgageResponse = z.infer<typeof mortgageResponseSchema>

// ---------------------------------------------------------------------------------------------
// First home: Help to Buy, the Central Bank limits, green rates
// ---------------------------------------------------------------------------------------------

export const PROPERTY_KINDS = ['new_build', 'self_build', 'second_hand'] as const

const ruleSourceSchema = z.object({
  fact: z.string(),
  url: z.string(),
  checkedOn: z.string().describe('YYYY-MM-DD the page was read.'),
})

export const HOME_ROUTE_IDS = [
  'second_hand',
  'new_build_help_to_buy',
  'first_home_scheme',
  'local_authority_home_loan',
  'affordable_purchase',
  'vacant_property_grant',
] as const
export const HOME_ROUTE_STATUSES = ['potential', 'needs_one_detail', 'not_applicable'] as const

const countySchema = z
  .enum(LOCAL_AREAS)
  .describe(
    'Where the home is: one of the 26 counties, or one of Dublin’s four local authorities (`dublin_city`, `dun_laoghaire_rathdown`, `fingal`, `south_dublin`). Sets the First Home Scheme and Local Authority Home Loan price limits. Absent: a price between the lowest and highest limits makes those routes ask for it.',
  )

const monthlyRentSchema = eur.describe(
  'Rent paid a month today. Optional: it changes no figure; it is set beside the monthly repayments of the options as a fact.',
)

export const homeRouteSchema = z
  .object({
    id: z
      .enum(HOME_ROUTE_IDS)
      .describe(
        '`second_hand`: a second-hand home with a mortgage. `new_build_help_to_buy`: a new build with the Help to Buy refund. `first_home_scheme`: shared equity on a new build. `local_authority_home_loan`: the council’s own mortgage. `affordable_purchase`: a council home sold below market value. `vacant_property_grant`: a grant for works on a vacant home.',
      ),
    name: z.string().describe('The route’s short name, as a heading.'),
    mechanism: z
      .string()
      .describe(
        'How it helps, in plain words: a tax refund towards the deposit, shared equity, an alternative mortgage, a below-market price with a council share, a grant for works after purchase.',
      ),
    status: z
      .enum(HOME_ROUTE_STATUSES)
      .describe(
        '`potential`: nothing given rules it out. `needs_one_detail`: one detail would settle it (`missing`). `not_applicable`: ruled out on the figures given (`reason`). Never a pick.',
      ),
    line: z
      .string()
      .describe(
        'The route in one line (about 90 characters at most), a fact with its figure, date or reason. Show it as is, in the order given; never call one route best, fastest or recommended.',
      ),
    reason: z
      .string()
      .nullable()
      .describe('Why it is not applicable, or what makes it potential, with the figure.'),
    missing: z
      .string()
      .nullable()
      .describe(
        'For `needs_one_detail`: the one detail that would settle it, as a plain question to ask. Null otherwise.',
      ),
    keysOn: z
      .string()
      .nullable()
      .describe(
        'YYYY-MM the deposit and buying costs are saved on this route, at this pace, before interest. Only second-hand and new build carry one; null where there is no arithmetic or it is not reached.',
      ),
    conditions: z.array(z.string()).describe('The scheme’s main conditions, as short facts.'),
    confirmed: z
      .boolean()
      .describe(
        'False when a figure on this route rests on a rule not read from a primary page (say so when showing it).',
      ),
    sources: z.array(ruleSourceSchema).describe('The pages the rules were read from, dated.'),
  })
  .describe('One route to a home, as a fact with its status. A comparison, not a recommendation.')
export type HomeRoute = z.infer<typeof homeRouteSchema>

const routesSchema = z
  .array(homeRouteSchema)
  .describe(
    'Every route to a home, the customer’s own kind of property first, then potential, needs one detail, not applicable. Show the first three lines right after the headline, then "More routes: N" for the rest; the customer chooses, and none is marked best.',
  )

export const firstHomeRequestSchema = z.object({
  annualGrossIncome: eur.describe('Gross income a year, before tax; joint for two applicants.'),
  deposit: eur.describe('Savings for the deposit, not counting Help to Buy.'),
  propertyPrice: eur
    .optional()
    .describe(
      'A price in mind (for a self-build, the approved valuation). Without it, the most the limits allow.',
    ),
  propertyKind: z
    .enum(PROPERTY_KINDS)
    .optional()
    .describe(
      '`new_build` bought from a builder, `self_build`, or `second_hand`. Help to Buy is for new builds and self-builds only. Absent: Help to Buy is shown as depending on it.',
    ),
  firstTimeBuyer: z.boolean().optional().describe('Default true.'),
  taxPaidLastFourYearsEur: eur
    .optional()
    .describe(
      'Income Tax and DIRT paid over the four tax years before applying (not USC or PRSI), across the buyers, less any Help to Buy already claimed. Help to Buy cannot be more than this. Absent: the amount is shown as "up to".',
    ),
  termYears: z.number().int().min(5).max(40).optional().describe('Default 30.'),
  ber: z
    .string()
    .regex(/^([A-G][1-3]?|Exempt)$/i)
    .optional()
    .describe(
      'The home’s BER, for green rates. Absent: green rates are shown with the BER they need.',
    ),
  limit: z.number().int().min(1).max(25).optional(),
  county: countySchema.optional(),
  jointApplication: z
    .boolean()
    .optional()
    .describe(
      'Buying with someone (two applicants). Sets the Local Authority Home Loan income ceiling: €80,000 single, €85,000 joint. Absent: an income between the two makes that route ask.',
    ),
  monthlyRentEur: monthlyRentSchema.optional(),
})
export type FirstHomeRequest = z.infer<typeof firstHomeRequestSchema>

export const firstHomeResponseSchema = z.object({
  presentation: z
    .array(z.string())
    .describe(
      'Present to the customer: the headline sentences, in order, as options with their figures. Lead with these; the fields below are the detail behind them.',
    ),
  helpToBuy: z.object({
    status: z
      .enum(['available', 'not_available', 'depends'])
      .describe('`depends`: on something not given (the kind of property, or tax paid).'),
    amountEur: eur
      .nullable()
      .describe('The refund, when every input it rests on was given. Null otherwise.'),
    upToEur: eur.describe(
      'The most it could be: 10% of the price, at most the cap, before the tax-paid limit.',
    ),
    limitedBy: z.enum(['share_of_price', 'cap', 'tax_paid']).nullable(),
    reasons: z
      .array(z.string())
      .describe('Why it is, or is not, or may be, available, with the figures.'),
    conditions: z.array(z.string()).describe('What has to hold for it, from Revenue.'),
    capEur: eur,
    maxPriceEur: eur,
    endsOn: z.string(),
    sources: z.array(ruleSourceSchema),
  }),
  lending: z.object({
    loanToIncome: z.number(),
    maxLtvPct: z.number(),
    allowancePct: z
      .number()
      .describe('The share of each lender’s lending allowed above the limits.'),
    allowance: z.string(),
    exemptions: z.string(),
    maxLoanByIncome: eur,
    maxPriceWithoutHelpToBuy: eur,
    maxPriceWithHelpToBuy: eur
      .nullable()
      .describe(
        'With Help to Buy counted towards the deposit (a new build or self-build, within its price cap). Null when it cannot apply.',
      ),
    forPrice: z
      .object({
        price: eur,
        depositNeeded: eur.describe('10% of the price.'),
        helpToBuy: eur.describe(
          'Counted towards the deposit: the amount, or "up to" when tax paid was not given.',
        ),
        depositShortfall: eur,
        loanNeeded: eur,
        ltvPct: z.number(),
        withinIncomeLimit: z.boolean(),
        aboveIncomeLimitBy: eur,
        helpToBuyMortgageShareMet: z
          .boolean()
          .nullable()
          .describe(
            'Whether the mortgage is at least 70% of the price, as Help to Buy needs. Null when Help to Buy does not apply.',
          ),
      })
      .nullable(),
    source: ruleSourceSchema,
  }),
  routes: routesSchema,
  rentVsRepayment: z
    .array(z.string())
    .describe(
      'With `monthlyRentEur`: "Rent €1,800 a month against a €1,620 repayment", one line per option shown (the first three), as facts. Empty without rent.',
    ),
  firstHomeScheme: z.object({
    confirmed: z
      .boolean()
      .describe(
        'True: read from firsthomescheme.ie; the `first_home_scheme` route carries its figures.',
      ),
    note: z.string(),
    source: ruleSourceSchema,
  }),
  greenRates: z.object({
    note: z.string(),
    cheapestGreen: z
      .object({
        productId: z.string(),
        name: z.string(),
        ratePct: pct,
        berNeeded: z.string().nullable(),
      })
      .nullable(),
    cheapestStandard: z
      .object({ productId: z.string(), name: z.string(), ratePct: pct })
      .nullable(),
  }),
  options: z.array(
    z.object({
      product: productViewSchema,
      figures: mortgageFiguresSchema,
      flags: z.array(z.string()),
    }),
  ),
  ranking: rankingSchema,
  assumptions: z.array(z.string()),
  dataCheckedAt: z.string().nullable(),
  attributions: z.array(z.string()),
  next: z.string(),
})
export type FirstHomeResponse = z.infer<typeof firstHomeResponseSchema>

// ---------------------------------------------------------------------------------------------
// Debt
// ---------------------------------------------------------------------------------------------

export const debtRequestSchema = z.object({
  debts: z.array(debtSchema).min(1).max(20),
  extraMonthly: eur
    .optional()
    .describe('An amount that could go to overpaying or to saving, to compare the two.'),
  lumpSum: eur
    .optional()
    .describe('Savings that could clear debt, to compare clearing against saving.'),
})
export type DebtRequest = z.infer<typeof debtRequestSchema>

export const debtCostSchema = z.object({
  debtId: z.string(),
  label: z.string(),
  ratePct: pct.nullable(),
  monthlyRepayment: eur.nullable(),
  monthsToClear: z.number().int().nullable(),
  interestRemaining: eur.nullable().describe('Interest still to pay at the current repayment.'),
  annualInterestNow: eur
    .nullable()
    .describe('Interest on the balance over the next year, roughly balance × rate.'),
  notes: z.array(z.string()),
})

export const refinanceOptionSchema = z.object({
  product: productViewSchema,
  figures: z.discriminatedUnion('kind', [loanFiguresSchema, cardFiguresSchema]),
  interestSaving: z
    .number()
    .nullable()
    .describe('Against the debt’s remaining interest. Positive is cheaper.'),
  flags: z.array(z.string()),
})

export const debtResponseSchema = z.object({
  costs: z.array(debtCostSchema),
  payoffOrder: z
    .array(z.object({ debtId: z.string(), why: z.string() }))
    .describe('Highest rate first: each euro repaid there saves the most interest.'),
  overpayVersusSave: z
    .object({
      debtId: z.string(),
      amount: eur,
      cadence: z.enum(['monthly', 'once']),
      horizonMonths: z.number().int(),
      interestSavedByOverpaying: eur,
      netInterestBySaving: eur,
      savingProduct: z.string().nullable(),
      difference: z
        .number()
        .describe('Overpaying less saving. Positive: overpaying is worth more over the horizon.'),
    })
    .array(),
  refinance: z.array(
    z.object({ debtId: z.string(), options: z.array(refinanceOptionSchema), note: z.string() }),
  ),
  assumptions: z.array(z.string()),
  dataCheckedAt: z.string().nullable(),
  attributions: z.array(z.string()),
})
export type DebtResponse = z.infer<typeof debtResponseSchema>

// ---------------------------------------------------------------------------------------------
// Build plan (the plan itself is `MarketPlan`, `contracts/market-plan.ts`)
// ---------------------------------------------------------------------------------------------

export const DEFAULT_MIN_LOCK_GAIN_EUR = 100
export const DEFAULT_MIN_LOCK_GAIN_PCT_PER_YEAR = 0.25

/** One named variation of the situation, worked out in the same call as the main plan. */
export const planAlternativeSchema = z
  .object({
    name: text(60).describe(
      'A short name the customer would recognise: "Keep the car loan", "€6,000 aside".',
    ),
    emergencyBufferEur: eur
      .optional()
      .describe('A different emergency buffer, in euro: only when the customer raised one.'),
    keepAccessible: z
      .boolean()
      .optional()
      .describe('Everything in instant access (true), or terms allowed (false).'),
    monthlySaving: eur.optional().describe('A different amount saved each month.'),
    targetDate: monthOrDay.optional().describe('A different date for the main goal.'),
    targetAmount: eur.optional().describe('A different target for the main goal.'),
    debtPlans: z
      .array(z.object({ debtId: z.string(), plan: z.enum(DEBT_PLAN_CHOICES) }))
      .max(20)
      .optional()
      .describe('A different choice for a debt: `keep`, `clear` or `compare`, by its id.'),
    homePrice: eur.optional().describe('A different home price, for Help to Buy.'),
  })
  .describe('What differs from the main request; everything not given is as in the main request.')
export type PlanAlternative = z.infer<typeof planAlternativeSchema>

/** What the home options can be sorted by. The customer picks; Saoi never picks one option. */
export const HOME_SORTS = ['five_year_cost', 'keys_date', 'monthly_repayment'] as const
export type HomeSort = (typeof HOME_SORTS)[number]

export const homePreferencesSchema = z
  .object({
    currentBank: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .describe('Who the customer banks with now, as they said it: "Bank of Ireland", "AIB".'),
    stayWithBank: z
      .boolean()
      .optional()
      .describe(
        'True: show only `currentBank`’s options, because the customer asked to stay with their bank. A filter they chose, and the result says so.',
      ),
    rateType: z
      .enum(['fixed', 'variable', 'either'])
      .optional()
      .describe('Fixed or variable rates only, as the customer chose. Default either.'),
    green: z
      .boolean()
      .optional()
      .describe(
        'True: the home is BER B3 or better, so green rates count. A new build is taken as BER A either way.',
      ),
    openToCurrentAccountSwitch: z
      .boolean()
      .optional()
      .describe(
        'False: leave out options that need a current account with the lender. Default true.',
      ),
    sortBy: z
      .enum(HOME_SORTS)
      .optional()
      .describe(
        'What the options are sorted by, as the customer chose: `five_year_cost` (default: interest and fees less cashback and bonuses over the first 5 years), `keys_date` (soonest first), `monthly_repayment` (lowest first).',
      ),
  })
  .describe(
    'For a home: the customer’s own filters and sort order. Each is a choice the customer made; the result states every filter applied.',
  )
export type HomePreferences = z.infer<typeof homePreferencesSchema>

export const buildPlanRequestSchema = z.object({
  situation: situationSchema,
  goals: z.array(goalSchema).min(1).max(8),
  emergencyBufferEur: eur
    .optional()
    .describe(
      'An emergency buffer to hold first, in the best instant-access account, in euro. Wins over `emergencyBufferMonths` and over an `emergency_fund` goal’s `targetAmount`. 0 holds none. Only when the customer raises a buffer: never add one unasked.',
    ),
  emergencyBufferMonths: z
    .number()
    .min(0)
    .max(12)
    .optional()
    .describe(
      'An emergency buffer sized as months of outgoings (`situation.outgoings`, rent plus other). Used when `emergencyBufferEur` is absent. Without either field the buffer comes from an `emergency_fund` goal (its `targetAmount`, else 3 months of outgoings); with neither, none is held.',
    ),
  emergencyFundMonths: z
    .number()
    .min(0)
    .max(12)
    .optional()
    .describe('Older name for `emergencyBufferMonths`; that field wins when both are sent.'),
  keepAccessible: z
    .boolean()
    .optional()
    .describe(
      'True: every euro stays in instant access, nothing in a fixed term or notice account (the customer wants to reach the money at any time). Default false: a term is used only where it beats instant access by the lock thresholds.',
    ),
  goalDateCertain: z
    .boolean()
    .optional()
    .describe(
      'False: the main goal may come sooner than its date (a house sale agreed early, a purchase brought forward), so nothing is locked. Default true.',
    ),
  minLockGainEur: eur
    .optional()
    .describe(
      `A fixed term or notice account is used only if the plan with it leaves at least this much more, after DIRT, at the goal date than the best plan in instant access. Default ${String(DEFAULT_MIN_LOCK_GAIN_EUR)}.`,
    ),
  minLockGainPctPerYear: pct
    .optional()
    .describe(
      `...and at least this much more a year, as a percentage of the lump sum placed. Default ${String(DEFAULT_MIN_LOCK_GAIN_PCT_PER_YEAR)}. Below either threshold the plan keeps the money in instant access and says why, with both figures.`,
    ),
  maxAccounts: z
    .number()
    .int()
    .min(1)
    .max(8)
    .optional()
    .describe('The most accounts the plan may open. Default 5.'),
  homePrice: eur
    .optional()
    .describe(
      'For a house deposit: the price in mind, for Help to Buy and the Central Bank limits.',
    ),
  propertyKind: z
    .enum(PROPERTY_KINDS)
    .optional()
    .describe(
      'For a house deposit: `new_build`, `self_build` or `second_hand`. Help to Buy is for the first two.',
    ),
  taxPaidLastFourYearsEur: eur
    .optional()
    .describe(
      'Income Tax and DIRT paid over the last four tax years (not USC or PRSI): the most Help to Buy can be.',
    ),
  homePreferences: homePreferencesSchema.optional(),
  county: countySchema.optional(),
  monthlyRentEur: monthlyRentSchema
    .optional()
    .describe(
      'For a house deposit: rent paid a month today. Changes no figure; kept with the plan as what they pay now. `situation.outgoings.rentMonthly` wins when both are sent.',
    ),
  alternatives: z
    .array(planAlternativeSchema)
    .max(3)
    .optional()
    .describe(
      'Up to three named variations to compare with the main plan in this same call (a debt kept or cleared, another monthly amount or date, or a buffer the customer raised). Each comes back with its own net figure.',
    ),
})
export type BuildPlanRequest = z.infer<typeof buildPlanRequestSchema>

export const planPositionSchema = z
  .object({
    at: z.string().describe('YYYY-MM: the end of the months the plan covers.'),
    total: z
      .number()
      .describe(
        'Everything held then, after DIRT (towards the goal plus the buffer), less what is still owed on the debts given.',
      ),
    towardsGoal: eur.describe('Savings towards the main goal then, after DIRT.'),
    buffer: eur.describe('The emergency buffer then, with its interest. 0 when none is held.'),
    owed: eur.describe('Still owed then on the debts given. 0 when none is owed or none given.'),
    owedIsCeiling: z
      .boolean()
      .describe(
        'True when a debt’s repayment was not given, so today’s balance is counted as owed: the most it can be, and `total` the least.',
      ),
    debtsGiven: z
      .boolean()
      .describe(
        'False when the call had no debts: `total` is then savings only, not a net position against debts.',
      ),
    line: z.string().describe('The position in one sentence, with its parts named.'),
  })
  .describe(
    'What the plan holds at its end, everything included and each part named: towards the goal, the buffer, less what is still owed.',
  )

const positionSchema = z.object({
  savingsAtHorizon: eur.describe('Savings at the end of the months the figures cover, after DIRT.'),
  debtAtHorizon: eur.describe('What is still owed on the debt then.'),
  netPosition: z
    .number()
    .describe('Everything held (towards the goal and the buffer) less what is still owed.'),
  goalReachedOn: z
    .string()
    .nullable()
    .describe('YYYY-MM the main goal is reached, if within the figures.'),
})

export const assumedRepaymentSchema = z
  .object({
    debtId: z.string(),
    label: z.string(),
    balance: eur,
    months: z.number().int().describe('Repaid evenly over this many months: the plan’s horizon.'),
    monthlyRepayment: eur.describe('The level repayment that assumes, at the debt’s rate.'),
    note: z.string().describe('The assumption in words, for the host to relay.'),
  })
  .describe(
    'A debt given with a balance and rate but no repayment or months left, modelled as repaid in equal monthly instalments over the plan’s horizon (Chris, 2026-11-09). A conservative modelling assumption: the actual repayment gives the exact figure.',
  )

export const planAlternativeResultSchema = z.object({
  name: z.string(),
  changes: z.array(z.string()).describe('What differs from the main plan, in words.'),
  position: planPositionSchema.describe(
    'The alternative’s own position, everything held less what is still owed.',
  ),
  differenceEur: z
    .number()
    .describe('Its total less the main plan’s total, at the same date where the date is the same.'),
  towardsGoalDifferenceEur: z
    .number()
    .describe(
      'What goes towards the main goal less the main plan’s, at the same date: the figure options are compared by. A buffer moves money out of the goal without changing the total held.',
    ),
  goalReachedOn: z.string().nullable(),
  moneyFoundAnnualEur: z.number(),
  line: z.string().describe('The comparison in one sentence, for the presentation and the card.'),
})

// ---------------------------------------------------------------------------------------------
// A home: every eligible option, filtered and sorted as the customer chose (Chris, 2026-11-10)
// ---------------------------------------------------------------------------------------------

export const homePathwaySchema = z.object({
  lender: z.string(),
  lenderName: z.string(),
  mortgage: z.object({
    productId: z.string(),
    name: z.string(),
    rateType: z.enum(['fixed', 'variable']).nullable(),
    ratePct: pct,
    fixedYears: z.number().int().nullable(),
    followOnRatePct: pct.nullable(),
    monthlyRepayment: eur,
  }),
  keysOn: z
    .string()
    .nullable()
    .describe('YYYY-MM the money for the deposit and buying costs is in place.'),
  interestEur: eur.describe('Interest over the period compared (the term, or the fixed period).'),
  cashbackEur: eur.describe(
    'Cashback counted: at drawdown, plus a later payment where it falls in the period.',
  ),
  bonusEur: eur.describe('Savings bonuses tied to this lender’s mortgage, net of DIRT.'),
  netCostEur: z
    .number()
    .describe(
      'Over the first 5 years: interest on a 30-year term plus the valuation fee, less cashback paid within 5 years and any savings bonus. What pathways are ranked by.',
    ),
  cashbackAfterEur: eur.describe(
    'Cashback paid after the 5 years if repayments are on time: listed, not ranked.',
  ),
  thirtyYearNetEur: z
    .number()
    .nullable()
    .describe(
      'The same over 30 years, if today’s follow-on rates held for 30 years. Secondary detail.',
    ),
  followOnAssumed: z
    .boolean()
    .describe(
      'A fix shorter than 5 years with no stated follow-on rate: the fixed rate carried on, unconfirmed.',
    ),
  vsCheapestEur: z
    .number()
    .describe('Net cost less the lowest net cost shown. 0 for the lowest; a fact, not a pick.'),
  drivers: z.string().describe('What makes this option differ, in a few words.'),
  conditions: z.array(z.string()),
  confirmed: z
    .boolean()
    .describe('True when every incentive counted was read from the lender’s own site.'),
  greenNote: z.string().nullable(),
  sources: z.array(z.string()),
  lowestRatePct: pct.describe('The lowest initial rate among this lender’s eligible products.'),
  considered: z
    .array(
      z.object({ productId: z.string(), name: z.string(), ratePct: pct, netCostEur: z.number() }),
    )
    .describe(
      'Runners-up: this lender’s other eligible products of the same rate type and fixed period, by net cost, this one first.',
    ),
  bundle: z
    .object({
      products: z.array(
        z.object({
          role: z.enum(['linked_saver', 'regular_saver', 'mortgage', 'cashback']),
          name: z.string(),
          detail: z.string(),
        }),
      ),
      currentAccount: z
        .string()
        .describe('Whether any product here needs a current account with the lender, as a fact.'),
    })
    .describe('What would be held with this lender for this option, and what stays where it is.'),
  line: z.string().describe('The option in one sentence, with its figures.'),
})

export const homePathwaysSchema = z
  .object({
    headline: z
      .string()
      .describe(
        '"At these figures, the deposit and buying costs are in place around <month>": a date, not an outcome.',
      ),
    assumptions: z.array(z.string()).describe('Each one stated and correctable.'),
    price: eur,
    priceFrom: z.enum(['given', 'savings']),
    bindingLimit: z.enum(['deposit', 'income', 'income_not_given', 'price_given']),
    loan: eur,
    ltvPct: z.number(),
    depositEur: eur,
    stampDutyEur: eur,
    legalAndSurveyEur: eur,
    helpToBuyEur: eur.describe(
      'Help to Buy at this price. With `helpToBuyConditional`, what it could be, not counted in the figures.',
    ),
    helpToBuyConditional: z
      .boolean()
      .describe(
        'True for a new build when tax paid was not given: the options and their keys months are without Help to Buy, as the home calculator’s headline is; the `new_build_help_to_buy` route carries the keys date if tax paid covers it. With tax paid given, Help to Buy is counted.',
      ),
    neededAtKeysEur: eur.describe(
      'Deposit plus stamp duty and fees, less Help to Buy when it is counted.',
    ),
    keysOn: z.string().nullable(),
    comparedOver: z
      .object({ basis: z.enum(['term', 'fixed_period', 'first_years']), years: z.number().int() })
      .describe('The period every pathway is costed over, the same for all.'),
    sortBy: z.enum(HOME_SORTS).describe('What `pathways` is sorted by, as the customer chose.'),
    sortedBy: z.string().describe('The sort order in words, for the presentation.'),
    filters: z
      .array(z.string())
      .describe(
        'Each filter applied, in words, naming the customer’s own choices ("Showing Bank of Ireland options, as you asked.").',
      ),
    pathways: z
      .array(homePathwaySchema)
      .describe(
        'Every eligible option that fits the filters (each lender’s cheapest product per rate type and fixed period), sorted by `sortBy`. No single pick.',
      ),
    leftOut: z.array(z.string()),
    warnings: z
      .array(z.string())
      .describe('The statutory mortgage warnings, shown with every mortgage result.'),
  })
  .describe(
    'For a home: every eligible option (the savings to the keys, Help to Buy, the mortgage, cashback, linked bonuses), filtered by the customer’s choices and sorted by the metric they pick. A comparison, not a recommendation.',
  )
export type HomePathways = z.infer<typeof homePathwaysSchema>

// ---------------------------------------------------------------------------------------------
// The home calculator: the front door for buying a home (Chris, 2026-11-10)
// ---------------------------------------------------------------------------------------------

export const homeCalculatorRequestSchema = z
  .object({
    depositSavedEur: eur.optional().describe('What is saved towards the deposit today.'),
    monthlySavingEur: eur.optional().describe('What can be put aside each month.'),
    annualGrossIncomeEur: eur
      .optional()
      .describe('Gross income a year, before tax: the first (or only) applicant.'),
    secondIncomeEur: eur
      .optional()
      .describe('A second applicant’s gross income a year, for a joint mortgage.'),
    buyingTogether: z
      .boolean()
      .optional()
      .describe(
        'True when the customer is buying with someone else: the second income (`secondIncomeEur`) is then core information for the gate. Absent or false: a second income is counted when given and never asked for in `gate`.',
      ),
    targetPriceEur: eur.optional().describe('The price in mind for the home.'),
    monthlyDebtRepaymentsEur: eur
      .optional()
      .describe('Existing loan and card repayments a month (not rent).'),
    targetDate: z
      .string()
      .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'expected YYYY-MM or YYYY-MM-DD')
      .optional()
      .describe('When the customer would like the keys: "YYYY-MM".'),
    firstTimeBuyer: z.boolean().optional().describe('Default true.'),
    propertyKind: z
      .enum(PROPERTY_KINDS)
      .optional()
      .describe('`new_build`, `self_build` or `second_hand`. Help to Buy is for the first two.'),
    taxPaidLastFourYearsEur: eur
      .optional()
      .describe(
        'Income Tax and DIRT paid over the last four tax years: the most Help to Buy can be. Absent on a new build: the headline leaves Help to Buy out and `helpToBuyEur` is what it could be (`helpToBuyConditional`).',
      ),
    county: countySchema.optional(),
    monthlyRentEur: monthlyRentSchema.optional(),
  })
  .extend(homePreferencesSchema.shape)
  .describe(
    'Whatever the customer has said about buying a home, however partial. Every field is optional; what is missing comes back as a plain question.',
  )
export type HomeCalculatorRequest = z.infer<typeof homeCalculatorRequestSchema>

export const HOME_INPUT_KEYS = [
  'depositSavedEur',
  'monthlySavingEur',
  'annualGrossIncomeEur',
  'targetPriceEur',
  'targetDate',
  'firstTimeBuyer',
  'propertyKind',
  'currentBank',
  'rateType',
  'monthlyRentEur',
] as const

/** The core information the home calculator's figures wait for (the gate, Chris 2026-11-12). */
export const HOME_GATE_KEYS = [
  'annualGrossIncomeEur',
  'secondIncomeEur',
  'targetPriceEur',
  'targetDate',
  'depositSavedEur',
  'monthlySavingEur',
] as const

export const homeGateSchema = z
  .object({
    ready: z
      .boolean()
      .describe(
        'True when the funds saved, the monthly saving, the income (both incomes when `buyingTogether`) and a price or a date are given. False: `presentation` holds only the `askNow` questions, with no figures.',
      ),
    missing: z
      .array(
        z.object({
          key: z.enum(HOME_GATE_KEYS),
          question: z.string().describe('The plain question for this input.'),
          moves: z
            .string()
            .describe('One factual sentence: what the answer changes in the figures.'),
          askNow: z.boolean().describe('True for at most two items: the questions for this reply.'),
        }),
      )
      .describe(
        'The core inputs not given yet, most useful first; empty when `ready`. With neither a price nor a date, `targetPriceEur` is asked and `targetDate` follows it, never `askNow`: either answer completes the pair. `secondIncomeEur` appears only when `buyingTogether`.',
      ),
  })
  .describe(
    'The core information the figures wait for. Kind of home, first-time status, bank, rate type and rent never hold the figures back: they are assumed (`assumed`) or asked as chips (`questions`).',
  )
export type HomeGate = z.infer<typeof homeGateSchema>

/**
 * The market beside the home calculator's figures (decision 2026-11-10, comparison not advice):
 * the savings and mortgages that fit the plan, as counts, ranges and the top rate, with the
 * ranking basis stated. No product or lender is picked.
 */
export const homeMarketSchema = z
  .object({
    savings: z
      .object({
        topRatePct: pct.describe(
          'The highest AER among the savings and deposit accounts that fit the plan, for the horizon (a fixed term’s rate for the longest term that ends by `by`).',
        ),
        topRateProvider: z.string().describe('The provider whose account pays `topRatePct`.'),
        accounts: z
          .number()
          .int()
          .nonnegative()
          .describe(
            'How many accounts fit: open to adult saving, reachable by `by` (no fixed term or notice running past it, nothing locked without a date), and taking the whole deposit saved or the whole monthly amount within their limits. One account listed in two categories counts once.',
          ),
        interestToTargetEur: eur.describe(
          'Interest after DIRT (none taken on a DIRT-free product) on the deposit saved plus the monthly saving until `by`, in the account paying `topRatePct`, from the engine’s month-by-month projection. Money that account cannot take, and months after its rate stops being known, are not counted (`basis` says so).',
        ),
        by: z
          .string()
          .describe(
            'YYYY-MM the interest runs to: the date given, else the month the money at the keys is saved, else 12 months on.',
          ),
        basis: z
          .string()
          .describe('How the top rate and the interest are worked out, in one sentence.'),
      })
      .nullable()
      .describe('Savings that fit the plan. Null: no account fits.'),
    mortgage: z
      .object({
        loanEur: eur.describe('The loan the figures need: the price less the deposit.'),
        options: z
          .number()
          .int()
          .nonnegative()
          .describe(
            'How many mortgage options fit: each lender’s options for this loan, loan-to-value, buyer and property, one per rate type and fixed period, fixed and variable, with no preference applied (the options build-plan lists without filters).',
          ),
        lowestRatePct: pct.describe('The lowest initial rate among those options.'),
        lowestMonthlyEur: eur.describe(
          'The lowest monthly repayment among those options, at each one’s initial rate.',
        ),
        highestMonthlyEur: eur.describe(
          'The highest monthly repayment among those options, at each one’s initial rate.',
        ),
        termYears: z.number().int().positive().describe('The mortgage term the repayments use.'),
        basis: z.string().describe('Which mortgages are counted and how, in one sentence.'),
      })
      .nullable()
      .describe('Mortgages that fit the figures. Null: no price is known yet, or none fits.'),
    lines: z
      .array(z.string())
      .describe('The two summaries in words, facts only; also appended to the result’s `lines`.'),
  })
  .describe(
    'The savings and mortgage market for these figures: a comparison, not a recommendation. Nothing is picked; the ranking basis is stated.',
  )
export type HomeMarket = z.infer<typeof homeMarketSchema>

export const homeCalculatorResponseSchema = z.object({
  inputs: homeCalculatorRequestSchema.describe(
    'The inputs as received, for the calculator card to start from.',
  ),
  rules: z
    .object({
      loanToIncome: z
        .number()
        .describe('Times gross income: 4 for first-time buyers, 3.5 for others.'),
      maxLtvPct: z.number(),
      stampDutyPct: z.number(),
      legalAndSurveyEur: eur.describe('Legal fees and a survey: an estimate.'),
      helpToBuy: z.object({ shareOfPrice: z.number(), capEur: eur, maxPriceEur: eur }),
      firstTimeBuyer: z.object({ loanToIncome: z.number(), maxLtvPct: z.number() }),
      otherBuyer: z.object({ loanToIncome: z.number(), maxLtvPct: z.number() }),
      sources: z.array(z.string()),
    })
    .describe('The rules the figures use, so the card can recompute them as inputs move.'),
  figures: z.object({
    incomeEur: eur.nullable().describe('Gross income counted: both applicants together.'),
    maxLoanEur: eur
      .nullable()
      .describe('What the Central Bank income limit allows. Null: no income given.'),
    priceEur: eur.nullable(),
    priceFrom: z
      .enum(['given', 'limits'])
      .nullable()
      .describe(
        '`given`, or `limits`: the most the deposit by the date and the income limit allow.',
      ),
    loanEur: eur.nullable(),
    ltvPct: z.number().nullable(),
    depositNeededEur: eur.nullable(),
    maxPriceEur: eur
      .nullable()
      .describe(
        'The most the Central Bank limits allow: the income limit (`maxLoanEur`) at the largest loan-to-value (`rules.maxLtvPct`), floored to the nearest €1,000. Lenders decide within it. Null: no income given.',
      ),
    termYears: z
      .number()
      .int()
      .positive()
      .describe('The mortgage term the figures and repayments use, in years.'),
    stampDutyEur: eur.nullable(),
    legalAndSurveyEur: eur,
    helpToBuyEur: eur.describe(
      'Help to Buy at this price. With `helpToBuyConditional`, what it could be (the cap or 10% of the price), not counted in the figures.',
    ),
    helpToBuyConditional: z
      .boolean()
      .describe(
        'True for a new build when tax paid was not given: the headline (`neededAtKeysEur`, `depositReachedOn`, `targetDateMet`) is without Help to Buy, and the `new_build_help_to_buy` route carries the keys date if tax paid covers it.',
      ),
    neededAtKeysEur: eur
      .nullable()
      .describe('Deposit plus stamp duty and fees, less Help to Buy when it is counted.'),
    depositReachedOn: z
      .string()
      .nullable()
      .describe('YYYY-MM the money needed at the keys is saved, at this pace, before interest.'),
    targetDateMet: z.boolean().nullable(),
    monthlyCommitmentsNote: z.string().nullable(),
  }),
  lines: z.array(z.string()).describe('The figures in words, as options and facts.'),
  market: homeMarketSchema
    .nullable()
    .describe(
      'The savings and mortgages that fit these figures, from Saoi’s market data. Null when the market data is not available.',
    ),
  assumed: z
    .array(z.string())
    .describe(
      'What the figures take as given when it was not said (first-time buyer), each correctable.',
    ),
  routes: routesSchema,
  questions: z
    .array(
      z.object({
        key: z.enum(HOME_INPUT_KEYS),
        question: z.string(),
        optional: z
          .boolean()
          .describe(
            'True when the answer changes no figure (rent): ask it at most once, as a chip.',
          ),
      }),
    )
    .describe(
      'The inputs not given yet, as plain questions, most useful first: the card’s chips. The core ones are also in `gate`.',
    ),
  gate: homeGateSchema,
  next: z
    .string()
    .describe(
      'How to see the options: the card’s "Show my options" button, or saoi_build_plan with these inputs.',
    ),
  presentation: z
    .array(z.string())
    .describe(
      'Present to the customer. When `gate.ready`, in this order: the headline figures, then three route lines and "More routes: N", then what is assumed and still to know. When not, only the `askNow` questions, each with what it moves, and the statement: no figures. No route is picked.',
    ),
  warnings: z.array(z.string()).describe('The statutory mortgage warnings.'),
  statement: z.string().describe('Saoi is not regulated and does not give advice.'),
})
export type HomeCalculatorResponse = z.infer<typeof homeCalculatorResponseSchema>

export const QUESTION_KEYS = [
  'income',
  'property_kind',
  'home_price',
  'debt_repayment',
  'current_account_bank',
  'goal',
] as const

export const planQuestionSchema = z.object({
  key: z.enum(QUESTION_KEYS),
  question: z.string().describe('For the host to ask, in its own words.'),
  why: z.string().describe('What the answer changes, with the figures from the runs.'),
  spread: z
    .object({
      keysMonths: z.number(),
      costEur: z.number().describe('Reported, not scored: a bigger home costs more.'),
      costPer100kEur: z.number().describe('The spread in cost per €100,000 borrowed: scored.'),
      priceEur: z.number(),
      totalEur: z.number(),
    })
    .describe('How far the plan moved across a few plausible answers.'),
  scoreEur: z.number().describe('The spread in euro, the order questions are asked in.'),
})
export type PlanQuestion = z.infer<typeof planQuestionSchema>

export const planCompletenessSchema = z.object({
  answered: z.array(z.string()),
  assumed: z.array(z.string()),
  line: z.string().describe('"Plan based on 4 of 6 answers".'),
})

export const saveCallSchema = z.object({
  ready: z
    .boolean()
    .describe(
      'True once the inputs that move the plan most are answered (for a home: income and new or second-hand).',
    ),
  label: z.string(),
  note: z.string(),
  appToday: z.array(z.string()).describe('What the Saoi app does with the plan today.'),
  coming: z.array(z.string()).describe('Not built yet: never offered as available.'),
})

export const planRunnerUpSchema = z.object({
  without: z.string().describe('The product left out to find this split: "AIB Online Saver".'),
  split: z.string().describe('The split, in words.'),
  towardsGoalEur: eur.describe('Towards the main goal at the same date, after DIRT.'),
  differenceEur: z
    .number()
    .describe('Towards the goal less the worked combination’s, at the same date (negative: less).'),
  goalReachedOn: z.string().nullable(),
  line: z.string().describe('The runner-up in one sentence, with what differs.'),
})

export const buildPlanResponseSchema = z.object({
  runnersUp: z
    .array(planRunnerUpSchema)
    .describe(
      'Other splits, each worked out without one product of the first, with how much more or less each holds towards the goal: shown beside it, so there is no single answer.',
    ),
  nextQuestion: planQuestionSchema
    .nullable()
    .describe(
      'The one question whose answer would change the plan most. Ask this one, and only this one, in the reply.',
    ),
  laterQuestions: z.array(planQuestionSchema).describe('The rest, in order, for later replies.'),
  completeness: planCompletenessSchema,
  saveCall: saveCallSchema,
  home: homePathwaysSchema
    .nullable()
    .describe('Pathways to a home, when the main goal is a house deposit. Null otherwise.'),
  routes: routesSchema.describe(
    'For a house deposit: every route to a home, as the home calculator gives them for the same figures, the customer’s own kind of property first. The presentation shows three lines right after the headline, then "More routes: N"; none is marked best. Empty for other goals.',
  ),
  alternatives: z
    .array(planAlternativeResultSchema)
    .describe(
      'The variations asked for in `alternatives`, each worked out in this call. Empty when none were asked for.',
    ),
  assumedRepayments: z
    .array(assumedRepaymentSchema)
    .describe('Debts whose repayment was assumed. Empty when every repayment was given.'),
  presentation: z
    .array(z.string())
    .describe(
      'Present to the customer: the headline sentences, in order, as options with their figures. Lead with these; the fields below are the detail behind them.',
    ),
  questions: z
    .array(z.string())
    .max(3)
    .describe(
      'The two or three questions that would sharpen the plan (the same as saoi_money_check asks), for the host to ask in its own words.',
    ),
  position: planPositionSchema,
  saveLink: z
    .object({
      url: z.string().describe('Opens the plan in the Saoi app, once.'),
      expiresAt: z.string(),
    })
    .nullable()
    .describe(
      'The plan held for 24 hours behind a single-use link: deleted then if not opened, kept with the Saoi app conversation it opens into once opened. Null when the draft could not be held (the daily or per-address limit); saoi_save_plan can then save it.',
    ),
  helpToBuy: z
    .object({
      status: z.enum(['available', 'not_available', 'depends']),
      amountEur: eur.nullable(),
      upToEur: eur,
      note: z.string(),
      sourceUrl: z.string(),
      checkedOn: z.string(),
    })
    .nullable()
    .describe(
      'For a house deposit goal and a first-time buyer: Help to Buy, as far as the inputs allow. Null otherwise.',
    ),
  moneyFound: moneyFoundSchema,
  plan: marketPlanSchema.describe(
    'The plan, in the shape `POST /api/plans` takes. Send it back unchanged to save it behind a one-time link into the Saoi app.',
  ),
  horizonMonths: z
    .number()
    .int()
    .describe('Months to the main goal’s date, or 12 when there is no date.'),
  knownThroughMonth: z
    .number()
    .int()
    .describe(
      'The figures run to here; less than the horizon where a rate after that is not known.',
    ),
  goalReachedOn: z
    .string()
    .nullable()
    .describe('YYYY-MM the main goal is reached, if within the figures.'),
  reasoning: z
    .array(z.string())
    .describe('Why the plan has the shape it has, step by step, with the figures.'),
  debtScenarios: z
    .array(
      z.object({
        debtId: z.string(),
        amount: eur.describe('What clearing or overpaying would take from the lump sum.'),
        kept: positionSchema,
        cleared: positionSchema,
        chosen: z
          .enum(['kept', 'cleared'])
          .describe(
            'The one in this plan: the customer’s choice when the debt’s `plan` is `keep` or `clear`, otherwise the larger net position.',
          ),
      }),
    )
    .describe('Each debt that costs more than savings earn, with both outcomes worked out.'),
  affordability: z
    .object({
      deposit: eur,
      maxPrice: eur,
      maxLoanByIncome: eur,
      bindingLimit: z.enum(['income', 'deposit']),
      note: z.string(),
      helpToBuy: z
        .object({
          upToEur: eur.describe('Help to Buy at the price shown, before the tax-paid limit.'),
          maxPriceWithHelpToBuy: eur
            .nullable()
            .describe(
              'The highest price the limits allow with Help to Buy towards the deposit, for a new build or self-build.',
            ),
          note: z.string(),
          sourceUrl: z.string(),
          checkedOn: z.string(),
        })
        .nullable()
        .describe(
          'For a first-time buyer: what Help to Buy would add for a new build. Null otherwise.',
        ),
    })
    .nullable()
    .describe(
      'For a house deposit with an income given: what the projected deposit supports under the Central Bank limits, and for a first-time buyer, with Help to Buy.',
    ),
  unplaced: z.object({ lumpSum: eur, monthly: eur }),
  liquidity: z
    .object({
      decision: z
        .enum(['locked', 'instant_access', 'not_compared'])
        .describe(
          '`locked`: a fixed term or notice account beat instant access by the thresholds. `instant_access`: it did not, or the customer asked to keep the money accessible, or the goal date is not certain. `not_compared`: no lump sum, or no term ends by the goal date.',
        ),
      why: z.string().describe('The reason, with both figures where they were worked out.'),
      lockedNetPosition: z
        .number()
        .nullable()
        .describe('Savings less debt at the horizon with terms allowed, after DIRT.'),
      instantNetPosition: z
        .number()
        .nullable()
        .describe('The same with every euro in instant access.'),
      gainEur: z.number().nullable().describe('Locked less instant.'),
      gainPctPerYear: z
        .number()
        .nullable()
        .describe('The gain a year as a percentage of the lump sum placed.'),
      thresholdEur: eur,
      thresholdPctPerYear: pct,
    })
    .describe('Whether money is locked away, and why: the liquidity rule, stated.'),
  whatIf: z
    .object({
      extraMonthly: z
        .object({
          extra: eur.describe('The extra a month tried: €100.'),
          addsAtHorizon: z.number().describe('What it adds to savings at the horizon, after DIRT.'),
          goalReachedOn: z.string().nullable(),
        })
        .nullable(),
      goalReachedAtCurrentPace: z
        .string()
        .nullable()
        .describe(
          'YYYY-MM the main goal’s target is reached at this plan’s pace, looking up to ten years ahead in instant access where the horizon is not enough. Null without a target, or when it is not reached within the figures.',
        ),
      lines: z
        .array(z.string())
        .describe(
          'The what-ifs in words, with their figures, for the host to relay. Each can be worked out in full as an `alternative`.',
        ),
    })
    .describe('How the result moves when one input changes.'),
  next: z
    .string()
    .describe(
      'For the host to relay: what can be done next with this plan, including saving it into the Saoi app.',
    ),
})
export type BuildPlanResponse = z.infer<typeof buildPlanResponseSchema>

// ---------------------------------------------------------------------------------------------
// Money check: the one-call entry
// ---------------------------------------------------------------------------------------------

export const moneyCheckRequestSchema = buildPlanRequestSchema
  .omit({ situation: true, goals: true })
  .extend({
    situation: situationSchema
      .default({ savings: [], debts: [] })
      .describe(
        'Whatever the customer has said about their money so far, however partial: savings and where they are, what they can save a month, loans and cards, a mortgage, income, outgoings. Leave out what was not said; never guess.',
      ),
    goals: z
      .array(goalSchema)
      .max(8)
      .default([])
      .describe('What the money is for, if they said: a house, a car. Empty is fine.'),
  })
export type MoneyCheckRequest = z.infer<typeof moneyCheckRequestSchema>

export const moneyCheckResponseSchema = z.object({
  presentation: z
    .array(z.string())
    .describe(
      'Present to the customer: the headline sentences in order, ending with the questions to ask and, when there is a plan, the link to save it.',
    ),
  questions: z
    .array(z.string())
    .max(3)
    .describe(
      'The two or three questions that would unlock or sharpen the plan, for the host to ask in its own words.',
    ),
  review: reviewResponseSchema,
  plan: buildPlanResponseSchema
    .nullable()
    .describe(
      'A plan, when there was enough to build one (money to place, or a debt to weigh). Null otherwise.',
    ),
  planGoalAssumed: z
    .string()
    .nullable()
    .describe(
      'When no goal was given, the goal the plan was built for, stated. Null when the customer gave one.',
    ),
})
export type MoneyCheckResponse = z.infer<typeof moneyCheckResponseSchema>

// ---------------------------------------------------------------------------------------------
// About: how Saoi ranks, how Saoi earns
// ---------------------------------------------------------------------------------------------

export const ABOUT_TOPICS = ['ranking', 'earnings'] as const

export const aboutResponseSchema = z.object({
  topic: z.enum(ABOUT_TOPICS),
  title: z.string(),
  text: z.string().describe('Markdown.'),
  updatedOn: z.string().describe('When the text was last revised: YYYY-MM-DD.'),
})
export type AboutTopic = (typeof ABOUT_TOPICS)[number]
export type About = z.infer<typeof aboutResponseSchema>
