import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../context.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { actionBody } from './schemas.ts'

/**
 * The presenter's hand on the downstream world (§38, §41): the bank's events, the savings
 * balance, plans, documents and transfers. Each one was an `admin` action.
 */

const json = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { 'application/json': { schema } },
})

const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const caseParam = z.object({ caseId: z.uuid() })

const stateSchema = z.object({ state: z.string() }).openapi('AdminApplicationState')

const simulateEventBody = actionBody('simulate_event').omit({ applicationId: true })
const simulateEvent = createRoute({
  method: 'post',
  path: '/api/admin/applications/{applicationId}/events',
  tags: ['admin'],
  summary: 'Simulate a bank event',
  description:
    'A downstream event as the bank would raise it, through the state machine. An illegal move ' +
    'is `illegal_transition`. Was `admin` action `simulate_event`.',
  security,
  request: {
    params: z.object({ applicationId: z.uuid() }),
    body: json(simulateEventBody.openapi('AdminSimulateEventRequest')),
  },
  responses: {
    200: ok('The state the application is now in.', stateSchema),
    ...authenticatedErrors,
    400: errorResponse('The body is not valid, or the documents cannot be checked.'),
    403: errorResponse('Not an administrator.'),
    404: errorResponse('No such application.'),
    409: errorResponse('The state machine refuses that move (`illegal_transition`).'),
  },
})

const reachSavingsTarget = createRoute({
  method: 'post',
  path: '/api/admin/cases/{caseId}/savings-target/reach',
  tags: ['admin'],
  summary: 'Reach the savings target',
  description: 'Was `admin` action `reach_savings_target`.',
  security,
  request: { params: caseParam },
  responses: {
    200: ok(
      'Whether a savings watch was met.',
      z
        .object({ reached: z.boolean(), target: z.number().nullable() })
        .openapi('AdminSavingsTargetResult'),
    ),
    ...authenticatedErrors,
    403: errorResponse('Not an administrator.'),
  },
})

const setSavingsBalance = createRoute({
  method: 'put',
  path: '/api/admin/cases/{caseId}/savings-balance',
  tags: ['admin'],
  summary: 'Set the savings balance',
  description: 'Was `admin` action `set_savings_balance`.',
  security,
  request: {
    params: caseParam,
    body: json(
      actionBody('set_savings_balance')
        .omit({ caseId: true })
        .openapi('AdminSavingsBalanceRequest'),
    ),
  },
  responses: {
    200: ok(
      'What was evaluated after the balance moved.',
      z
        .object({
          amount: z.number(),
          seen: z.number().nullable(),
          plansActive: z.number().int(),
          milestonesConsidered: z.number().int(),
          milestonesReached: z.number().int(),
        })
        .openapi('AdminSavingsBalanceResult'),
    ),
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    403: errorResponse('Not an administrator.'),
  },
})

const planMove = createRoute({
  method: 'post',
  path: '/api/admin/cases/{caseId}/plans/{planId}/moves',
  tags: ['admin'],
  summary: 'Move a plan',
  description: 'Was `admin` action `plan_move`.',
  security,
  request: {
    params: z.object({ caseId: z.uuid(), planId: z.uuid() }),
    body: json(
      actionBody('plan_move').omit({ caseId: true, planId: true }).openapi('AdminPlanMoveRequest'),
    ),
  },
  responses: {
    200: ok(
      'The plan status, and the check-in brought due when that was the move.',
      z
        .object({ status: z.string(), checkin: z.string().optional() })
        .openapi('AdminPlanMoveResult'),
    ),
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    403: errorResponse('Not an administrator.'),
    404: errorResponse('There is no such plan.'),
    409: errorResponse('The plan cannot make that move, or nothing is scheduled.'),
  },
})

const verifyDocuments = createRoute({
  method: 'post',
  path: '/api/admin/cases/{caseId}/documents/verify',
  tags: ['admin'],
  summary: 'Verify the case’s documents',
  description: 'Was `admin` action `verify_documents`.',
  security,
  request: { params: caseParam },
  responses: {
    200: ok(
      'How many documents were marked verified.',
      z.object({ verified: z.number().int() }).openapi('AdminVerifyDocumentsResult'),
    ),
    ...authenticatedErrors,
    403: errorResponse('Not an administrator.'),
  },
})

const demoAction = createRoute({
  method: 'post',
  path: '/api/admin/cases/{caseId}/demo-actions',
  tags: ['admin'],
  summary: 'Run a one-click demo move',
  description: 'Was `admin` action `demo_action`.',
  security,
  request: {
    params: caseParam,
    body: json(actionBody('demo_action').omit({ caseId: true }).openapi('AdminDemoActionRequest')),
  },
  responses: {
    200: ok('The state the application reached.', stateSchema),
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    403: errorResponse('Not an administrator.'),
    404: errorResponse('There is no such application on the case.'),
  },
})

const settleTransfer = createRoute({
  method: 'post',
  path: '/api/admin/transfers/{transferId}/settle',
  tags: ['admin'],
  summary: 'Settle a transfer',
  description: 'Was `admin` action `settle_transfer`.',
  security,
  request: { params: z.object({ transferId: z.uuid() }) },
  responses: {
    200: ok(
      'The settled transfer.',
      z
        .object({
          transferId: z.uuid(),
          state: z.literal('settled'),
          settledAt: z.string(),
        })
        .openapi('AdminSettleTransferResult'),
    ),
    ...authenticatedErrors,
    403: errorResponse('Not an administrator.'),
    404: errorResponse('No such transfer.'),
    409: errorResponse('That transfer is already settled.'),
  },
})

export const simulateRoutes = new OpenAPIHono<AppEnv>()
  .openapi(simulateEvent, async (c) => {
    const { applicationId } = c.req.valid('param')
    const body = c.req.valid('json')
    const result = await c.get('admin').simulate.simulateEvent({ applicationId, ...body })
    return c.json(result, 200)
  })
  .openapi(reachSavingsTarget, async (c) => {
    const { caseId } = c.req.valid('param')
    return c.json(await c.get('admin').simulate.reachSavingsTarget(caseId), 200)
  })
  .openapi(setSavingsBalance, async (c) => {
    const { caseId } = c.req.valid('param')
    const { amount } = c.req.valid('json')
    return c.json(await c.get('admin').simulate.setSavingsBalance(caseId, amount), 200)
  })
  .openapi(planMove, async (c) => {
    const { caseId, planId } = c.req.valid('param')
    const { move } = c.req.valid('json')
    return c.json(await c.get('admin').simulate.planMove(caseId, planId, move), 200)
  })
  .openapi(verifyDocuments, async (c) => {
    const { caseId } = c.req.valid('param')
    return c.json(await c.get('admin').simulate.verifyDocuments(caseId), 200)
  })
  .openapi(demoAction, async (c) => {
    const { caseId } = c.req.valid('param')
    const { move } = c.req.valid('json')
    return c.json(await c.get('admin').simulate.demoAction(caseId, move), 200)
  })
  .openapi(settleTransfer, async (c) => {
    const { transferId } = c.req.valid('param')
    return c.json(await c.get('admin').simulate.settleTransfer(transferId), 200)
  })
