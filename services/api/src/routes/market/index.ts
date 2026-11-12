import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import type { MarketPlan } from '@shared/contracts/market-plan.ts'
import { bodyLimit } from 'hono/body-limit'
import {
  ABOUT_TOPICS,
  aboutResponseSchema,
  buildPlanRequestSchema,
  buildPlanResponseSchema,
  debtRequestSchema,
  debtResponseSchema,
  firstHomeRequestSchema,
  firstHomeResponseSchema,
  homeCalculatorRequestSchema,
  homeCalculatorResponseSchema,
  moneyCheckRequestSchema,
  moneyCheckResponseSchema,
  mortgageRequestSchema,
  mortgageResponseSchema,
  productDetailSchema,
  projectionRequestSchema,
  projectionResponseSchema,
  reviewRequestSchema,
  reviewResponseSchema,
  searchRequestSchema,
  searchResponseSchema,
} from '@shared/contracts/market-tools.ts'
import { ABOUT } from '@shared/domain/market/about.ts'
import { debts } from '@shared/domain/market/debt.ts'
import { firstHome } from '@shared/domain/market/first-home.ts'
import { homeCalculator } from '@shared/domain/market/home-calculator.ts'
import { moneyCheck } from '@shared/domain/market/money-check.ts'
import { affordability, switchMortgage } from '@shared/domain/market/mortgage.ts'
import { buildPlan } from '@shared/domain/market/plan.ts'
import { productDetail } from '@shared/domain/market/product.ts'
import { project } from '@shared/domain/market/projection.ts'
import { review } from '@shared/domain/market/review.ts'
import { homeCalculatorRun } from '@shared/domain/market/run-bands.ts'
import { MarketInputError, search } from '@shared/domain/market/search.ts'
import type { Market } from '@shared/domain/market/types.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError, errorBody } from '../../errors.ts'
import { clientAddress, rateLimit } from '../../middleware/rateLimit.ts'
import type { CalculatorRunStore } from '../../store/calculator-runs.ts'
import type { MarketStore } from '../../store/market.ts'
import type { PlanStore } from '../../store/plans.ts'
import {
  DEFAULT_DAILY_MAX,
  hashPlanToken,
  linkBase,
  newPlanToken,
  planLink,
  PLAN_LINK_TTL_MS,
} from '../plans/index.ts'
import { errorResponse } from '../common.ts'

/**
 * The public comparison API: `/api/market/*` (products) and `/api/calc/*` (calculations on the
 * customer's own figures), the engine behind the Saoi MCP tools. No sign-in: the MCP server
 * calls these for whoever is talking to their own AI. The customer's circumstances travel in
 * each request; what a route keeps (a plan draft, a banded calculator run) its description says.
 *
 * Every figure comes from `_shared/domain/market` on the market data in `market_products`. The
 * route descriptions are what the MCP tool descriptions are generated from.
 */

export type MarketRouteOptions = {
  readonly store: MarketStore
  /** Requests per address per window. */
  readonly burst?: { readonly max: number; readonly windowMs: number }
  /** For tests: the clock the date of the figures is read from. */
  readonly now?: () => number
  /**
   * Where `POST /api/calc/home` records one anonymous, banded row per run (`calculator_runs`),
   * after responding. Without it, nothing is recorded.
   */
  readonly runs?: CalculatorRunStore
  /**
   * Where `build-plan` holds each plan as a 24-hour draft behind a single-use link. Without it,
   * plans carry no link (`saveLink: null`).
   */
  readonly drafts?: {
    readonly store: PlanStore
    readonly appBaseUrl: string
    /** Plans held a day across everybody (drafts and saves together). */
    readonly dailyMax?: number
    /** Drafts per address per window; past it, the plan comes back without a link. */
    readonly burst?: { readonly max: number; readonly windowMs: number }
  }
}

const DEFAULT_DRAFT_BURST = { max: 30, windowMs: 60_000 }
const SWEEP_EVERY_MS = 10 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** Bodies are small: a situation, some goals. Anything bigger is not a person's finances. */
export const MARKET_MAX_BODY_BYTES = 32 * 1024
const DEFAULT_BURST = { max: 120, windowMs: 60_000 }

/** Today in Dublin, `YYYY-MM-DD`: month 1 of every projection is the month after it. */
export const dublinDate = (at: number): string =>
  new Date(at).toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' })

