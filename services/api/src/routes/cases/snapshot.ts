import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { caseSnapshotSchema } from '@shared/contracts/case-read.ts'
import type { AppEnv } from '../../context.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { caseParams } from './params.ts'
import { buildSnapshot } from './snapshotBuilder.ts'

const route = createRoute({
  method: 'get',
  path: '/api/cases/{caseId}/snapshot',
  tags: ['cases'],
  summary: 'The state of a case that cards are resolved against',
  description:
    'Applications, plans, requests, form answers, linked accounts, transfers and notifications. ' +
    'Replaces the direct table reads the public app made under RLS.',
  security,
  request: { params: caseParams },
  responses: {
    200: {
      description: 'The snapshot.',
      content: { 'application/json': { schema: caseSnapshotSchema.openapi('CaseSnapshot') } },
    },
    ...authenticatedErrors,
    404: errorResponse('No such case, or the caller cannot see it.'),
  },
})

export const snapshotRoutes = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  const { caseId } = c.get('caseAccess')
  const rows = await c.get('store').loadSnapshotRows(caseId)
  return c.json(buildSnapshot(caseId, !c.get('user').isAnonymous, rows), 200)
})
