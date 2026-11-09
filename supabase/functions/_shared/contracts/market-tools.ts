import { z } from 'zod'
import { MARKET_CATEGORIES, MARKET_SOURCES, MORTGAGE_CUSTOMER_TYPES } from '../market/schema.ts'
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
 * `market_products`; nothing is stored. The descriptions here become the OpenAPI document, and
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
      .describe('The scheme that protects the deposit, e.g. "German Deposit Guarantee Scheme".'),
    country: z.string().nullable(),
    coverEur: eur.nullable().describe('Cover per person per bank, where known.'),
    basis: z
      .enum(['stated_by_source', 'recorded_by_saoi', 'unknown'])
      .describe(
        '`stated_by_source`: the source names the scheme. `recorded_by_saoi`: Saoi’s own record of where the provider is licensed. `unknown`: neither.',
      ),
  })
  .describe('Which deposit guarantee scheme covers the money.')

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
    includePlatforms: z
      .boolean()
      .optional()
      .describe(
        'Include products opened through a deposit platform (Raisin). Default true; they are flagged.',
      ),
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
export const debtSchema = planDebtSchema
export type Debt = z.infer<typeof debtSchema>

export const heldSavingsSchema = z.object({
  label: text(80).describe('In the customer’s words: "current account", "credit union".'),
  balance: eur,
  provider: text(60).optional(),
  aerPct: pct
    .optional()
    .describe('What it earns now. Absent: not known (it is not treated as zero).'),
  access: z.enum([...ACCESS_KINDS, 'current_account']).optional(),
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
  .describe(
    'The customer’s circumstances. Sent with each call and never stored. Every figure is what they said.',
  )
export type Situation = z.infer<typeof situationSchema>

// ---------------------------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------------------------

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
  findings: z.array(findingSchema),
  candidateGoals: z.array(
    z.object({ kind: z.enum(GOAL_KINDS), label: z.string(), why: z.string() }),
  ),
  assumptions: z.array(z.string()),
  dataCheckedAt: z.string().nullable(),
  attributions: z.array(z.string()),
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
    includePlatforms: z.boolean().optional(),
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

export const buildPlanRequestSchema = z.object({
  situation: situationSchema,
  goals: z.array(goalSchema).min(1).max(8),
  emergencyFundMonths: z
    .number()
    .min(0)
    .max(12)
    .optional()
    .describe(
      'With an `emergency_fund` goal and no target: months of outgoings to hold. Default 3.',
    ),
  includePlatforms: z
    .boolean()
    .optional()
    .describe('Allow products opened through Raisin. Default true.'),
  maxAccounts: z
    .number()
    .int()
    .min(1)
    .max(8)
    .optional()
    .describe('The most accounts the plan may open. Default 5.'),
})
export type BuildPlanRequest = z.infer<typeof buildPlanRequestSchema>

const positionSchema = z.object({
  savingsAtHorizon: eur.describe('Savings at the end of the months the figures cover, after DIRT.'),
  debtAtHorizon: eur.describe('What is still owed on the debt then.'),
  netPosition: z.number().describe('Savings less debt.'),
  goalReachedOn: z
    .string()
    .nullable()
    .describe('YYYY-MM the main goal is reached, if within the figures.'),
})

export const buildPlanResponseSchema = z.object({
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
        chosen: z.enum(['kept', 'cleared']).describe('The one with the larger net position.'),
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
    })
    .nullable()
    .describe(
      'For a house deposit with an income given: what the projected deposit supports under the Central Bank limits.',
    ),
  unplaced: z.object({ lumpSum: eur, monthly: eur }),
})
export type BuildPlanResponse = z.infer<typeof buildPlanResponseSchema>
