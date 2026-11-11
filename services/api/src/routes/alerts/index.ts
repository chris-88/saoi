import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  caseAlertsResponseSchema,
  createReminderBodySchema,
  dueOnProblem,
  reminderSchema,
} from '@shared/contracts/alerts.ts'
import type { Market } from '@shared/domain/market/types.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { requireCaseAccess } from '../../middleware/requireCaseAccess.ts'
import type { AlertStore } from '../../store/alerts.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { caseParams } from '../cases/params.ts'
import { dublinDate } from '../market/index.ts'
import { isPresenter as sameKey } from '../session/presenter.ts'
import { type AlertPush, runAlerts } from './run.ts'

/**
 * Plan alerts and reminders: the case's own reads and writes (primary customer only), and the
 * internal run a timer on the host calls.
 */

export const INTERNAL_KEY_HEADER = 'X-Internal-Key'
export const INTERNAL_ROUTE_PREFIX = '/api/internal/'

export type AlertRouteOptions = {
  readonly store: AlertStore
  readonly market: () => Promise<Market>
  readonly push?: AlertPush | undefined
  /** `INTERNAL_JOB_KEY`. Empty: the internal run answers 404, so nothing is exposed. */
  readonly internalKey: string
  readonly now?: () => number
}

const caseAlertsRoute = createRoute({
  method: 'get',
  path: '/api/cases/{caseId}/alerts',
  tags: ['alerts'],
  summary: 'The case’s alerts and reminders',
  description:
    'Alerts newest first (a rate changed or a product was withdrawn on a claimed plan, or a ' +
    'date the customer gave is coming up), and the open reminders by date. Facts with a date ' +
    'and a source, never advice. Returning them marks them seen. Primary customer only.',
  security,
  middleware: [requireCaseAccess] as const,
  request: { params: caseParams },
  responses: {
    200: {
      description: 'Alerts and reminders.',
      content: {
        'application/json': { schema: caseAlertsResponseSchema.openapi('CaseAlerts') },
      },
    },
    ...authenticatedErrors,
    404: errorResponse('No such case for this caller.'),
  },
})

const createReminderRoute = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/reminders',
  tags: ['alerts'],
  summary: 'Set a reminder for a date the customer gave',
  description:
    'A fixed rate ending, a deposit maturing, or anything else. Alerts follow 90, 60, 30 and 7 ' +
    'days before it and on the day. The date must be today or later (Europe/Dublin).',
  security,
  middleware: [requireCaseAccess] as const,
  request: {
    params: caseParams,
    body: {
      required: true,
      content: {
        'application/json': { schema: createReminderBodySchema.openapi('CreateReminder') },
      },
    },
  },
  responses: {
    201: {
      description: 'Set.',
      content: { 'application/json': { schema: reminderSchema.openapi('Reminder') } },
    },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid, or the date has passed.'),
    404: errorResponse('No such case for this caller.'),
  },
})

const deleteReminderRoute = createRoute({
  method: 'delete',
  path: '/api/cases/{caseId}/reminders/{reminderId}',
  tags: ['alerts'],
  summary: 'Delete a reminder',
  description: 'No further alerts for it. Alerts already raised stay.',
  security,
  middleware: [requireCaseAccess] as const,
  request: {
    params: caseParams.extend({
      reminderId: z.uuid().openapi({ param: { name: 'reminderId', in: 'path' } }),
    }),
  },
  responses: {
    204: { description: 'Deleted.' },
    ...authenticatedErrors,
    404: errorResponse('No such case for this caller, or no such reminder on it.'),
  },
})

export function alertRoutes(options: AlertRouteOptions) {
  const now = options.now ?? Date.now
  const routes = new OpenAPIHono<AppEnv>()

  routes.openapi(caseAlertsRoute, async (c) => {
    const { caseId } = c.req.valid('param')
    const listed = await options.store.listForCase(caseId)
    const unseen = listed.alerts.filter((alert) => alert.seenAt === null).map((alert) => alert.id)
    await options.store.markSeen(caseId, unseen)
    return c.json(listed, 200)
  })

  routes.openapi(createReminderRoute, async (c) => {
    const { caseId } = c.req.valid('param')
    const body = c.req.valid('json')
    const problem = dueOnProblem(body.dueOn, dublinDate(now()))
    if (problem !== null) throw new ApiError('bad_request', problem)
    const access = c.get('caseAccess')
    const reminder = await options.store.createReminder({
      caseId,
      kind: body.kind,
      label: body.label,
      dueOn: body.dueOn,
      productId: body.productId,
      createdBy: access.participantId ?? null,
    })
    return c.json(reminder, 201)
  })

  routes.openapi(deleteReminderRoute, async (c) => {
    const { caseId, reminderId } = c.req.valid('param')
    const deleted = await options.store.deleteReminder(caseId, reminderId)
    if (!deleted) throw new ApiError('not_found', 'No such reminder on this case.')
    return c.body(null, 204)
  })

  // Not in the OpenAPI document: a machine route, called by the host's timer with the key.
  routes.post(`${INTERNAL_ROUTE_PREFIX}alerts/run`, async (c) => {
    if (options.internalKey.length === 0) {
      throw new ApiError('not_found', 'No such route.')
    }
    if (!sameKey(options.internalKey, c.req.header(INTERNAL_KEY_HEADER))) {
      throw new ApiError('unauthorised', 'The internal key is missing or wrong.')
    }
    const at = now()
    const result = await runAlerts(
      { store: options.store, market: options.market, push: options.push, log: c.get('log') },
      { nowIso: new Date(at).toISOString(), today: dublinDate(at) },
    )
    c.get('log').info('alerts run', { requestId: c.get('requestId'), ...result })
    return c.json(result, 200)
  })

  return routes
}