const publicErrors = {
  400: errorResponse('The request is not valid. `details` says where.'),
  413: errorResponse('The body is larger than 32 KiB.'),
  429: errorResponse('Too many requests from this address. See `Retry-After`.'),
}

const INFORMATION =
  'Information, not advice: results are ranked by a stated objective, for the inputs given, and never pick a product for the customer. ' +
  'Saoi is not regulated by the Central Bank of Ireland. ' +
  'Unauthenticated. '

/** What each route keeps of what was sent. Each operation states its own. */
const NOTHING_STORED = 'Nothing sent is stored.'
const PLAN_HELD =
  'Stored: the plan, behind its single-use link, for 24 hours; deleted then if the link has not been opened, and once opened kept with the Saoi app conversation it opened into. Nothing else sent is stored.'
const RUN_RECORDED =
  'Stored: one anonymous row per run with the day (no time), income band, months-to-the-keys band, whether the date is met, county and rent band when given, kind of home and first-time buyer. No figures, no identifiers, no IP address, no free text. Nothing else sent is stored.'

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
})
const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  200: { description, content: { 'application/json': { schema } } },
})

// ---- Routes ---------------------------------------------------------------------------------

const searchRoute = createRoute({
  method: 'post',
  path: '/api/market/search',
  tags: ['market'],
  summary: 'Search and rank Irish financial products for the customer’s own figures',
  description:
    'Ranks the products in one category (savings, deposit, mortgage, loan, credit_card, ' +
    'current_account) with the figures for the amounts given: interest after DIRT for savings ' +
    'and deposits, monthly repayment and total cost for mortgages and loans. Default objective: ' +
    'highest net return for savings and deposits, lowest total cost for debt; `objective` ' +
    'changes it and the result states the basis. Top 5 by default (`limit` up to 25). Every ' +
    'product carries its source (`bank` or `ccpc`), when it was checked and last changed, the ' +
    'CCPC attribution where it applies, the fields the source does not give (never treated as ' +
    'zero), its deposit guarantee, and eligibility to check. Providers that operate in Ireland only. ' +
    INFORMATION +
    NOTHING_STORED,
  security: [],
  request: { body: jsonBody(searchRequestSchema.openapi('MarketSearch')) },
  responses: {
    ...ok('Ranked products.', searchResponseSchema.openapi('MarketSearchResult')),
    ...publicErrors,
  },
})

const productRoute = createRoute({
  method: 'get',
  path: '/api/market/products/{id}',
  tags: ['market'],
  summary: 'One product in full: figures, rate history, unknowns, source',
  description:
    'Takes a product id from search (`aib:deposit.ladder_personal_fixed_term_deposit`) or a ' +
    'source row id (`aib:deposit.c3743`). Returns the comparable view, every version Saoi has ' +
    'recorded (newest first), and the source’s own words for each row, verbatim.',
  security: [],
  request: {
    params: z.object({
      id: z
        .string()
        .regex(/^[a-z0-9_]{2,40}:[a-z0-9_.]{3,120}$/)
        .openapi({ param: { name: 'id', in: 'path' }, example: 'boi:savings.supersaver' }),
    }),
  },
  responses: {
    ...ok('The product.', productDetailSchema.openapi('MarketProductDetail')),
    404: errorResponse('No product with this id.'),
    ...publicErrors,
  },
})

const aboutRoute = createRoute({
  method: 'get',
  path: '/api/market/about/{topic}',
  tags: ['market'],
  summary: 'How Saoi ranks, and how Saoi earns',
  description:
    '`ranking`: how results are ordered and every figure worked out. `earnings`: referral fees ' +
    '(disclosed, never used in ranking), information not advice, and the CCPC attribution. ' +
    'Markdown, static.',
  security: [],
  request: {
    params: z.object({
      topic: z.enum(ABOUT_TOPICS).openapi({ param: { name: 'topic', in: 'path' } }),
    }),
  },
  responses: {
    ...ok('The text.', aboutResponseSchema.openapi('MarketAbout')),
    ...publicErrors,
  },
})

