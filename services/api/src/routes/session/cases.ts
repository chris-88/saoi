import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  listCasesResponseSchema,
  newCaseBodySchema,
  sessionResponseSchema,
} from '@shared/contracts/session.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { requireIdentity } from '../../middleware/requireIdentity.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { caseParams } from '../cases/params.ts'
import { openCase } from './open.ts'
import { isPresenter } from './presenter.ts'

const presenterHeader = z.object({
  'x-presenter-key': z
    .string()
    .max(200)
    .optional()
    .openapi({
      param: { name: 'x-presenter-key', in: 'header' },
      description: 'Opens the conversations of other people to the device running the demo.',
    }),
})

const sessionBody = {
  description: 'The conversation now open.',
  content: { 'application/json': { schema: sessionResponseSchema.openapi('SessionResponse') } },
}

const list = createRoute({
  method: 'get',
  path: '/api/cases',
  tags: ['session'],
  summary: 'The conversations this browser can open',
  description:
    'A visitor sees their own. A presenter sending the key sees every case except `test` ones. ' +
    'Was `session` action `list_cases`; the key moved from the body to a header.',
  security,
  middleware: [requireIdentity],
  request: { headers: presenterHeader },
  responses: {
    200: {
      description: 'The switcher list.',
      content: {
        'application/json': { schema: listCasesResponseSchema.openapi('ListCasesResponse') },
      },
    },
    ...authenticatedErrors,
  },
})

const create = createRoute({
  method: 'post',
  path: '/api/cases',
  tags: ['session'],
  summary: 'Leave the current conversation and begin a fresh one',
  description: 'Was `session` action `new_case`. Counts against the daily audience cap.',
  security,
  middleware: [requireIdentity],
  request: {
    body: {
      required: false,
      content: { 'application/json': { schema: newCaseBodySchema.openapi('NewCase') } },
    },
  },
  responses: {
    201: { ...sessionBody, description: 'The new case.' },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    429: errorResponse('The audience cap is reached, or too many requests.'),
  },
})

const switchCase = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/switch',
  tags: ['session'],
  summary: 'Move this browser onto another conversation',
  description:
    'Allowed when the caller is already its primary customer, or sends the presenter key. ' +
    'Was `session` action `switch_case`.',
  security,
  middleware: [requireIdentity],
  request: { params: caseParams, headers: presenterHeader },
  responses: {
    200: sessionBody,
    ...authenticatedErrors,
    403: errorResponse('Not the caller’s conversation, and no valid presenter key.'),
    404: errorResponse('That conversation has no one in it.'),
  },
})

export const caseListRoutes = new OpenAPIHono<AppEnv>()
  .openapi(list, async (c) => {
    const sessions = c.get('sessions')
    const identity = c.get('identity')
    const key = c.req.valid('header')['x-presenter-key']
    const presenter = isPresenter(c.get('config').presenterKey, key)
    const [current] = await sessions.primaryMappings(identity.id)
    const cases = await sessions.listCases({
      userId: identity.id,
      presenter,
      currentCaseId: current?.caseId ?? null,
    })
    return c.json({ cases: [...cases], presenter }, 200)
  })
  .openapi(create, async (c) => {
    const body = c.req.valid('json') as { mode?: 'new' | 'known' } | undefined
    return c.json(await openCase(c, body?.mode ?? 'new', null), 201)
  })
  .openapi(switchCase, async (c) => {
    const { caseId } = c.req.valid('param')
    const sessions = c.get('sessions')
    const identity = c.get('identity')
    const key = c.req.valid('header')['x-presenter-key']
    const presenter = isPresenter(c.get('config').presenterKey, key)

    // Already its primary customer, or holding the key. Nothing else opens a conversation,
    // because the id alone is not an authorisation: it travels in links and sits in the console.
    const own = (await sessions.primaryMappings(identity.id)).find(
      (mapping) => mapping.caseId === caseId,
    )
    if (!own && !presenter) throw new ApiError('forbidden', 'Not your conversation.')

    if (own) {
      await sessions.attach(own.participantId, identity.id)
      return c.json(await sessions.describe(own, identity, false), 200)
    }

    // The presenter adopts the conversation's own primary participant rather than joining as a
    // second person: they are driving it, not taking part in it.
    const primary = await sessions.primaryParticipant(caseId)
    if (!primary) throw new ApiError('not_found', 'That conversation has no one in it.')
    await sessions.attach(primary.id, identity.id)
    return c.json(
      await sessions.describe(
        { participantId: primary.id, caseId, role: 'primary' },
        identity,
        false,
      ),
      200,
    )
  })
