import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { caseHistorySchema } from '@shared/contracts/case-read.ts'
import { buildHistory, caseStateFromSnapshot } from '@shared/domain/card-state.ts'
import type { AppEnv } from '../../context.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { caseParams } from './params.ts'
import { buildSnapshot } from './snapshotBuilder.ts'

const HISTORY_LIMIT = 100

const route = createRoute({
  method: 'get',
  path: '/api/cases/{caseId}/history',
  tags: ['cases'],
  summary: 'The conversation as the screen renders it',
  description:
    'Messages and their cards, oldest first (the newest 100 messages). Each card carries `settled` ' +
    'when the case shows its decision has already been made, so a reload does not offer it again. ' +
    'Only the newest status card is current; older ones are settled as superseded.',
  security,
  request: { params: caseParams },
  responses: {
    200: {
      description: 'The transcript.',
      content: { 'application/json': { schema: caseHistorySchema.openapi('CaseHistory') } },
    },
    ...authenticatedErrors,
    404: errorResponse('No such case, or the caller cannot see it.'),
  },
})

export const historyRoutes = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  const { caseId } = c.get('caseAccess')
  const store = c.get('store')
  const [rows, messages] = await Promise.all([
    store.loadSnapshotRows(caseId),
    store.loadMessages(caseId, HISTORY_LIMIT),
  ])
  const state = caseStateFromSnapshot(buildSnapshot(caseId, !c.get('user').isAnonymous, rows))
  return c.json({ caseId, entries: [...buildHistory(messages, state)] }, 200)
})
