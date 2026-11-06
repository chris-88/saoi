import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { landingFor, worthCarrying } from '@shared/domain/continuity.ts'
import { claimBodySchema, sessionResponseSchema } from '@shared/contracts/session.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { requireIdentity } from '../../middleware/requireIdentity.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'

const route = createRoute({
  method: 'post',
  path: '/api/sessions/claim',
  tags: ['session'],
  summary: 'Carry a conversation across a change of auth user',
  description:
    'Signing in does not always keep the user you had. The browser says who it was and the ' +
    'server moves the participant onto who it is now (§12, §28). Was `session` action ' +
    '`claim_participant`.',
  security,
  middleware: [requireIdentity],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: claimBodySchema.openapi('ClaimSession') } },
    },
  },
  responses: {
    200: {
      description: 'The conversation now open.',
      content: { 'application/json': { schema: sessionResponseSchema.openapi('SessionResponse') } },
    },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    403: errorResponse('The caller is anonymous, or the prior user is not an anonymous visitor.'),
    404: errorResponse('Nothing to carry over.'),
  },
})

export const claimRoutes = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  const { priorAuthUserId: prior } = c.req.valid('json')
  const sessions = c.get('sessions')
  const identity = c.get('identity')

  // The id did not change, so there is nothing to move. Answered rather than refused: the
  // client cannot know in advance which of the two sign-in shapes it got.
  if (prior === identity.id) {
    const [here] = await sessions.primaryMappings(identity.id)
    if (!here) throw new ApiError('not_found', 'Nothing to carry over.')
    return c.json(await sessions.describe(here, identity, false), 200)
  }

  // An anonymous caller claiming a conversation is how one visitor walks into another's.
  if (identity.isAnonymous) {
    throw new ApiError('forbidden', 'Sign in before carrying a conversation over.')
  }

  // And the conversation must still be held by an anonymous session: once an account has
  // claimed a participant it belongs to that account.
  const was = await sessions.identity(prior)
  if (was === null || !was.isAnonymous) {
    throw new ApiError('forbidden', 'That conversation is not available to carry over.')
  }

  const [held] = await sessions.primaryMappings(prior)
  if (!held) throw new ApiError('not_found', 'Nothing to carry over.')

  // What this account already has, read before anything is attached to it.
  const own = (await sessions.primaryMappings(identity.id)).find(
    (mapping) => mapping.caseId !== held.caseId,
  )

  const substance = await sessions.substance(held.caseId)
  const landing = landingFor({ prior: substance, accountHasConversation: own !== undefined })

  // Attached when it is worth keeping, and whenever it is the one being opened: a case on
  // screen with no row mapping it to this user disappears on the next call.
  if (worthCarrying(substance) || landing.on === 'prior') {
    await sessions.attach(held.participantId, identity.id)
  }

  // The anonymous row is left where it is: the only record that these two users were one person.
  if (landing.on === 'account' && own !== undefined) {
    return c.json(await sessions.describe(own, identity, false), 200)
  }
  return c.json(await sessions.describe(held, identity, false), 200)
})
