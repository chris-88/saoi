import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { purgeResultSchema } from '@shared/contracts/admin.ts'
import type { AppEnv } from '../../context.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'

/**
 * The destructive case actions. Each needs an explicit `confirm: true` in the body (a stray
 * request or a replayed one cannot wipe anything by accident), runs as one transaction with its
 * `admin_audit` row, and names the case it acts on: there is no "the most recent case".
 */

const confirmSchema = z
  .object({
    confirm: z.literal(true, { error: 'Send confirm: true to confirm this destructive action.' }),
  })
  .openapi('ConfirmDestructive')

const caseParam = z.object({ caseId: z.uuid().openapi({ param: { name: 'caseId', in: 'path' } }) })

const forbidden = errorResponse('Not an administrator.')
const confirmBody = {
  required: true,
  content: { 'application/json': { schema: confirmSchema } },
}

const resetBodySchema = confirmSchema.extend({ caseId: z.uuid() }).openapi('ResetCaseRequest', {
  description: 'The case to replace. Required: reset never picks one for you.',
})

const reset = createRoute({
  method: 'post',
  path: '/api/admin/cases/reset',
  tags: ['admin'],
  summary: 'Replace a case with the canonical presenter case',
  description:
    'Deletes the named case and creates the canonical presenter case (§43), in one ' +
    'transaction with an `admin_audit` row. `caseId` and `confirm: true` are required. Was ' +
    '`admin` action `reset_case`, which fell back to deleting the most recent case.',
  security,
  request: {
    body: { required: true, content: { 'application/json': { schema: resetBodySchema } } },
  },
  responses: {
    200: {
      description: 'The new case.',
      content: {
        'application/json': {
          schema: z
            .object({ caseId: z.uuid(), facts: z.number().int() })
            .openapi('ResetCaseResult'),
        },
      },
    },
    ...authenticatedErrors,
    400: errorResponse('No case id, or `confirm: true` is missing.'),
    403: forbidden,
    404: errorResponse('No case with that id.'),
  },
})

const remove = createRoute({
  method: 'delete',
  path: '/api/admin/cases/{caseId}',
  tags: ['admin'],
  summary: 'Delete a case and everything under it',
  description:
    'Cascades over participants, facts, applications, messages, plans and events. Nothing is ' +
    'archived. Writes an `admin_audit` row in the same transaction. Was `delete_case`.',
  security,
  request: { params: caseParam, body: confirmBody },
  responses: {
    200: {
      description: 'The id that was deleted.',
      content: {
        'application/json': {
          schema: z.object({ deleted: z.uuid() }).openapi('DeleteCaseResult'),
        },
      },
    },
    ...authenticatedErrors,
    400: errorResponse('`confirm: true` is missing.'),
    403: forbidden,
    404: errorResponse('No case with that id.'),
  },
})

const purge = createRoute({
  method: 'post',
  path: '/api/admin/cases/purge',
  tags: ['admin'],
  summary: 'Delete every case and every non-administrator auth user',
  description:
    'The cases go in one transaction with an `admin_audit` row; the auth-user sweep follows ' +
    'it and its count is added to that row. Administrators are kept. Was `purge_cases`.',
  security,
  request: { body: confirmBody },
  responses: {
    200: {
      description: 'How many cases and visitors were removed.',
      content: { 'application/json': { schema: purgeResultSchema.openapi('PurgeResult') } },
    },
    ...authenticatedErrors,
    400: errorResponse('`confirm: true` is missing.'),
    403: forbidden,
  },
})

const tagTest = createRoute({
  method: 'post',
  path: '/api/admin/cases/{caseId}/tag-test',
  tags: ['admin'],
  summary: 'Tag a probe’s case as a test case',
  description:
    'Sets `kind = test`, which takes the case out of the audience capacity count. Was ' +
    '`tag_test_case`.',
  security,
  request: { params: caseParam },
  responses: {
    200: {
      description: 'The case, tagged.',
      content: {
        'application/json': {
          schema: z
            .object({ caseId: z.uuid(), kind: z.literal('test') })
            .openapi('TagTestCaseResult'),
        },
      },
    },
    ...authenticatedErrors,
    403: forbidden,
    404: errorResponse('No case with that id.'),
  },
})

export const casesRoutes = new OpenAPIHono<AppEnv>()
  .openapi(reset, async (c) => {
    const { caseId } = c.req.valid('json')
    return c.json(await c.get('admin').cases.resetCase(caseId, c.get('user').id), 200)
  })
  .openapi(remove, async (c) => {
    const { caseId } = c.req.valid('param')
    return c.json(await c.get('admin').cases.deleteCase(caseId, c.get('user').id), 200)
  })
  .openapi(purge, async (c) => c.json(await c.get('admin').cases.purgeCases(c.get('user').id), 200))
  .openapi(tagTest, async (c) => {
    const { caseId } = c.req.valid('param')
    return c.json(await c.get('admin').cases.tagTestCase(caseId), 200)
  })
