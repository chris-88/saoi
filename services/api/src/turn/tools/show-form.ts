import type { Card } from '@shared/contracts/cards.ts'
import { journeyFor } from '@shared/domain/journeys/index.ts'
import { evaluateFor, findApplication } from '@shared/db/applications.ts'
import { factCatalogue } from '@shared/domain/facts.ts'
import type { ToolModule } from './_shared.ts'

export const showFormTool: ToolModule<'show_form'> = {
  name: 'show_form',
  run(input, ctx) {
    const { loaded } = ctx

    const { applicationId } = input
    const application = findApplication(loaded, applicationId)
    if (!application) return { result: 'There is no such application.', refused: true }

    const evaluation = evaluateFor(loaded, application)
    const blocking = evaluation.outstanding.filter((item) => item.blocking)
    const journey = journeyFor(application.product)

    // Consent first, always. The server picks, not the model, so the health
    // questions are unreachable until consent is recorded (§7.5, Invariant 6).
    const consent = blocking.find(
      (item) => item.requirement.kind === 'confirmation' && item.waitingOn === 'primary',
    )

    if (consent) {
      const card: Card = {
        type: 'consent',
        applicationId,
        requirementId: consent.requirement.id,
        title: 'Before we go any further',
        explanation:
          'Life cover depends on health information, which I will not ask for in ' +
          'conversation and cannot work out from anything else you have told me. ' +
          'You answer these yourself, in a form, and only if you agree to.',
        covers: ['Whether you smoke', 'Your height and weight', 'Any medical conditions you have'],
        confirmLabel: 'I agree to answer these',
      }
      return {
        result: 'Consent asked for. Nothing sensitive is asked until they agree.',
        card,
      }
    }

    // Consent given: the health branch is active, so its facts are now outstanding.
    const sensitive = blocking.filter(
      (item) =>
        item.requirement.kind === 'fact' &&
        factCatalogue[item.requirement.fact].sensitivity === 'special',
    )

    if (sensitive.length === 0) {
      return {
        result: 'There is no form outstanding for that application.',
        refused: true,
      }
    }

    const card: Card = {
      type: 'health_form',
      applicationId,
      title: `${journey.displayName} — health questions`,
      fields: sensitive.map((item) => {
        const key = item.requirement.kind === 'fact' ? item.requirement.fact : ''
        const definition = factCatalogue[key as keyof typeof factCatalogue]
        const schema = definition.schema as { _def?: { type?: string } }
        const type = schema._def?.type ?? ''

        return {
          key,
          label: definition.label,
          kind:
            type === 'boolean'
              ? ('boolean' as const)
              : type === 'array'
                ? ('text_list' as const)
                : ('number' as const),
          unit: key.endsWith('heightCm') ? 'cm' : key.endsWith('weightKg') ? 'kg' : null,
        }
      }),
    }

    return { result: 'Health form shown. They answer it themselves.', card }
  },
}
