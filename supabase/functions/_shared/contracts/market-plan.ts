import { z } from 'zod'

/**
 * A plan made in the customer's own AI, through the Saoi MCP tools, and carried into the app.
 *
 * `saoi_build_plan` returns one of these; `saoi_save_plan` sends it back unchanged to
 * `POST /api/plans`, which stores it behind a one-time claim link (`?plan=<token>` on
 * app.saoi.ie). Claiming it opens a conversation with the plan already there.
 *
 * What it holds, in the order a person reads it:
 *
 * - `situation`: what the customer told their AI, summarised, with the figures they gave
 *   (income, outgoings, what they can save, savings held, debts). Every figure is what they
 *   said; nothing here is worked out.
 * - `goals`: what they are trying to do, each with an id the products point back at.
 * - `combination`: the worked combination of products under the ranking rule the customer chose
 *   (not a pick for them), each with its provider, the market data source it was read from
 *   (`bank` or `ccpc`), Saoi's product id, the amounts placed and saved monthly, what the engine
 *   projects, and every field the data does not give (`unknowns`). Plans stored before
 *   2026-11-10 call it `recommendation`; `upgradeStoredPlan` renames it on the way in.
 * - `debts`: the order to pay debts down in, and why.
 * - `ranking` and `assumptions`: the objective the products were ranked by, stated, and what
 *   the figures assume (DIRT at 33%, rates held, the horizon). Information, not advice.
 * - `createdAt` and `dataCheckedAt`: when the plan was built, and when the oldest market figure
 *   in it was last checked.
 *
 * **Versioned.** `version` is a literal; a change that would break a reader adds version 2
 * beside 1 and the reader handles both. Additive fields need no new version: unknown keys are
 * stripped on the way in rather than refused, so the engine producing plans can run ahead of
 * this file without its plans bouncing.
 *
 * **Bounded.** Every string and list has a ceiling, and the route caps the whole body, because
 * `POST /api/plans` is public.
 *
 * Self-contained on purpose: it imports nothing but zod, so the apps can copy it alone. The
 * source and category lists repeat `_shared/market/schema.ts`, and a test holds them equal.
 */

export const MARKET_PLAN_VERSION = 1 as const

/** Repeats `MARKET_SOURCES` (`_shared/market/schema.ts`); `contracts.test.ts` holds them equal. */
export const PLAN_PRODUCT_SOURCES = ['bank', 'ccpc'] as const
/** Repeats `MARKET_CATEGORIES`; held equal by the same test. */
export const PLAN_PRODUCT_CATEGORIES = [
  'savings',
  'deposit',
  'mortgage',
  'loan',
  'credit_card',
  'current_account',
] as const

const eur = z.number().nonnegative().max(100_000_000)
const pct = z.number().nonnegative().max(80)
const text = (max: number) => z.string().trim().min(1).max(max)
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'expected a short lower-case id')
const isoDateTime = z.iso.datetime({ offset: true })
/** A month or a day: "2028-06" or "2028-06-30". */
const monthOrDay = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'expected YYYY-MM or YYYY-MM-DD')

export const PLAN_DEBT_KINDS = [
  'credit_card',
  'personal_loan',
  'car_finance',
  'overdraft',
  'mortgage',
  'other',
] as const

/** A debt as the customer described it. `id` is what the payoff order refers to. */
export const planDebtSchema = z.object({
  id,
  label: text(80),
  kind: z.enum(PLAN_DEBT_KINDS),
  balance: eur,
  /** APR, or the mortgage rate. */
  ratePct: pct.optional(),
  monthlyRepayment: eur.optional(),
  monthsRemaining: z.number().int().positive().max(480).optional(),
})

