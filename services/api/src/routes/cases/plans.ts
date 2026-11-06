import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { canTransition } from '@shared/domain/plans/engine.ts'
import type { PlanStatus } from '@shared/domain/plans/types.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { errorResponse, security } from '../common.ts'
import {
  actionErrors,
  caseIdParam,
  loadOrThrow,
  outcome,
  resultResponse,
  seatOf,
} from './actionKit.ts'
import { requireRole } from './policy.ts'

/**
 * §10, §37: the customer decides what happens to a plan. The transition table refuses anything
 * incoherent, so a completed plan cannot quietly reactivate and an abandoned one cannot be
 * paused. Nothing here infers intent: every change came from a tap.
 */

const DECISIONS = ['keep', 'not_now', 'pause', 'resume', 'abandon'] as const

const decisionBody = z.object({ decision: z.enum(DECISIONS) }).openapi('PlanDecision')

const route = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/plans/{planId}/decisions',
  tags: ['plans'],
  summary: 'Keep, pause, resume or drop a plan',
  description:
    'Keeping a plan agrees its target, which becomes the `goals.savingsTarget` fact. Was ' +
    '`case-action` `decide_plan`.',
  security,
  middleware: [requireRole('decide_plan')],
  request: {
    params: z.object({
      caseId: caseIdParam,
      planId: z.uuid().openapi({ param: { name: 'planId', in: 'path' } }),
    }),
    body: { required: true, content: { 'application/json': { schema: decisionBody } } },
  },
  responses: {
    200: resultResponse('Decided.'),
    ...actionErrors,
    409: errorResponse('The plan cannot move from where it is.'),
  },
})

const TARGET: Record<(typeof DECISIONS)[number], PlanStatus> = {
  keep: 'active',
  resume: 'active',
  not_now: 'abandoned',
  abandon: 'abandoned',
  pause: 'paused',
}

const EVENT: Record<(typeof DECISIONS)[number], string> = {
  keep: 'plan_created',
  pause: 'plan_paused',
  resume: 'plan_resumed',
  not_now: 'plan_abandoned',
  abandon: 'plan_abandoned',
}

export const planRoutes = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  const { planId } = c.req.valid('param')
  const { decision } = c.req.valid('json')
  const store = c.get('store')
  const { caseId } = seatOf(c.get('caseAccess'))

  const plan = await store.findPlan(caseId, planId)
  if (!plan) throw new ApiError('not_found', 'There is no such plan.')

  const status = TARGET[decision]
  if (!canTransition(plan.status, status)) {
    throw new ApiError('conflict', `That plan cannot move from ${plan.status}.`)
  }

  const loaded = await loadOrThrow(store, caseId)
  const amount = plan.targetAmount
  await store.savePlanDecision({
    caseId,
    plan,
    status,
    keep: decision === 'keep',
    goalTarget:
      decision === 'keep' && amount !== null && Number.isFinite(amount) && amount > 0
        ? Math.round(amount)
        : null,
    primaryId: loaded.participants.find((p) => p.role === 'primary')?.id ?? null,
    partnerId: loaded.participants.find((p) => p.role === 'partner')?.id ?? null,
    eventType: EVENT[decision],
  })

  const summary =
    decision === 'keep'
      ? `Kept "${plan.title}" as a plan.`
      : decision === 'pause'
        ? `Paused "${plan.title}".`
        : decision === 'resume'
          ? `Picked "${plan.title}" back up.`
          : `Dropped "${plan.title}".`
  const nameFor = await store.applicationNamer()
  return c.json(await outcome(store, caseId, nameFor, summary), 200)
})