const reviewRoute = createRoute({
  method: 'post',
  path: '/api/calc/review-situation',
  tags: ['calc'],
  summary: 'Deterministic findings on a customer’s situation, with euro figures',
  description:
    'Given income, outgoings, savings (with what they earn) and debts (with rates and terms), ' +
    'returns findings with the figures behind each: money earning little against the best ' +
    'instant-access rate, no emergency fund (three months of outgoings), a debt costing more ' +
    'than savings earn, a fixed term ending within three months, a goal short at the current ' +
    'pace. Also the goals the findings suggest. ' +
    INFORMATION +
    NOTHING_STORED,
  security: [],
  request: { body: jsonBody(reviewRequestSchema.openapi('ReviewSituation')) },
  responses: {
    ...ok('Findings.', reviewResponseSchema.openapi('ReviewSituationResult')),
    ...publicErrors,
  },
})

const projectionRoute = createRoute({
  method: 'post',
  path: '/api/calc/savings-projection',
  tags: ['calc'],
  summary: 'Savings month by month, net of DIRT, within caps and tiers',
  description:
    'Projects named products and amounts (`lines`, product ids from search) or, with no lines, ' +
    'the best available split of `lumpSum` and `monthly` across the market. Month by month, ' +
    'after DIRT, honouring monthly caps and balance tiers. A line stops at the end of a known ' +
    'period (a fixed term’s maturity, an introductory rate with no stated reversion) and says ' +
    'so; the totals run only as far as every line is known. With `targetAmount`, reports the ' +
    'month the goal is reached. ' +
    INFORMATION +
    NOTHING_STORED,
  security: [],
  request: { body: jsonBody(projectionRequestSchema.openapi('SavingsProjection')) },
  responses: {
    ...ok('The projection.', projectionResponseSchema.openapi('SavingsProjectionResult')),
    ...publicErrors,
  },
})

const mortgageRoute = createRoute({
  method: 'post',
  path: '/api/calc/mortgage',
  tags: ['calc'],
  summary: 'Mortgage affordability under the Central Bank limits, or a switch against the market',
  description:
    '`mode: affordability`: the Central Bank of Ireland limits (loan to income 4 times for ' +
    'first-time buyers, 3.5 for second and subsequent buyers; loan to value 90%), the most the ' +
    'income and deposit allow, the deposit a price needs, and the matching mortgages ranked by ' +
    'total cost. `mode: switch`: the current mortgage against switcher rates: monthly and ' +
    'lifetime saving, cashback, fees as stated, and break-even on any switching costs given. ' +
    INFORMATION +
    NOTHING_STORED,
  security: [],
  request: { body: jsonBody(mortgageRequestSchema.openapi('MortgageCalculation')) },
  responses: {
    ...ok('The calculation.', mortgageResponseSchema.openapi('MortgageCalculationResult')),
    ...publicErrors,
  },
})

const debtRoute = createRoute({
  method: 'post',
  path: '/api/calc/debt',
  tags: ['calc'],
  summary: 'What debts cost, the payoff order, overpay versus save, refinance rates',
  description:
    'For each debt: months to clear and interest still to pay at the current repayment. The ' +
    'payoff order (highest rate first). With `extraMonthly` or `lumpSum`: interest saved by ' +
    'overpaying the top debt against interest earned saving the same money. The market’s ' +
    'loans and cards for the same balance, with the saving. Nothing is arranged. ' +
    INFORMATION +
    NOTHING_STORED,
  security: [],
  request: { body: jsonBody(debtRequestSchema.openapi('DebtCalculation')) },
  responses: {
    ...ok('The calculation.', debtResponseSchema.openapi('DebtCalculationResult')),
    ...publicErrors,
  },
})

const firstHomeRoute = createRoute({
  method: 'post',
  path: '/api/calc/first-home',
  tags: ['calc'],
  summary:
    'A first home: Help to Buy, the Central Bank limits with it, green rates, the mortgages that fit',
  description:
    'For a first-time buyer: Help to Buy (Revenue: new builds and self-builds up to €500,000; ' +
    'the lesser of 10% of the price, €35,000 and Income Tax and DIRT paid over the last four ' +
    'tax years; a mortgage of at least 70%; bought by 31 December 2029), what is available, not ' +
    'available, or depends on something not given; the Central Bank limits (loan to income 4 ' +
    'times, loan to value 90%, the 15% allowances, the exemptions) with Help to Buy counted ' +
    'towards the deposit; for a price, the deposit needed, the shortfall and whether the loan is ' +
    'within the income limit; green rates from the market data (no rule sets them; lenders do); ' +
    'every route to a home (`routes`: the First Home Scheme, the Local Authority Home Loan, ' +
    'affordable purchase, the vacant property grant beside second-hand and new build), three ' +
    'shown after the limits, never a pick; rent set beside the repayments when given ' +
    '(`rentVsRepayment`); and the mortgages that fit, ranked by total cost. Every rule carries ' +
    'its source page and the day it was read. ' +
    INFORMATION +
    NOTHING_STORED,
  security: [],
  request: { body: jsonBody(firstHomeRequestSchema.openapi('FirstHome')) },
  responses: {
    ...ok('The first-home figures.', firstHomeResponseSchema.openapi('FirstHomeResult')),
    ...publicErrors,
  },
})