export const planSituationSchema = z.object({
  /** Two or three sentences, in plain words, of what the customer told their AI. */
  summary: text(1200),
  income: z
    .object({
      /** Gross, before tax. */
      annualGross: eur.optional(),
      /** Take-home pay. */
      netMonthly: eur.optional(),
    })
    .optional(),
  outgoings: z
    .object({
      rentMonthly: eur.optional(),
      otherMonthly: eur.optional(),
    })
    .optional(),
  /** What they said they can put aside each month. */
  monthlySaving: eur.optional(),
  /** Money they hold now, where it is and what it earns, as they said. */
  savings: z
    .array(
      z.object({
        label: text(80),
        balance: eur,
        provider: text(60).optional(),
        aerPct: pct.optional(),
      }),
    )
    .max(20)
    .default([]),
  debts: z.array(planDebtSchema).max(20).default([]),
})

export const PLAN_GOAL_KINDS = [
  'house_deposit',
  'emergency_fund',
  'pay_off_debt',
  'save_for_purchase',
  'grow_savings',
  'switch_mortgage',
  'other',
] as const

export const planGoalSchema = z.object({
  id,
  kind: z.enum(PLAN_GOAL_KINDS),
  /** In the customer's terms: "House deposit", "Three months' rainy-day money". */
  label: text(120),
  targetAmount: eur.optional(),
  targetDate: monthOrDay.optional(),
  /** 1 is what matters most to them. */
  priority: z.number().int().min(1).max(20).optional(),
})

/** What a product is doing in the plan. */
export const PLAN_PRODUCT_ROLES = [
  'regular_saver',
  'lump_sum',
  'emergency_fund',
  'mortgage',
  'refinance',
  'current_account',
  'other',
] as const

export const planProjectionSchema = z.object({
  /** How far the projection runs. It stops where the data stops (an unknown reversion rate). */
  horizonMonths: z.number().int().positive().max(480),
  /** The balance at the end of the horizon. */
  balance: eur.optional(),
  /** Interest earned over the horizon, after DIRT. */
  netInterest: eur.optional(),
  /** For borrowing: everything repaid over the term, interest and fees. */
  totalCost: eur.optional(),
  monthlyRepayment: eur.optional(),
  /** When the goal it serves is reached at this pace, if it is. */
  goalReachedOn: monthOrDay.optional(),
})

export const planProductSchema = z.object({
  role: z.enum(PLAN_PRODUCT_ROLES),
  /** The goals this product serves. Each must be one of `goals[].id`. */
  goalIds: z.array(id).max(8).default([]),
  /** The provider id market data uses: `boi`, `aib`, `ptsb`. */
  provider: z.string().regex(/^[a-z0-9_]{2,40}$/),
  providerName: text(80),
  /** Where the figures were read: the provider's own site, or the CCPC comparison tables. */
  source: z.enum(PLAN_PRODUCT_SOURCES),
  category: z.enum(PLAN_PRODUCT_CATEGORIES),
  /** Saoi's product id in `market_products`. */
  productId: text(80),
  productName: text(120),
  /** A sum placed once. */
  amount: eur.optional(),
  /** Paid in (or repaid) each month. */
  monthlyAmount: eur.optional(),
  /** The headline rate the figures use: AER for saving, APR for borrowing. */
  ratePct: pct.optional(),
  projected: planProjectionSchema.optional(),
  /** Why this product, in one or two sentences tied to the ranking basis. */
  why: text(400).optional(),
  /** Fields the data does not give, named, so their absence is never read as zero. */
  unknowns: z.array(text(120)).max(20).default([]),
  /** Eligibility the data cannot confirm: "Needs a current account with the bank". */
  checks: z.array(text(200)).max(10).default([]),
  /**
   * For a deposit: the scheme that protects it and its limit, with the page that says so.
   * `scheme` null: not recorded, so the customer confirms it with the provider.
   */
  depositGuarantee: z
    .object({
      scheme: text(160).nullable(),
      country: text(60).nullable(),
      coverEur: eur.nullable(),
      note: text(300).nullable().optional(),
      sourceUrl: z
        .url({ protocol: /^https$/ })
        .max(500)
        .nullable()
        .optional(),
      checkedOn: monthOrDay.nullable().optional(),
    })
    .optional(),
  /** When this product's figures were last checked against the source. */
  checkedAt: isoDateTime,
  /** What has to travel with the figures under the source's re-use terms (CCPC). */
  attribution: text(200).optional(),
  /** The provider's own page for the product. */
  url: z
    .url({ protocol: /^https$/ })
    .max(500)
    .optional(),
})

