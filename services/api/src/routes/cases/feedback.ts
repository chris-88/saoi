import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { security } from '../common.ts'
import { actionErrors, caseIdParam, outcome, resultResponse, seatOf } from './actionKit.ts'
import { requireRole } from './policy.ts'

/**
 * §44: what they thought of it. A thumbs lands on one of Saoirse's replies, so the message has to
 * be one of Saoirse's and on this case: a thumbs on the customer's own line, or on a reply from
 * somebody else's conversation, is refused as not found rather than written against the wrong
 * thing. It is never a turn: Saoirse does not reply to feedback.
 */

const feedbackBody = z
  .object({
    kind: z.enum(['turn', 'session']),
    messageId: z.uuid().optional(),
    rating: z.number().int().min(-1).max(5),
    comment: z.string().trim().max(2000).optional(),
    replyTo: z.string().trim().email().max(200).optional(),
  })
  .openapi('GiveFeedback')

const route = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/feedback',
  tags: ['feedback'],
  summary: 'A thumbs on a reply, or a rating of the whole thing',
  description:
    'A `turn` needs the reply it is on and is up or down (1 or -1); a `session` is one to five. ' +
    'Was `case-action` `give_feedback`.',
  security,
  middleware: [requireRole('give_feedback')],
  request: {
    params: z.object({ caseId: caseIdParam }),
    body: { required: true, content: { 'application/json': { schema: feedbackBody } } },
  },
  responses: { 201: resultResponse('Thanks, noted.'), ...actionErrors },
})

export const feedbackRoutes = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  const body = c.req.valid('json')
  const store = c.get('store')
  const { caseId, participantId } = seatOf(c.get('caseAccess'))

  // What each kind requires, since the schema carries both in one shape.
  if (body.kind === 'turn' && (body.messageId === undefined || Math.abs(body.rating) !== 1)) {
    throw new ApiError('bad_request', 'A thumbs needs the reply it is on and is up or down.')
  }
  if (body.kind === 'session' && (body.rating < 1 || body.rating > 5)) {
    throw new ApiError('bad_request', 'A rating is one to five.')
  }
  if (body.kind === 'turn' && body.messageId !== undefined) {
    if (!(await store.saoirseMessageOnCase(caseId, body.messageId))) {
      throw new ApiError('not_found', 'That reply is not on this case.')
    }
  }

  await store.saveFeedback({
    caseId,
    participantId,
    messageId: body.kind === 'turn' ? (body.messageId ?? null) : null,
    kind: body.kind,
    rating: body.rating,
    comment: body.comment === undefined || body.comment.length === 0 ? null : body.comment,
    replyTo: body.kind === 'session' ? (body.replyTo ?? null) : null,
  })

  const nameFor = await store.applicationNamer()
  return c.json(await outcome(store, caseId, nameFor, 'Thanks, noted.'), 201)
})
