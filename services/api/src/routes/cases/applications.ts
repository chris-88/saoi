import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { applicationName, evaluateFor } from '@shared/db/applications.ts'
import { transition } from '@shared/domain/state-machine.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import type { CaseAccess, CaseStore } from '../../store/cases.ts'
import { errorResponse, security } from '../common.ts'
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

/** The customer's taps on one application: confirm, submit, pause, resume (§13, §27, §48). */

const requirementId = z.string().min(1).max(80)

const confirmBody = z.object({ requirementId }).openapi('ConfirmRequirement')
const submitBody = z
  .object({
    /**
     * The confirmations ticked on the review card travel with the submission, so an
     * application cannot end up half-confirmed: everything is agreed and it submits, or
     * nothing changes.
     */
    confirmations: z.array(requirementId).max(40).default([]),
  })
  .openapi('SubmitApplication')

const confirm = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/applications/{applicationId}/confirm',
  tags: ['applications'],
  summary: 'Confirm a reused value, a declaration or a consent',
  description:
    'The requirement must belong to the journey (§11). Was `case-action` `confirm_requirement`.',
  security,
  middleware: [requireRole('confirm_requirement')],
  request: {
    params: applicationParams,
    body: { required: true, content: { 'application/json': { schema: confirmBody } } },
  },
  responses: { 200: resultResponse('Confirmed.'), ...actionErrors },
})

const submit = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/applications/{applicationId}/submit',
  tags: ['applications'],
  summary: 'Submit an application from the review card',
  description:
    'The only route out of `ready` (§48), and the state machine is the rule. The ticked ' +
    'confirmations, the state change and its events are written in one Postgres transaction ' +
    '(`submit_application_tx`). 409 when the application is not ready. Was `case-action` ' +
    '`submit_application`.',
  security,
  middleware: [requireRole('submit_application')],
  request: {
    params: applicationParams,
    body: { required: true, content: { 'application/json': { schema: submitBody } } },
  },
  responses: {
    200: resultResponse('Submitted.'),
    ...actionErrors,
    409: errorResponse('Not ready to submit, or it changed while the request was in flight.'),
  },
})

const pauseRoute = (leaf: 'pause' | 'resume') =>
  createRoute({
    method: 'post',
    path: `/api/cases/{caseId}/applications/{applicationId}/${leaf}`,
    tags: ['applications'],
    summary: leaf === 'pause' ? 'Hold an application' : 'Pick a held application back up',
    description:
      leaf === 'pause'
        ? 'Parks a personal loan’s need until the mortgage is sorted (§27). Was `case-action` `pause_application`.'
        : 'Back to where it was paused. Was `case-action` `resume_application`.',
    security,
    middleware: [requireRole(leaf === 'pause' ? 'pause_application' : 'resume_application')],
    request: { params: applicationParams },
    responses: { 200: resultResponse(leaf === 'pause' ? 'Paused.' : 'Resumed.'), ...actionErrors },
  })