export const PLAN_DEBT_ACTIONS = ['pay_off_first', 'overpay', 'keep_paying', 'refinance'] as const

export const planDebtStepSchema = z.object({
  /** One of `situation.debts[].id`. */
  debtId: id,
  action: z.enum(PLAN_DEBT_ACTIONS),
  why: text(300),
  /** What the debt costs from now if left as it is, and if the step is taken. */
  costIfKept: eur.optional(),
  costWithStep: eur.optional(),
})

/** Repeats `HOME_ROUTE_IDS` (`contracts/market-tools.ts`); `contracts.test.ts` holds them equal. */
export const PLAN_ROUTE_IDS = [
  'second_hand',
  'new_build_help_to_buy',
  'first_home_scheme',
  'local_authority_home_loan',
  'affordable_purchase',
  'vacant_property_grant',
] as const
/** Repeats `HOME_ROUTE_STATUSES`; held equal by the same test. */
export const PLAN_ROUTE_STATUSES = ['potential', 'needs_one_detail', 'not_applicable'] as const

/**
 * One route to a home, as the calculator states it (`homeRouteSchema` in `market-tools.ts`,
 * decision `2026-11-10-saoi-routes-card`), bounded for a public body. A fact with its status,
 * never a pick.
 */
export const planRouteSchema = z.object({
  id: z.enum(PLAN_ROUTE_IDS),
  name: text(120),
  mechanism: text(400),
  status: z.enum(PLAN_ROUTE_STATUSES),
  /** About 90 characters, shown as is. */
  line: text(300),
  reason: text(400).nullable(),
  missing: text(300).nullable(),
  keysOn: monthOrDay.nullable(),
  conditions: z.array(text(400)).max(10).default([]),
  confirmed: z.boolean(),
  sources: z
    .array(
      z.object({
        fact: text(400),
        url: z.url({ protocol: /^https$/ }).max(500),
        checkedOn: monthOrDay,
      }),
    )
    .max(10)
    .default([]),
})
export type PlanRoute = z.infer<typeof planRouteSchema>

export const RANKING_OBJECTIVES = [
  'highest_net_return',
  'lowest_total_cost',
  'fastest_to_goal',
  'easiest_access',
] as const

