import { callCaseActionApi } from '@/lib/saoiApi'
import {
  caseActionResponseSchema,
  type CaseActionRequest,
  type CaseActionResponse,
} from '@contracts/case-action.ts'

/**
 * Everything the customer commits by tapping (Invariant 1).
 *
 * Nothing here is reachable by the model: these are called from card buttons, and the server
 * re-validates access, state and rules on every one.
 *
 * Each action goes to its route on saoi-api, which also applies the role policy (a partner’s
 * browser is refused). `caseId` addresses the route for the actions that name an application only.
 */
export async function runCaseAction(
  action: CaseActionRequest,
  options: { caseId?: string } = {},
): Promise<CaseActionResponse> {
  return caseActionResponseSchema.parse(await callCaseActionApi(action, options.caseId))
}
