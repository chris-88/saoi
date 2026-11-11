import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  caseHoldingsResponseSchema,
  createHoldingBodySchema,
  holdingSchema,
  updateHoldingBodySchema,
} from '@shared/contracts/holdings.ts'
import { planProgress } from '@shared/domain/market/holdings.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { requireCaseAccess } from '../../middleware/requireCaseAccess.ts'
import type { HoldingStore } from '../../store/holdings.ts'
import type { PlanStore } from '../../store/plans.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { caseParams } from '../cases/params.ts'
import { dublinDate } from '../market/index.ts'

/**
 * Holdings: the accounts and debts the customer entered by hand (or that a claimed plan seeded),
 * and where they leave the plan. Primary customer only. Progress is a fact with its figures,
 * never praise or advice.
 */

export type HoldingRouteOptions = {
  readonly store: HoldingStore
  /** Where progress reads the case's claimed plan. */
  readonly plans: Pick<PlanStore, 'claimedPlan'>
  readonly now?: () => number
}

const holdingParams = caseParams.extend({
  holdingId: z.uuid().openapi({ param: { name: 'holdingId', in: 'path' } }),
})

const listRoute = createRoute({
  method: 'get',
  path: '/api/cases/{caseId}/holdings',
  tags: ['holdings'],
  summary: 'The case’s holdings and progress against the plan',
  description:
    'The accounts and debts on the case (not deleted), and progress against the claimed plan’s ' +
    'house-deposit or debt goal: held now against what is needed, the month at this pace and ' +
    'the difference from the plan’s own path, before interest. Facts, never advice. Primary ' +
    'customer only.',
  security,
  middleware: [requireCaseAccess] as const,
  request: { params: caseParams },
  responses: {
    200: {
      description: 'Holdings and progress.',
      content: {
        'application/json': { schema: caseHoldingsResponseSchema.openapi('CaseHoldings') },
      },
    },
    ...authenticatedErrors,
    404: errorResponse('No such case for this caller.'),
  },
})

const createHoldingRoute = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/holdings',
  tags: ['holdings'],
  summary: 'Add an account or a debt',
  description:
    'Noted today unless `notedOn` says otherwise. A `fixedUntil` date of today or later keeps a ' +
    'reminder for it (a fixed rate ending, a deposit maturing).',
  security,
  middleware: [requireCaseAccess] as const,
  request: {
    params: caseParams,
    body: {
      required: true,
      content: {
        'application/json': { schema: createHoldingBodySchema.openapi('CreateHolding') },
      },
    },
  },
  responses: {
    201: {
      description: 'Added.',
      content: { 'application/json': { schema: holdingSchema.openapi('Holding') } },
    },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    404: errorResponse('No such case for this caller.'),
  },
})

const updateHoldingRoute = createRoute({
  method: 'patch',
  path: '/api/cases/{caseId}/holdings/{holdingId}',
  tags: ['holdings'],
  summary: 'Change an account or a debt',
  description:
    'Fields left out stay as they are; null clears an optional one. A new balance is noted ' +
    'today unless `notedOn` is given. A changed `fixedUntil` replaces its reminder; null ' +
    'deletes it.',
  security,
  middleware: [requireCaseAccess] as const,
  request: {
    params: holdingParams,
    body: {
      required: true,
      content: {
        'application/json': { schema: updateHoldingBodySchema.openapi('UpdateHolding') },
      },
    },
  },
  responses: {
    200: {
      description: 'Changed.',
      content: { 'application/json': { schema: holdingSchema.openapi('Holding') } },
    },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    404: errorResponse('No such case for this caller, or no such holding on it.'),
  },
})

const deleteHoldingRoute = createRoute({
  method: 'delete',
  path: '/api/cases/{caseId}/holdings/{holdingId}',
  tags: ['holdings'],
  summary: 'Delete an account or a debt',
  description: 'Its reminder is deleted with it.',
  security,
  middleware: [requireCaseAccess] as const,
  request: { params: holdingParams },
  responses: {
    204: { description: 'Deleted.' },
    ...authenticatedErrors,
    404: errorResponse('No such case for this caller, or no such holding on it.'),
  },
})

export function holdingRoutes(options: HoldingRouteOptions) {
  const now = options.now ?? Date.now
  const routes = new OpenAPIHono<AppEnv>()

  const contextFor = (caseId: string, participantId: string | null) => ({
    caseId,
    participantId,
    today: dublinDate(now()),
  })

  routes.openapi(listRoute, async (c) => {
    const { caseId } = c.req.valid('param')
    const [holdings, claimed] = await Promise.all([
      options.store.list(caseId),
      options.plans.claimedPlan(caseId),
    ])
    const progress =
      claimed === null ? null : planProgress(claimed.plan, holdings, dublinDate(now()))
    return c.json({ holdings, progress }, 200)
  })

  routes.openapi(createHoldingRoute, async (c) => {
    const { caseId } = c.req.valid('param')
    const body = c.req.valid('json')
    const context = contextFor(caseId, c.get('caseAccess').participantId ?? null)
    const holding = await options.store.create(context, {
      kind: body.kind,
      label: body.label,
      balance: body.balance,
      ratePct: body.ratePct,
      monthlyAmountEur: body.monthlyAmountEur,
      fixedUntil: body.fixedUntil,
      provider: body.provider,
      productId: body.productId,
      notedOn: body.notedOn ?? context.today,
    })
    return c.json(holding, 201)
  })

  routes.openapi(updateHoldingRoute, async (c) => {
    const { caseId, holdingId } = c.req.valid('param')
    const body = c.req.valid('json')
    const context = contextFor(caseId, c.get('caseAccess').participantId ?? null)
    const holding = await options.store.update(context, holdingId, body)
    if (holding === null) throw new ApiError('not_found', 'No such holding on this case.')
    return c.json(holding, 200)
  })

  routes.openapi(deleteHoldingRoute, async (c) => {
    const { caseId, holdingId } = c.req.valid('param')
    const context = contextFor(caseId, c.get('caseAccess').participantId ?? null)
    const deleted = await options.store.remove(context, holdingId)
    if (!deleted) throw new ApiError('not_found', 'No such holding on this case.')
    return c.body(null, 204)
  })

  return routes
}
