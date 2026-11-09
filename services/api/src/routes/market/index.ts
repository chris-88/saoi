import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { bodyLimit } from 'hono/body-limit'
import {
  ABOUT_TOPICS,
  aboutResponseSchema,
  buildPlanRequestSchema,
  buildPlanResponseSchema,
  debtRequestSchema,
  debtResponseSchema,
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
import { affordability, switchMortgage } from '@shared/domain/market/mortgage.ts'
import { buildPlan } from '@shared/domain/market/plan.ts'
import { productDetail } from '@shared/domain/market/product.ts'
import { project } from '@shared/domain/market/projection.ts'
import { review } from '@shared/domain/market/review.ts'
import { MarketInputError, search } from '@shared/domain/market/search.ts'
import type { Market } from '@shared/domain/market/types.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError, errorBody } from '../../errors.ts'
import { clientAddress, rateLimit } from '../../middleware/rateLimit.ts'
import type { MarketStore } from '../../store/market.ts'
import { errorResponse } from '../common.ts'

/**
 * The public comparison API: `/api/market/*` (products) and `/api/calc/*` (calculations on the
 * customer's own figures), the engine behind the Saoi MCP tools. No sign-in: the MCP server
 * calls these for whoever is talking to their own AI. Nothing is stored; the customer's
 * circumstances travel in each request.
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
}

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
  'Information, not advice: results are ranked by a stated objective, for the inputs given. ' +
  'Unauthenticated and stateless: nothing sent is stored.'

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
    INFORMATION,
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
    INFORMATION,
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
    INFORMATION,
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
    INFORMATION,
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
    INFORMATION,
  security: [],
  request: { body: jsonBody(debtRequestSchema.openapi('DebtCalculation')) },
  responses: {
    ...ok('The calculation.', debtResponseSchema.openapi('DebtCalculationResult')),
    ...publicErrors,
  },
})

const buildPlanRoute = createRoute({
  method: 'post',
  path: '/api/calc/build-plan',
  tags: ['calc'],
  summary: 'The fastest combination of products for the customer’s goals, as a plan',
  description:
    'Given a situation and chosen goals: an emergency buffer (`emergencyBufferEur`, ' +
    '`emergencyBufferMonths` of outgoings, or an emergency_fund goal) in the best instant ' +
    'access, kept apart; each debt costing more than savings earn worked out cleared and kept, ' +
    'with both figures, and a cleared debt’s repayment saved; the rest split across the market ' +
    '(regular savers to their monthly caps, the lump sum to a fixed term or notice account that ' +
    'ends by the goal’s date only where it beats instant access by `minLockGainEur` and ' +
    '`minLockGainPctPerYear`, otherwise instant access; `keepAccessible` or ' +
    '`goalDateCertain: false` keep everything in instant access; at most €100,000 per ' +
    'provider); projected to the date the main goal is reached; what-ifs (an extra €100 a ' +
    'month, each debt cleared or kept, the month a target is reached at this pace); for a ' +
    'house deposit, what it supports under the Central Bank limits. To change an assumption, ' +
    'call again with the new inputs rather than adjusting the figures. Returns `plan` (a ' +
    '`MarketPlan`, the body `POST /api/plans` takes: send it unchanged to save it behind a ' +
    'one-time link), the reasoning, every figure, and `next` for the host to relay. ' +
    INFORMATION,
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

  routes.openapi(buildPlanRoute, async (c) => {
    const body = c.req.valid('json')
    const loaded = await market()
    const at = now()
    return c.json(
      await calculate(() => buildPlan(loaded, body, dublinDate(at), new Date(at).toISOString())),
      200,
    )
  })

  return routes
}