export const applicationRoutes = new OpenAPIHono<AppEnv>()
  .openapi(confirm, async (c) => {
    const { applicationId } = c.req.valid('param')
    const body = c.req.valid('json')
    const store = c.get('store')
    const { caseId, participantId } = seatOf(c.get('caseAccess'))

    const loaded = await loadOrThrow(store, caseId)
    const application = applicationOn(loaded, applicationId)
    // A confirmation for something the journey does not ask would satisfy nothing and should
    // not be stored.
    if (!requirementsOf(application).some((candidate) => candidate.id === body.requirementId)) {
      throw new ApiError('bad_request', 'That is not part of this application.')
    }

    await store.confirmRequirement({
      applicationId,
      requirementId: body.requirementId,
      participantId,
      kind: 'confirmation',
    })
    const nameFor = await store.applicationNamer()
    return c.json(await outcome(store, caseId, nameFor, 'Confirmed.'), 200)
  })
  .openapi(submit, async (c) => {
    const { applicationId } = c.req.valid('param')
    const { confirmations } = c.req.valid('json')
    const store = c.get('store')
    const { caseId, participantId } = seatOf(c.get('caseAccess'))

    const loaded = await loadOrThrow(store, caseId)
    const application = applicationOn(loaded, applicationId)
    const nameFor = await store.applicationNamer()
    const name = applicationName(application, nameFor)

    let current = application
    if (confirmations.length > 0) {
      const known = new Set(requirementsOf(application).map((requirement) => requirement.id))
      if (confirmations.some((id) => !known.has(id))) {
        throw new ApiError('bad_request', 'Those are not part of this application.')
      }

      // With the ticks counted, can the application reach `ready`? Worked out here, before
      // anything is written, so that the writes can then be one transaction.
      const ticked = {
        ...loaded,
        confirmations: [
          ...loaded.confirmations,
          ...confirmations.map((requirementId) => ({
            applicationId: application.id,
            requirementId,
          })),
        ],
      }
      const evaluation = evaluateFor(ticked, application)
      const settled = transition(application, {
        type: 'requirements_changed',
        complete: evaluation.complete,
        waitingOn: evaluation.waitingOn,
        activeInConversation: false,
      })
      if (settled.ok) current = settled.application
    }

    // §48: the state machine is the rule, not a condition written here.
    const result = transition(current, { type: 'submission_confirmed' })
    if (!result.ok) {
      throw new ApiError(
        'illegal_transition',
        current.state === 'ready' ? result.error.message : 'That is not ready to submit yet.',
      )
    }

    const events = [
      ...(current.state === application.state
        ? []
        : [
            {
              type: 'application_state_changed',
              actor: 'system' as const,
              payload: { from: application.state, to: current.state, applicationName: name },
            },
          ]),
      {
        type: 'application_submitted',
        actor: 'customer' as const,
        payload: { applicationName: name },
      },
    ]

    const written = await store.submitApplication({
      caseId,
      applicationId,
      participantId,
      confirmations,
      fromState: application.state,
      toState: result.application.state,
      events,
    })
    if (!written) {
      throw new ApiError('conflict', 'That application has just changed. Look again and retry.')
    }

    return c.json(await outcome(store, caseId, nameFor, `${name} submitted.`), 200)
  })
  .openapi(pauseRoute('pause'), async (c) =>
    c.json(
      await changeState(
        c.get('store'),
        c.get('caseAccess'),
        c.req.valid('param').applicationId,
        true,
      ),
      200,
    ),
  )
  .openapi(pauseRoute('resume'), async (c) =>
    c.json(
      await changeState(
        c.get('store'),
        c.get('caseAccess'),
        c.req.valid('param').applicationId,
        false,
      ),
      200,
    ),
  )

async function changeState(
  store: CaseStore,
  access: CaseAccess,
  applicationId: string,
  pausing: boolean,
) {
  const { caseId } = seatOf(access)

  const loaded = await loadOrThrow(store, caseId)
  const application = applicationOn(loaded, applicationId)
  const result = transition(application, { type: pausing ? 'paused' : 'resumed' })
  if (!result.ok) throw new ApiError('illegal_transition', result.error.message)

  const nameFor = await store.applicationNamer()
  const name = applicationName(application, nameFor)
  await store.changeApplicationState({
    caseId,
    applicationId,
    state: result.application.state,
    resumeTo: result.application.resumeTo,
    event: {
      type: pausing ? 'application_paused' : 'application_resumed',
      payload: { applicationName: name },
    },
    // Pausing a loan while a mortgage is in flight parks the need with the condition that
    // brings it back, so the customer does not have to raise it again months later.
    deferLoanNeed: pausing && application.product === 'personal_loan',
  })

  return outcome(store, caseId, nameFor, `${name} ${pausing ? 'paused' : 'resumed'}.`)
}
