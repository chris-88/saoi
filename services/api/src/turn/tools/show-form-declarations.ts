import type { Card } from '@shared/contracts/cards.ts'
import { findApplication } from '@shared/db/applications.ts'
import { formForProduct } from '@shared/tenants/demo/forms/mapping.ts'
import { formSnapshot } from '@shared/tenants/demo/forms/snapshots.ts'
import { resolveFormState } from '@shared/domain/forms/state.ts'
import { declarationWording } from '@shared/domain/forms/wording.ts'
import type { ToolModule } from './_shared.ts'

/*
 * The declarations, read out of the published definition.
 *
 * The model picks the moment; it supplies no wording and cannot. What the card
 * shows is what the document says, and the tap is the only way any of it reaches
 * the packet.
 */
export const showFormDeclarationsTool: ToolModule<'show_form_declarations'> = {
  name: 'show_form_declarations',
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
    const state = resolveFormState(snapshot.definition, stored?.answers ?? {})

    const declarations = state.outstanding
      .filter((field) => field.type === 'checkbox')
      .map((field) => ({ fieldId: field.id, wording: declarationWording(field) }))

    if (declarations.length === 0) {
      return {
        result: 'There are no declarations left to make on that form.',
        refused: true,
      }
    }

    const card: Card = {
      type: 'form_declarations',
      applicationId,
      formName: snapshot.version,
      declarations,
    }

    return {
      result: `Showed ${String(declarations.length)} declarations. The customer ticks each one.`,
      card,
    }
  },
}
