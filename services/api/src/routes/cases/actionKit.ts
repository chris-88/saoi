import { z } from '@hono/zod-openapi'
import { caseActionResponseSchema } from '@shared/contracts/case-action.ts'
import type { LoadedCase } from '@shared/db/loaded-case.ts'
import { findApplication, type NameFor } from '@shared/db/applications.ts'
import { journeyFor } from '@shared/domain/journeys/index.ts'
import type { Application } from '@shared/domain/state-machine.ts'
import { ApiError } from '../../errors.ts'
import type { CaseAccess, CaseStore } from '../../store/cases.ts'
import { authenticatedErrors, errorResponse } from '../common.ts'

/**
 * What the case action routes share: the response every one of them gives, the parameters, and
 * the few steps each repeats (load the case, find the application on it, answer).
 *
 * The routes keep the rules; the store keeps the writes (`store/actions.ts`).
 */

/** What the SPA's `runCaseAction` has always parsed, minus the envelope. */
export const actionResultSchema = caseActionResponseSchema.openapi('CaseActionResult')

export const caseIdParam = z.uuid().openapi({
  param: { name: 'caseId', in: 'path' },
  example: '0b0c6a0e-6d4e-4a42-9d3f-7a3d4a1d2c11',
})

export const applicationIdParam = z.uuid().openapi({
  param: { name: 'applicationId', in: 'path' },
  example: '5d6a1c1e-0f6a-4c9f-9b52-3f2f1c7c9a10',
})

export const applicationParams = z.object({
  caseId: caseIdParam,
  applicationId: applicationIdParam,
})

export const resultResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: actionResultSchema } },
})

/** The failures every action can give. Spread into `responses`. */
export const actionErrors = {
  ...authenticatedErrors,
  400: errorResponse('The body is not valid, or the request breaks a rule of the journey.'),
  403: errorResponse('The caller’s role may not take this action (see the policy table).'),
  404: errorResponse('No such case for this caller, or nothing of that id on it.'),
}

/** A caller who passed `requireRole`: a seat on the case. An administrator has none. */
export function seatOf(access: CaseAccess): { caseId: string; participantId: string } {
  if (access.participantId === null) {
    throw new ApiError('forbidden', 'Only the person who started this case can do that.')
  }
  return { caseId: access.caseId, participantId: access.participantId }
}

export async function loadOrThrow(store: CaseStore, caseId: string): Promise<LoadedCase> {
  const loaded = await store.loadForAction(caseId)
  if (!loaded) throw new ApiError('not_found', 'That case does not exist.')
  return loaded
}

/** The application on *this* case. An id from another case is simply not found. */
export function applicationOn(loaded: LoadedCase, applicationId: string): Application {
  const application = findApplication(loaded, applicationId)
  if (!application) throw new ApiError('not_found', 'That application does not exist.')
  return application
}

export function requirementsOf(application: Pick<Application, 'product'>) {
  const journey = journeyFor(application.product)
  return [...journey.requirements, ...journey.branches.flatMap((branch) => branch.requirements)]
}

/** Recompute, sync the forms, and build the response every action ends with. */
export async function outcome(
  store: CaseStore,
  caseId: string,
  nameFor: NameFor,
  summary: string,
  extra: { inviteUrl?: string } = {},
) {
  return {
    applications: [...(await store.settle(caseId, nameFor))],
    summary,
    ...(extra.inviteUrl === undefined ? {} : { inviteUrl: extra.inviteUrl }),
  }
}

/** "balances and transactions", "balances, transactions and payments you approve". */
export function describeScope(scope: readonly string[]): string {
  const words = scope.map((item) => (item === 'payments' ? 'payments you approve' : item))
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`
}