const homeCalculatorRoute = createRoute({
  method: 'post',
  path: '/api/calc/home',
  tags: ['calc'],
  summary: 'The home calculator: what the limits allow, the deposit, and when it is saved',
  description:
    'Buying a home in Ireland. Takes whatever of the customer’s figures and circumstances have ' +
    'been given, however partial, and returns what the Central Bank limits allow, the deposit ' +
    'and cash needed at the keys, the month that is saved at this pace, and the inputs still ' +
    'missing as plain questions. On a new build with tax paid not given, the headline leaves ' +
    'Help to Buy out (`helpToBuyConditional`). `routes` lists every route to a home, each ' +
    'potential, needing one detail, or not applicable, with dated sources; none is marked best. ' +
    '`rules` lets a calculator card recompute the figures as sliders move. No products: the ' +
    'mortgage options come from build-plan with a house_deposit goal and `homePreferences`. ' +
    INFORMATION +
    RUN_RECORDED,
  security: [],
  request: { body: jsonBody(homeCalculatorRequestSchema.openapi('HomeCalculator')) },
  responses: {
    ...ok('The figures.', homeCalculatorResponseSchema.openapi('HomeCalculatorResult')),
    ...publicErrors,
  },
})

const moneyCheckRoute = createRoute({
  method: 'post',
  path: '/api/calc/money-check',
  tags: ['calc'],
  summary:
    'A money check on an Irish customer’s own situation: findings, a plan or the questions for one, and a link to the plan',
  description:
    'Takes the customer’s situation as far as it has been given, however partial: money in a ' +
    'current account or savings, a goal such as a house deposit, loans and card balances, a ' +
    'mortgage, Help to Buy. Returns in one result what Saoi finds (money found a year, with its ' +
    'sources), a plan across the Irish market when there is money to place, up to three ' +
    'questions that would sharpen it, the presentation lines, and a single-use link to the plan ' +
    'in the Saoi app. Up to three `alternatives` are worked out in the same call. For the same ' +
    'input it returns the same plan and questions as saoi_build_plan. ' +
    INFORMATION +
    PLAN_HELD,
  security: [],
  request: { body: jsonBody(moneyCheckRequestSchema.openapi('MoneyCheck')) },
  responses: {
    ...ok('The money check.', moneyCheckResponseSchema.openapi('MoneyCheckResult')),
    ...publicErrors,
  },
})

const buildPlanRoute = createRoute({
  method: 'post',
  path: '/api/calc/build-plan',
  tags: ['calc'],
  summary:
    'Compare the options for the customer’s goals: a worked combination under the rule they chose, with runners-up, and for a home every eligible option, filtered and sorted',
  description:
    'Takes a situation and chosen goals. Holds any emergency buffer apart in instant access, ' +
    'works out each debt as `debts[].plan` says, and splits the rest across the market: ' +
    'regular savers to their monthly caps, a lump sum to a fixed term or notice account ending ' +
    'by the goal’s date only where it beats instant access by `minLockGainEur` and ' +
    '`minLockGainPctPerYear`, otherwise instant access, at most €100,000 per provider. Money ' +
    'in a current account counts as earning what CCPC states current accounts pay. Projects ' +
    'to the date the main goal is reached, with what-ifs (an extra €100 a month, each debt ' +
    'cleared or kept, the month a target is reached). For a house deposit: what it supports ' +
    'under the Central Bank limits and every eligible mortgage option, filtered by ' +
    '`homePreferences` and sorted by its `sortBy`, with the filters stated. `runnersUp` are the ' +
    'next splits under the same rule; no single option is picked for the customer. ' +
    '`position` is everything held at the end less what is still owed. Up to three ' +
    '`alternatives` are worked out in the same call. For the same input it returns the same ' +
    'plan and questions as saoi_money_check. Returns `plan` (a `MarketPlan`, the body ' +
    '`POST /api/plans` takes), the reasoning, every figure, `next`, and a single-use link to ' +
    'the plan in the Saoi app. ' +
    INFORMATION +
    PLAN_HELD,
  security: [],
  request: { body: jsonBody(buildPlanRequestSchema.openapi('BuildPlan')) },
  responses: {
    ...ok('The plan.', buildPlanResponseSchema.openapi('BuildPlanResult')),
    ...publicErrors,
  },
})