export const marketPlanSchema = z
  .object({
    version: z.literal(MARKET_PLAN_VERSION),
    /** What the plan is for, as a heading: "House deposit by summer 2028". */
    title: text(120),
    situation: planSituationSchema,
    goals: z.array(planGoalSchema).min(1).max(8),
    /** The worked combination for the stated ranking rule: arithmetic, not a pick. */
    combination: z.object({
      products: z.array(planProductSchema).max(12),
      /** What the whole combination asks of them. */
      totals: z
        .object({
          monthly: eur.optional(),
          lumpSum: eur.optional(),
          netInterest: eur.optional(),
        })
        .optional(),
    }),
    /** Payoff order, first step first. Empty when there are no debts. */
    debts: z.array(planDebtStepSchema).max(20).default([]),
    ranking: z.object({
      objective: z.enum(RANKING_OBJECTIVES),
      /** The basis, stated: "Ranked by interest after DIRT on €800 a month over 24 months". */
      basis: text(400),
    }),
    assumptions: z.array(text(300)).max(20).default([]),
    /**
     * Where the plan ends, everything included: towards the goal, the emergency buffer, less
     * what is still owed. `line` says it in one sentence with the parts named. Optional: plans
     * saved before 2026-11-09 do not have it.
     */
    position: z
      .object({
        at: monthOrDay,
        total: z.number().min(-100_000_000).max(100_000_000),
        towardsGoal: eur,
        buffer: eur,
        owed: eur,
        line: text(400),
      })
      .optional(),
    /**
     * For a home: the comparison the customer saw, every option in the order they chose, so the
     * app can show it again (2026-11-10). Optional: plans without a home goal have none.
     */
    comparison: z
      .object({
        kind: z.literal('home'),
        headline: text(300),
        priceEur: eur,
        /**
         * The cash needed at the keys (deposit, stamp duty, fees, less Help to Buy counted) and
         * the month it is held at the plan's pace, as the comparison worked them out
         * (2026-11-11, for progress against the plan). Plans saved before then have neither.
         */
        neededAtKeysEur: eur.optional(),
        keysOn: monthOrDay.nullable().optional(),
        sortBy: z.enum(['five_year_cost', 'keys_date', 'monthly_repayment']),
        sortedBy: text(200),
        filters: z.array(text(200)).max(6).default([]),
        options: z
          .array(
            z.object({
              lender: text(80),
              kind: text(40),
              productName: text(120),
              ratePct: pct,
              monthlyEur: eur,
              fiveYearCostEur: z.number().min(-100_000_000).max(100_000_000),
              keysOn: monthOrDay.nullable(),
              confirmed: z.boolean(),
              /** The lender's conditions as the comparison stated them (loan size, bonus terms). */
              conditions: z.array(text(400)).max(4).default([]),
            }),
          )
          .max(80),
        /**
         * Every route to a home, in the order the calculator gave them (2026-11-10). Plans
         * stored before then have none; `upgradeStoredPlan` fills an empty list.
         */
        routes: z.array(planRouteSchema).max(PLAN_ROUTE_IDS.length).default([]),
      })
      .optional(),
    createdAt: isoDateTime,
    /** When the oldest market figure in the plan was last checked. */
    dataCheckedAt: isoDateTime,
  })
  .superRefine((plan, ctx) => {
    // A product or a payoff step pointing at something the plan does not hold is a broken plan.
    const goals = new Set(plan.goals.map((goal) => goal.id))
    plan.combination.products.forEach((product, index) => {
      for (const goalId of product.goalIds) {
        if (!goals.has(goalId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['combination', 'products', index, 'goalIds'],
            message: `no goal with id ${goalId}`,
          })
        }
      }
    })
    const debts = new Set(plan.situation.debts.map((debt) => debt.id))
    plan.debts.forEach((step, index) => {
      if (!debts.has(step.debtId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['debts', index, 'debtId'],
          message: `no debt with id ${step.debtId}`,
        })
      }
    })
  })

export type MarketPlan = z.infer<typeof marketPlanSchema>

/**
 * A stored or posted plan from before 2026-11-10 carries `recommendation` where the contract now
 * says `combination` (the decision `2026-11-10-saoi-compare-with-customer-filters`), and a home
 * comparison without `routes`. Renames the one and fills the other with an empty list before
 * parsing; anything else passes through untouched.
 */
export function upgradeStoredPlan(document: unknown): unknown {
  if (!isRecord(document)) return document
  let record = document
  if (record['combination'] === undefined && record['recommendation'] !== undefined) {
    const { recommendation, ...rest } = record
    record = { ...rest, combination: recommendation }
  }
  const comparison = record['comparison']
  if (isRecord(comparison) && comparison['routes'] === undefined) {
    record = { ...record, comparison: { ...comparison, routes: [] } }
  }
  return record
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export type PlanProduct = z.infer<typeof planProductSchema>
export type PlanGoal = z.infer<typeof planGoalSchema>
export type PlanDebt = z.infer<typeof planDebtSchema>

/** The whole body is capped by the route too; this is the plan's own ceiling. */
export const SAVE_PLAN_MAX_BYTES = 64 * 1024

/** `POST /api/plans`. */
export const savePlanBodySchema = z.object({
  plan: marketPlanSchema,
  /** Which assistant saved it, for the console's sources: `claude`, `chatgpt`. */
  client: z
    .string()
    .regex(/^[a-z0-9_-]{1,40}$/)
    .optional(),
})

export const savePlanResponseSchema = z.object({
  /** Open once. `https://app.saoi.ie/?plan=<token>`. */
  claimUrl: z.url(),
  expiresAt: isoDateTime,
})

export type SavePlanBody = z.infer<typeof savePlanBodySchema>
export type SavePlanResponse = z.infer<typeof savePlanResponseSchema>
