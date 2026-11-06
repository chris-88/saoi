import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { security } from '../common.ts'
import {
  actionErrors,
  applicationOn,
  applicationParams,
  loadOrThrow,
  outcome,
  requirementsOf,
  resultResponse,
  seatOf,
} from './actionKit.ts'
import { requireRole } from './policy.ts'

/** §7.5: explicit consent, recorded, before any sensitive question is asked. */

const consentBody = z.object({ requirementId: z.string().min(1).max(80) }).openapi('GrantConsent')

const route = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/applications/{applicationId}/consent',
  tags: ['consent'],
  summary: 'Grant a consent the journey asks for',
  description:
    'Only a requirement of kind `confirmation` can be consented to. The consent is recorded in ' +
    'its own right (§9), not only as a satisfied requirement. Primary customer only: a partner ' +
    'cannot grant the primary’s health consent. Was `case-action` `grant_consent`.',
  security,
  middleware: [requireRole('grant_consent')],
  request: {
    params: applicationParams,
    body: { required: true, content: { 'application/json': { schema: consentBody } } },
  },
  responses: { 200: resultResponse('Noted.'), ...actionErrors },
})

export const consentRoutes = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  const { applicationId } = c.req.valid('param')
  const { requirementId } = c.req.valid('json')
  const store = c.get('store')
  const { caseId, participantId } = seatOf(c.get('caseAccess'))

  const loaded = await loadOrThrow(store, caseId)
  const application = applicationOn(loaded, applicationId)
  const requirement = requirementsOf(application).find(
    (candidate) => candidate.id === requirementId,
  )
  if (!requirement || requirement.kind !== 'confirmation') {
    throw new ApiError('bad_request', 'That is not something to consent to here.')
  }

  await store.grantConsent({ caseId, applicationId, requirementId, participantId })
  const nameFor = await store.applicationNamer()
  return c.json(await outcome(store, caseId, nameFor, 'Thanks — noted.'), 200)
})
