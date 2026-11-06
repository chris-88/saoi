import { asApplicationId } from '@shared/domain/facts.ts'
import { journeyFor } from '@shared/domain/journeys/index.ts'
import { transition } from '@shared/domain/state-machine.ts'
import type { HeldApplication, UploadStore } from '../../store/uploads.ts'

/**
 * §41: the bank asked, the customer answered, the application moves on.
 *
 * An application in `info_required` is waiting on the bank's own request, not on anything in
 * its journey, so the requirement engine's recompute cannot move it: the state machine refuses
 * `requirements_changed` after submission. The upload that fulfils the last open request is the
 * moment the information was supplied, and that is the transition taken here, through the
 * machine and never by setting the state. Nothing happens while another request is still open,
 * or in any other state: a document against a pre-submission journey requirement is the
 * engine's business on the next recompute.
 */
export async function settleInformationRequest(
  store: UploadStore,
  input: {
    caseId: string
    application: HeldApplication
    actor: 'customer' | 'partner'
    requirementId: string
    fileName: string
  },
): Promise<void> {
  const { application } = input
  if (application.state !== 'info_required') return
  if ((await store.openRequestCount(application.id)) > 0) return

  const result = transition(
    {
      id: asApplicationId(application.id),
      product: application.product,
      state: application.state,
      resumeTo: application.resumeTo,
    },
    { type: 'information_supplied' },
  )
  // Thrown rather than skipped: skipping leaves the application waiting for a document that
  // has just arrived, which is the defect this exists to end.
  if (!result.ok) throw new Error(result.error.message)

  await store.setApplicationState(
    application.id,
    result.application.state,
    result.application.resumeTo,
  )

  // The same event the console writes when it simulates the bank receiving a document, so the
  // return summary and the console narrate it with the words they already have.
  await store.writeEvent({
    caseId: input.caseId,
    type: 'document_received',
    actor: input.actor,
    applicationId: application.id,
    payload: {
      applicationName: journeyFor(application.product).displayName,
      requirementId: input.requirementId,
      fileName: input.fileName,
    },
  })
}
