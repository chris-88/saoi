import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { notificationSchema } from '@shared/contracts/admin.ts'
import type { AppEnv } from '../../context.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { actionBody } from './schemas.ts'

const sendNotification = createRoute({
  method: 'post',
  path: '/api/admin/cases/{caseId}/notifications',
  tags: ['admin'],
  summary: 'Send a push notification',
  description:
    '§35, §42: a separate, deliberate action. Pushes to every browser the case has subscribed. ' +
    'Was `admin` action `send_notification`.',
  security,
  request: {
    params: z.object({ caseId: z.uuid() }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: actionBody('send_notification')
            .omit({ caseId: true })
            .openapi('AdminSendNotificationRequest'),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'What was sent, and how many devices took it.',
      content: { 'application/json': { schema: notificationSchema.openapi('AdminNotification') } },
    },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    403: errorResponse('Not an administrator.'),
    502: errorResponse('Push is not configured.'),
  },
})

export const pushRoutes = new OpenAPIHono<AppEnv>().openapi(sendNotification, async (c) => {
  const { caseId } = c.req.valid('param')
  const body = c.req.valid('json')
  return c.json(await c.get('admin').push.sendNotification({ caseId, ...body }), 200)
})
