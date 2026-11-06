import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { sessionResponseSchema, startSessionBodySchema } from '@shared/contracts/session.ts'
import type { AppEnv } from '../../context.ts'
import { requireIdentity } from '../../middleware/requireIdentity.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { openCase } from './open.ts'

const route = createRoute({
  method: 'post',
  path: '/api/sessions',
  tags: ['session'],
  summary: 'Attach this browser to a case, starting one if it has none',
  description:
    'Returns the conversation this browser was last in as its primary customer, so a browser ' +
    'tab and an installed app land on the same case. Otherwise opens a new case. Was `session` ' +
    'action `start`.',
  security,
  middleware: [requireIdentity],
  request: {
    body: {
      required: false,
      content: { 'application/json': { schema: startSessionBodySchema.openapi('StartSession') } },
    },
  },
  responses: {
    200: {
      description: 'The case this browser is in.',
      content: { 'application/json': { schema: sessionResponseSchema.openapi('SessionResponse') } },
    },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
  },
})

export const startRoutes = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  const body = c.req.valid('json') as { mode?: 'new' | 'known'; source?: string } | undefined
  const sessions = c.get('sessions')
  const identity = c.get('identity')

  // Already attached? Return the same case: this is what makes a PWA and a browser tab land on
  // the same conversation rather than starting two.
  const [found] = await sessions.primaryMappings(identity.id)
  if (found) return c.json(await sessions.describe(found, identity, false), 200)

  return c.json(await openCase(c, body?.mode ?? 'new', body?.source ?? null), 200)
})
