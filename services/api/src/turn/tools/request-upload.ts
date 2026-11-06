import type { Card } from '@shared/contracts/cards.ts'
import { journeyFor } from '@shared/domain/journeys/index.ts'
import { evaluateFor, findApplication } from '@shared/db/applications.ts'
import type { ToolModule } from './_shared.ts'

export const requestUploadTool: ToolModule<'request_upload'> = {
  name: 'request_upload',
  async run(input, ctx) {
    const { admin, loaded } = ctx

    const { applicationId, documentType } = input
    const application = findApplication(loaded, applicationId)
    if (!application) {
      return { result: 'There is no such application.', refused: true }
    }

    // The journey decides what can be asked for, not the model (Invariant 3). The
    // named type narrows it; without one, the next outstanding document wins.
    const evaluation = evaluateFor(loaded, application)
    const documents = evaluation.outstanding.filter((item) => item.requirement.kind === 'document')
    // What the bank asked for after submission comes first, whatever the model
    // named: it is the only document an application in `info_required` is waiting
    // on, and the row to upload against already exists (§41).
    const outstanding =
      documents.find((item) => item.requestId !== undefined) ??
      documents.find(
        (item) =>
          item.requirement.kind === 'document' && item.requirement.documentType === documentType,
      ) ??
      documents[0]

    if (!outstanding || outstanding.requirement.kind !== 'document') {
      return {
        result: 'This application is not waiting on any documents.',
        refused: true,
      }
    }

    const requirementId = outstanding.requirement.id

    const journey = journeyFor(application.product)

    // One open request per requirement, so asking twice does not pile up rows. A
    // bank request names its row outright; a journey document may have one from
    // an earlier ask.
    const existing = loaded.requests.find(
      (request) =>
        request.applicationId === application.id &&
        request.requirementId === requirementId &&
        request.status === 'open',
    )

    let requestId = outstanding.requestId ?? existing?.id ?? null
    if (requestId === null) {
      const created = await admin
        .from('application_requests')
        .insert({
          application_id: application.id,
          requirement_id: requirementId,
          kind: 'document',
          status: 'open',
          detail: outstanding.requirement.label,
        })
        .select('id')
        .single()

      if (created.error) return { result: 'That could not be requested just now.' }
      requestId = created.data.id
    }

    const card: Card = {
      type: 'upload_request',
      requestId,
      applicationId: String(application.id),
      label: outstanding.requirement.label,
      documentType: outstanding.requirement.documentType,
      applicationName: journey.displayName,
    }

    return {
      result:
        `Upload card shown for ${outstanding.requirement.label}. Nothing arrives ` +
        'until they pick a file. Say in a line what it is for.',
      card,
    }
  },
}
