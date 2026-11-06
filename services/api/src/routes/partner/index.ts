import { createHash } from 'node:crypto'
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import {
  partnerJoinBodySchema,
  partnerSubmitBodySchema,
  partnerViewSchema,
} from '@shared/contracts/partner.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { requirePartner } from '../../middleware/requirePartner.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { factRowsFor } from './answers.ts'
import { buildView } from './view.ts'

/**
 * The partner's own surface (§6 Stage 9, §33, Invariant 7): three routes, scoped DTOs only.
 * A partner never reads a table. It goes through code that cannot accidentally widen.
 */

const viewResponse = {
  description: 'The partner’s screen: their tasks and the names and states of their applications.',
  content: { 'application/json': { schema: partnerViewSchema.openapi('PartnerView') } },
}

const join = createRoute({
  method: 'post',
  path: '/api/partner/join',
  tags: ['partner'],
  summary: 'Open an invitation',
  description:
    'Attaches this browser to the invited partner participant. The invite neither expires nor ' +
    'is used up, so the same link works from a second phone; inviting again voids it, but only ' +
    'for a browser that never joined. Was `partner` action `join`.',
  security,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: partnerJoinBodySchema.openapi('PartnerJoin') } },
    },
  },
  responses: {
    200: viewResponse,
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    403: errorResponse('The caller is not a partner on any case.'),
    404: errorResponse('That invitation is no longer valid.'),
  },
})

const tasks = createRoute({
  method: 'get',
  path: '/api/partner/tasks',
  tags: ['partner'],
  summary: 'The partner’s tasks and applications',
  description: 'Was `partner` action `tasks`.',
  security,
  middleware: [requirePartner],
  request: {},
  responses: {
    200: viewResponse,
    ...authenticatedErrors,
    403: errorResponse('The caller is not a partner on any case.'),
    404: errorResponse('That case no longer exists.'),
  },
})

const submit = createRoute({
  method: 'post',
  path: '/api/partner/submit',
  tags: ['partner'],
  summary: 'Answer tasks',
  description:
    'One answer can satisfy several applications. Answers are recorded as `partner_stated` ' +
    'facts; special-category facts are refused. Was `partner` action `submit`.',
  security,
  middleware: [requirePartner],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: partnerSubmitBodySchema.openapi('PartnerSubmit') } },
    },
  },
  responses: {
    200: viewResponse,
    ...authenticatedErrors,
    400: errorResponse('An answer is not valid.'),
    403: errorResponse('The caller is not a partner on any case.'),
    404: errorResponse('That case no longer exists.'),
  },
})

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export const partnerRoutes = new OpenAPIHono<AppEnv>()
  .openapi(join, async (c) => {
    const { token } = c.req.valid('json')
    const partners = c.get('partners')
    const userId = c.get('user').id

    if (!(await partners.userExists(userId))) throw new ApiError('unauthorised', 'No session.')

    const gone = new ApiError('not_found', 'That invitation is no longer valid. Ask for a new one.')
    const invite = await partners.findInvite(sha256(token))
    if (!invite) throw gone

    // Voided, expired and unknown all read the same from outside. A browser that already
    // joined keeps its way back in, so correcting a spelling cannot lock out half-done work.
    const known = await partners.hasSession(invite.participantId, userId)
    const expired = invite.expiresAt !== null && new Date(invite.expiresAt) < new Date()
    if (!known && (invite.consumedAt || expired)) throw gone
    if (!known) await partners.join(invite, userId)

    const seat = await partners.partnerSession(userId)
    if (!seat) throw new ApiError('forbidden', 'This is not your invitation.')
    const loaded = await partners.loadCase(seat.caseId)
    if (!loaded) throw new ApiError('not_found', 'That case no longer exists.')
    return c.json(buildView(loaded, seat), 200)
  })
  .openapi(tasks, async (c) => {
    const seat = c.get('partner')
    const loaded = await c.get('partners').loadCase(seat.caseId)
    if (!loaded) throw new ApiError('not_found', 'That case no longer exists.')
    return c.json(buildView(loaded, seat), 200)
  })
  .openapi(submit, async (c) => {
    const { answers } = c.req.valid('json')
    const seat = c.get('partner')
    const partners = c.get('partners')

    if (!(await partners.loadCase(seat.caseId))) {
      throw new ApiError('not_found', 'That case no longer exists.')
    }

    const { rows, problems } = factRowsFor(answers, seat.caseId, seat.participantId)
    if (problems.length > 0) throw new ApiError('bad_request', problems.join(' '))

    await partners.recordAnswers({
      caseId: seat.caseId,
      rows,
      partnerName: seat.displayName ?? 'Your partner',
    })

    const loaded = await partners.loadCase(seat.caseId)
    if (!loaded) throw new ApiError('not_found', 'That case no longer exists.')
    return c.json(buildView(loaded, seat), 200)
  })
