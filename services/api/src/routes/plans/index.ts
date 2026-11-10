import { createHash, randomBytes } from 'node:crypto'
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { bodyLimit } from 'hono/body-limit'
import {
  SAVE_PLAN_MAX_BYTES,
  marketPlanSchema,
  savePlanBodySchema,
  upgradeStoredPlan,
  savePlanResponseSchema,
  type MarketPlan,
} from '@shared/contracts/market-plan.ts'
import {
  claimPlanBodySchema,
  claimPlanResponseSchema,
  type ClaimPlanResponse,
} from '@shared/contracts/session.ts'
import type { CaseSubstance } from '@shared/domain/continuity.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError, errorBody } from '../../errors.ts'
import { clientAddress, rateLimit } from '../../middleware/rateLimit.ts'
import { requireIdentity } from '../../middleware/requireIdentity.ts'
import type { Identity, Mapping } from '../../store/sessions.ts'
import type { PlanStore, StoredPlan } from '../../store/plans.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'

/**
 * A plan made in the customer's own AI, carried into the app (roadmap step 5, the MCP design's
 * `saoi_save_plan`).
 *
 * `POST /api/plans` is public: the MCP server calls it with the plan its tools built, and gets
 * back a one-time link. `POST /api/plans/claim` is the app opening that link with the
 * visitor's anonymous session: the plan lands in a conversation and the token is spent.
 */

/**
 * 24 hours (Chris, 2026-11-09): a plan is held only so the customer can open it, then deleted
 * unless opened (`sweep_saved_plans`). Drafts from `saoi_build_plan` and saves alike.
 */
export const PLAN_LINK_TTL_MS = 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export type PlanRouteOptions = {
  readonly store: PlanStore
  /** The app's origin; the claim link is `<appBaseUrl>/#/plan/<token>`. */
  readonly appBaseUrl: string
  /** Saves a day across everybody, before the route refuses. */
  readonly dailyMax?: number
  /** Saves per address per window. */
  readonly burst?: { readonly max: number; readonly windowMs: number }
  readonly now?: () => number
}

/** Shared with the drafts `saoi_build_plan` holds: both count against it. */
export const DEFAULT_DAILY_MAX = 5_000
const DEFAULT_BURST = { max: 20, windowMs: 60_000 }

export const hashPlanToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

/** 128 random bits, base64url: 22 characters, nothing about the plan in it (Invariant 8). */
export const newPlanToken = (): string => randomBytes(16).toString('base64url')

export function linkBase(appBaseUrl: string): string {
  return (appBaseUrl.trim() === '' ? 'https://app.saoi.ie' : appBaseUrl.trim()).replace(/\/+$/, '')
}

const isEmpty = (substance: CaseSubstance): boolean =>
  substance.customerMessages === 0 &&
  substance.facts === 0 &&
  substance.applications === 0 &&
  substance.plans === 0

const saveRoute = createRoute({
  method: 'post',
  path: '/api/plans',
  tags: ['plans'],
  summary: 'Save a plan made in the customer’s own AI, behind a one-time link',
  description:
    'Public: no sign-in. Called by the Saoi MCP server (`saoi_save_plan`) with the plan ' +
    '`saoi_build_plan` returned (`MarketPlan`, version 1). Holds it and returns a claim link ' +
    'into app.saoi.ie that works once, for 24 hours; unopened, it is then deleted. ' +
    '`saoi_build_plan` already returns such a link with every plan. The body is capped at 64 KiB; saves are ' +
    'rate-limited per address and capped per day.',
  security: [],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: savePlanBodySchema.openapi('SavePlan') } },
    },
  },
  responses: {
    201: {
      description: 'Saved. Give the customer the link; it opens the plan in the app once.',
      content: {
        'application/json': { schema: savePlanResponseSchema.openapi('SavePlanResponse') },
      },
    },
    400: errorResponse('The plan is not valid. `details` says where.'),
    413: errorResponse('The body is larger than 64 KiB.'),
    429: errorResponse('Too many saves. See `Retry-After`.'),
  },
})

const claimRoute = createRoute({
  method: 'post',
  path: '/api/plans/claim',
  tags: ['plans'],
  summary: 'Open a saved plan in this browser’s conversation',
  description:
    'Spends the link’s token and puts the plan in a conversation: the browser’s current one ' +
    'when it is still empty, otherwise a new one. Records the situation’s facts that map ' +
    'cleanly onto the fact catalogue (`customer_stated`) and writes `plan_saved` and ' +
    '`plan_claimed`, which the next turn narrates with the plan card. Opening it again in the ' +
    'same browser returns the same conversation (`reopened`).',
  security,
  middleware: [requireIdentity],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: claimPlanBodySchema.openapi('ClaimPlan') } },
    },
  },
  responses: {
    200: {
      description: 'The conversation the plan is in, which this browser now opens.',
      content: {
        'application/json': { schema: claimPlanResponseSchema.openapi('ClaimPlanResponse') },
      },
    },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    404: errorResponse('No plan was saved behind this link.'),
    409: errorResponse('Somebody has already opened this link.'),
    410: errorResponse('The link has expired.'),
  },
})

const UNKNOWN = 'This link is not one Saoi gave out. Check it was copied in full.'
const USED =
  'This plan has already been opened. Each link works once, so it is in the conversation of ' +
  'whoever opened it first. Ask your assistant to save the plan again for a fresh link.'
const EXPIRED =
  'This link has expired: a plan is held for 24 hours, then deleted. Ask your assistant to ' +
  'build the plan again for a fresh link.'

