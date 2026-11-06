import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../context.ts'
import { security } from '../common.ts'
import { actionErrors, caseIdParam, seatOf } from './actionKit.ts'
import { requireRole } from './policy.ts'

/**
 * §42: this browser would like to be told when something moves. The values come from the
 * browser’s own Push API subscription; stored, never read back to a client.
 */

const subscribeBody = z
  .object({
    endpoint: z.url().max(2000),
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  })
  .openapi('SubscribePush')

const subscribedSchema = z.object({ subscribed: z.literal(true) }).openapi('PushSubscribed')

const route = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/push-subscriptions',
  tags: ['notifications'],
  summary: 'Register this browser for push notifications',
  description:
    'Keyed on the endpoint, so a phone that re-subscribes does not collect rows that each ' +
    'deliver another copy. Primary customer only: a partner browser must not be told about the ' +
    'primary’s applications. Was `case-action` `subscribe_push`.',
  security,
  middleware: [requireRole('subscribe_push')],
  request: {
    params: z.object({ caseId: caseIdParam }),
    body: { required: true, content: { 'application/json': { schema: subscribeBody } } },
  },
  responses: {
    201: {
      description: 'Stored.',
      content: { 'application/json': { schema: subscribedSchema } },
    },
    ...actionErrors,
  },
})

export const pushSubscriptionRoutes = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  const body = c.req.valid('json')
  const { caseId, participantId } = seatOf(c.get('caseAccess'))
  await c.get('store').subscribePush({ caseId, participantId, ...body })
  return c.json({ subscribed: true as const }, 201)
})