// ---- Handlers -------------------------------------------------------------------------------

/** A domain refusal (an unknown product, an objective that does not apply) is the caller's. */
async function calculate<T>(work: () => T): Promise<T> {
  try {
    return await Promise.resolve(work())
  } catch (error) {
    if (error instanceof MarketInputError) throw new ApiError('bad_request', error.message)
    throw error
  }
}

export const MARKET_ROUTE_PREFIXES = ['/api/market/', '/api/calc/'] as const

export function marketRoutes(options: MarketRouteOptions) {
  const now = options.now ?? Date.now
  const routes = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const details = result.error.issues.map(
          (issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`,
        )
        const error = new ApiError('bad_request', 'The request is not valid.', { details })
        return c.json(errorBody(error, c.get('requestId')), 400)
      }
      return undefined
    },
  })
  const market = (): Promise<Market> => options.store.load()

  for (const prefix of MARKET_ROUTE_PREFIXES) {
    routes.use(
      `${prefix}*`,
      bodyLimit({
        maxSize: MARKET_MAX_BODY_BYTES,
        onError: (c) =>
          c.json(
            errorBody(
              new ApiError('bad_request', 'The request is too large.'),
              c.get('requestId') as string | undefined,
            ),
            413,
          ),
      }),
    )
  }
  const limiter = rateLimit({ ...(options.burst ?? DEFAULT_BURST), key: clientAddress, now })
  for (const prefix of MARKET_ROUTE_PREFIXES) routes.use(`${prefix}*`, limiter)

  routes.openapi(searchRoute, async (c) => {
    const body = c.req.valid('json')
    const loaded = await market()
    return c.json(await calculate(() => search(loaded, body, dublinDate(now()))), 200)
  })

  routes.openapi(productRoute, async (c) => {
    const { id } = c.req.valid('param')
    const detail = productDetail(await market(), id)
    if (detail === null) throw new ApiError('not_found', `No product ${id}.`)
    return c.json(detail, 200)
  })

  routes.openapi(aboutRoute, (c) => c.json(ABOUT[c.req.valid('param').topic], 200))

  routes.openapi(reviewRoute, async (c) => {
    const body = c.req.valid('json')
    const loaded = await market()
    return c.json(await calculate(() => review(loaded, body, dublinDate(now()))), 200)
  })

  routes.openapi(projectionRoute, async (c) => {
    const body = c.req.valid('json')
    const loaded = await market()
    return c.json(await calculate(() => project(loaded, body, dublinDate(now()))), 200)
  })

  routes.openapi(mortgageRoute, async (c) => {
    const body = c.req.valid('json')
    const loaded = await market()
    return c.json(
      await calculate(() =>
        body.mode === 'affordability' ? affordability(loaded, body) : switchMortgage(loaded, body),
      ),
      200,
    )
  })

  routes.openapi(debtRoute, async (c) => {
    const body = c.req.valid('json')
    const loaded = await market()
    return c.json(await calculate(() => debts(loaded, body, dublinDate(now()))), 200)
  })

  routes.openapi(homeCalculatorRoute, async (c) => {
    const body = c.req.valid('json')
    const asOf = dublinDate(now())
    // The market rides on the same response (the card cannot call a second tool). Without it the
    // calculator still answers, with `market: null`; nothing about the customer is logged.
    const loaded = await market().catch((error: unknown) => {
      c.get('log').warn('home calculator answered without market data', {
        requestId: c.get('requestId'),
        error: error instanceof Error ? error.message : 'unknown',
      })
      return null
    })
    const result = homeCalculator(body, asOf, loaded)
    const runs = options.runs
    if (runs !== undefined) {
      // Fire and forget, after the response is built: a failed record never fails the request.
      setTimeout(() => {
        void Promise.resolve()
          .then(() => runs.record(homeCalculatorRun(body, result, asOf)))
          .catch((error: unknown) => {
            c.get('log').warn('calculator run not recorded', {
              requestId: c.get('requestId'),
              error: error instanceof Error ? error.message : 'unknown',
            })
          })
      }, 0)
    }
    return c.json(result, 200)
  })

  routes.openapi(firstHomeRoute, async (c) => {
    const body = c.req.valid('json')
    const loaded = await market()
    return c.json(await calculate(() => firstHome(loaded, body, dublinDate(now()))), 200)
  })

  // Drafts: a fixed window per address, held in this process like the other limits.
  const draftWindows = new Map<string, { resetAt: number; count: number }>()
  const draftBurst = options.drafts?.burst ?? DEFAULT_DRAFT_BURST
  let lastSweep = 0
  const draftAllowed = (key: string): boolean => {
    const at = now()
    if (draftWindows.size > 10_000) {
      for (const [k, entry] of draftWindows) if (entry.resetAt <= at) draftWindows.delete(k)
    }
    let entry = draftWindows.get(key)
    if (entry === undefined || entry.resetAt <= at) {
      entry = { resetAt: at + draftBurst.windowMs, count: 0 }
      draftWindows.set(key, entry)
    }
    entry.count += 1
    return entry.count <= draftBurst.max
  }

  /**
   * Holds a plan as a 24-hour draft behind a single-use link. A refusal or a failure never costs
   * the customer the plan: it comes back without a link, and the presentation says so.
   */
  const holdDraft = async (
    c: Context<AppEnv>,
    plan: MarketPlan,
    at: number,
  ): Promise<{ url: string; expiresAt: string } | null> => {
    const drafts = options.drafts
    if (drafts === undefined || !draftAllowed(clientAddress(c))) return null
    try {
      if (at - lastSweep > SWEEP_EVERY_MS) {
        lastSweep = at
        await drafts.store.sweep()
      }
      const held = await drafts.store.savedSince(new Date(at - DAY_MS).toISOString())
      if (held >= (drafts.dailyMax ?? DEFAULT_DAILY_MAX)) return null
      const token = newPlanToken()
      const expiresAt = new Date(at + PLAN_LINK_TTL_MS).toISOString()
      await drafts.store.save({
        plan,
        client: 'draft',
        tokenHash: hashPlanToken(token),
        expiresAt,
      })
      return { url: planLink(linkBase(drafts.appBaseUrl), token), expiresAt }
    } catch (error) {
      c.get('log').warn('plan draft not held', {
        requestId: c.get('requestId'),
        error: error instanceof Error ? error.message : 'unknown',
      })
      return null
    }
  }

  /** The link sentence goes just before the closing line ("the customer decides"). */
  const withLink = (
    presentation: readonly string[],
    saveLink: { url: string } | null,
  ): string[] => {
    const closing = presentation.at(-1)
    return [
      ...presentation.slice(0, -1),
      saveLink === null
        ? 'A link to open this comparison in the Saoi app could not be held just now; saoi_save_plan can save it.'
        : `Save this comparison to the Saoi app: ${saveLink.url} (held for 24 hours, then deleted unless opened).`,
      ...(closing === undefined ? [] : [closing]),
    ]
  }

  routes.openapi(buildPlanRoute, async (c) => {
    const body = c.req.valid('json')
    const loaded = await market()
    const at = now()
    const result = await calculate(() =>
      buildPlan(loaded, body, dublinDate(at), new Date(at).toISOString()),
    )
    const saveLink = await holdDraft(c, result.plan, at)
    return c.json(
      {
        ...result,
        presentation: withLink(result.presentation, saveLink),
        saveLink,
      },
      200,
    )
  })

  routes.openapi(moneyCheckRoute, async (c) => {
    const body = c.req.valid('json')
    const loaded = await market()
    const at = now()
    const result = await calculate(() =>
      moneyCheck(loaded, body, dublinDate(at), new Date(at).toISOString()),
    )
    if (result.plan === null) return c.json(result, 200)
    const saveLink = await holdDraft(c, result.plan.plan, at)
    return c.json(
      {
        ...result,
        presentation: withLink(result.presentation, saveLink),
        plan: {
          ...result.plan,
          presentation: withLink(result.plan.presentation, saveLink),
          saveLink,
        },
      },
      200,
    )
  })

  return routes
}