export function planRoutes(options: PlanRouteOptions) {
  const { store } = options
  const now = options.now ?? Date.now
  const base = linkBase(options.appBaseUrl)
  const burst = options.burst ?? DEFAULT_BURST
  const dailyMax = options.dailyMax ?? DEFAULT_DAILY_MAX

  const routes = new OpenAPIHono<AppEnv>()

  routes.use(
    '/api/plans',
    bodyLimit({
      maxSize: SAVE_PLAN_MAX_BYTES,
      onError: (c) =>
        c.json(
          errorBody(
            new ApiError('bad_request', 'The plan is too large.'),
            c.get('requestId') as string | undefined,
          ),
          413,
        ),
    }),
  )
  const limiter = rateLimit({ ...burst, key: clientAddress, now })
  routes.use('/api/plans', limiter)

  routes.openapi(saveRoute, async (c) => {
    const body = c.req.valid('json')

    if ((await store.savedSince(new Date(now() - DAY_MS).toISOString())) >= dailyMax) {
      throw new ApiError('rate_limited', 'Saoi is saving a lot of plans today. Try again later.')
    }

    const token = newPlanToken()
    const expiresAt = new Date(now() + PLAN_LINK_TTL_MS).toISOString()
    await store.save({
      plan: body.plan,
      client: body.client ?? null,
      tokenHash: hashPlanToken(token),
      expiresAt,
    })
    c.get('log').info('plan saved', {
      requestId: c.get('requestId'),
      client: body.client ?? null,
      products: body.plan.combination.products.length,
    })

    return c.json({ claimUrl: `${base}/#/plan/${token}`, expiresAt }, 201)
  })

  routes.openapi(claimRoute, async (c) => {
    const { token } = c.req.valid('json')
    const sessions = c.get('sessions')
    const identity = c.get('identity')

    /** The same browser opening its own link again: back to where it went the first time. */
    const reopen = async (stored: StoredPlan): Promise<ClaimPlanResponse> => {
      if (stored.claimedBy !== identity.id || stored.caseId === null) {
        throw new ApiError('conflict', USED)
      }
      const participant = await sessions.primaryParticipant(stored.caseId)
      if (participant === null) throw new ApiError('conflict', USED)
      await sessions.attach(participant.id, identity.id)
      const mapping: Mapping = {
        participantId: participant.id,
        caseId: stored.caseId,
        role: 'primary',
      }
      return {
        ...(await sessions.describe(mapping, identity, false)),
        planTitle: stored.title,
        reopened: true,
      }
    }

    const stored = await store.findByTokenHash(hashPlanToken(token))
    if (stored === null) throw new ApiError('not_found', UNKNOWN)
    if (stored.claimedAt !== null) return c.json(await reopen(stored), 200)
    if (Date.parse(stored.expiresAt) <= now()) throw new ApiError('expired', EXPIRED)

    const parsed = marketPlanSchema.safeParse(upgradeStoredPlan(stored.document))
    if (!parsed.success) {
      throw new ApiError('internal', 'This plan could not be read.', { cause: parsed.error })
    }
    const plan: MarketPlan = parsed.data

    /**
     * Where the plan goes. The browser's current conversation when nothing has happened in it
     * yet (somebody who opened the app and then the link), because an empty conversation and a
     * second one beside it is a switcher with a blank row. Anything with substance is left as
     * it is and the plan gets a conversation of its own: its situation is a snapshot from
     * somewhere else, and folding it into what they already said would mean deciding which
     * figure is right without asking them.
     */
    const conversationFor = async (
      who: Identity,
    ): Promise<{ mapping: Mapping; created: boolean }> => {
      const [current] = await sessions.primaryMappings(who.id)
      if (
        current !== undefined &&
        isEmpty(await sessions.substance(current.caseId)) &&
        !(await store.caseHasPlan(current.caseId))
      ) {
        return { mapping: current, created: false }
      }

      // The same ceiling as any new conversation (§47). Refused before the token is spent.
      const since = new Date(now() - DAY_MS).toISOString()
      if ((await sessions.customerCasesSince(since)) >= c.get('config').audienceMaxCases) {
        throw new ApiError(
          'rate_limited',
          'Saoi is at capacity right now. Try the link again in a few minutes; it still works.',
        )
      }
      const opened = await sessions.createCase({ userId: who.id, mode: 'new', source: 'plan' })
      return {
        mapping: { participantId: opened.participantId, caseId: opened.caseId, role: 'primary' },
        created: true,
      }
    }

    const { mapping, created } = await conversationFor(identity)

    if (
      !(await store.markClaimed({ planId: stored.id, userId: identity.id, caseId: mapping.caseId }))
    ) {
      // Lost a race, or the clock passed the expiry in between: say which.
      const latest = await store.findByTokenHash(hashPlanToken(token))
      if (latest === null) throw new ApiError('not_found', UNKNOWN)
      if (latest.claimedAt !== null) return c.json(await reopen(latest), 200)
      throw new ApiError('expired', EXPIRED)
    }

    await store.recordClaim({
      planId: stored.id,
      caseId: mapping.caseId,
      participantId: mapping.participantId,
      plan,
      client: stored.client,
      savedAt: stored.createdAt,
    })
    // The most recently used seat is the one `POST /api/sessions` returns, so the app lands here.
    await sessions.attach(mapping.participantId, identity.id)

    return c.json(
      {
        ...(await sessions.describe(mapping, identity, created)),
        planTitle: plan.title,
        reopened: false,
      },
      200,
    )
  })

  return routes
}
