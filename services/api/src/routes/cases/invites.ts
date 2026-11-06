import { createHash, randomUUID } from 'node:crypto'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../context.ts'
import { security } from '../common.ts'
import { actionErrors, caseIdParam, outcome, resultResponse, seatOf } from './actionKit.ts'
import { requireRole } from './policy.ts'

/**
 * §6 Stage 9, §29, §58: invites the second applicant.
 *
 * Opaque and hashed like every link (Invariant 8), but neither expires nor is used up: the
 * second applicant opens it when they get to it, on whichever phone they have. What keeps it
 * honest is that only the latest works: inviting again voids every earlier link for the case,
 * so "ask for a new one" is also how the customer revokes one. The partner, the voided links,
 * the new link and the event are one Postgres transaction (`invite_partner_tx`).
 */

const inviteBody = z.object({ name: z.string().min(1).max(80) }).openapi('InvitePartner')

const route = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/invites',
  tags: ['partner'],
  summary: 'Invite the partner and mint the link',
  description:
    'Nothing is sent: the response carries `inviteUrl` for the customer to pass on. A partner ' +
    'cannot mint a link on the primary’s case. Was `case-action` `invite_partner`.',
  security,
  middleware: [requireRole('invite_partner')],
  request: {
    params: z.object({ caseId: caseIdParam }),
    body: { required: true, content: { 'application/json': { schema: inviteBody } } },
  },
  responses: { 201: resultResponse('The link, once.'), ...actionErrors },
})

export const inviteRoutes = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  const { name } = c.req.valid('json')
  const store = c.get('store')
  const { caseId } = seatOf(c.get('caseAccess'))

  const token = randomUUID().replaceAll('-', '')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await store.invitePartner({ caseId, name, tokenHash })

  const nameFor = await store.applicationNamer()
  return c.json(
    await outcome(
      store,
      caseId,
      nameFor,
      `Here is a link to pass to ${name}. Nothing is sent until you share it.`,
      { inviteUrl: store.inviteLink(token) },
    ),
    201,
  )
})
