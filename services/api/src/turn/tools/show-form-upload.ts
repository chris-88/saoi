import type { Card } from '@shared/contracts/cards.ts'
import { findApplication } from '@shared/db/applications.ts'
import { formForProduct } from '@shared/tenants/demo/forms/mapping.ts'
import { formSnapshot } from '@shared/tenants/demo/forms/snapshots.ts'
import { resolveFormState } from '@shared/domain/forms/state.ts'
import type { ToolModule } from './_shared.ts'

/*
 * The next document the form is waiting for.
 *
 * The model names the application; the server picks the control and reads its
 * limits out of the definition. Which document a form wants, and what it will
 * accept, is the document's business.
 */
export const showFormUploadTool: ToolModule<'show_form_upload'> = {
  name: 'show_form_upload',
  run(input, ctx) {
    const { loaded } = ctx

    const { applicationId } = input
    const application = findApplication(loaded, applicationId)
    if (!application) return { result: 'There is no such application.', refused: true }

    const mapping = formForProduct(application.product)
    const snapshot = mapping ? formSnapshot(mapping.formId) : undefined
    if (!snapshot) {
      return { result: 'That application has no bank form behind it.', refused: true }
    }

    const stored = loaded.formApplications.find((row) => row.formId === snapshot.formId)
    if (!stored) {
      return { result: 'Nothing has been collected for that form yet.', refused: true }
    }

    const state = resolveFormState(snapshot.definition, stored.answers)
    const wanted = state.outstanding.find((field) => field.type === 'fileupload')
    if (!wanted) {
      return { result: 'That form is not waiting for any documents.', refused: true }
    }

    const maxMb = Number(wanted.platform?.['maxFileSize'] ?? 0)
    const allowedExtensions = wanted.platform?.['allowedExtensions']
    const extensions = (typeof allowedExtensions === 'string' ? allowedExtensions : '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)

    const card: Card = {
      type: 'form_upload',
      applicationId,
      formApplicationId: stored.id,
      fieldId: wanted.id,
      label: wanted.label,
      formName: snapshot.version,
      acceptedExtensions: extensions,
      maxFileSizeMb: Number.isFinite(maxMb) && maxMb > 0 ? maxMb : null,
    }

    return { result: 'Asked for the document. The customer attaches it.', card }
  },
}
