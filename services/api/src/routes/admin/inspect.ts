import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { adminCaseSchema } from '@shared/contracts/admin.ts'
import type { AppEnv } from '../../context.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'

/** The case inspector (§37). Was `admin` action `inspect_case`. */
const inspectCase = createRoute({
  method: 'get',
  path: '/api/admin/cases/{caseId}',
  tags: ['admin'],
  summary: 'Inspect a case',
  description:
    'Everything the console shows about one conversation: customer, needs, goals, plans, facts, ' +
    'applications, events, linked accounts and feedback. Was `admin` action `inspect_case`.',
  security,
  request: { params: z.object({ caseId: z.uuid() }) },
  responses: {
    200: {
      description: 'The case as the console reads it.',
      content: { 'application/json': { schema: adminCaseSchema.openapi('AdminCase') } },
    },
    ...authenticatedErrors,
    400: errorResponse('The case id is not a uuid.'),
    403: errorResponse('Not an administrator.'),
    404: errorResponse('No such case.'),
  },
})

export const inspectRoutes = new OpenAPIHono<AppEnv>().openapi(inspectCase, async (c) => {
  const { caseId } = c.req.valid('param')
  return c.json(await c.get('admin').inspect.inspectCase(caseId), 200)
})
