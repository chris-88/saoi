import type { Card } from '@shared/contracts/cards.ts'
import { journeyFor } from '@shared/domain/journeys/index.ts'
import { applicationName, evaluateFor, findApplication } from '@shared/db/applications.ts'
import { confirmationsForReview, readyForReview } from '@shared/domain/requirements.ts'
import { formatFactValue } from '@shared/domain/reuse.ts'
import type { ToolModule } from './_shared.ts'

export const showReviewTool: ToolModule<'show_review'> = {
  name: 'show_review',
  run(input, ctx) {
    const { loaded, nameFor } = ctx

    const { applicationId } = input
    const application = findApplication(loaded, applicationId)
    if (!application) return { result: 'There is no such application.', refused: true }

    const evaluation = evaluateFor(loaded, application)
    if (!readyForReview(evaluation)) {
      // §48 — a review card is a promise that submission is one tap away, so it is
      // refused while real information is still missing.
      const remaining = evaluation.outstanding
        .filter((item) => item.blocking)
        .map((item) => item.requirement.label)
      return {
        result: `Not ready to review. Still needed: ${remaining.join(', ')}.`,
        refused: true,
      }
    }

    /*
     * The row's own name. Three savings accounts reviewed one after another were
     * three cards all headed "Savings account", and the customer confirmed each
     * without being told which it was. A product name is kept as the catalogue
     * spells it on the button too: "Submit SuperSaver", not "Submit supersaver";
     * only the journey's generic name reads as a common noun.
     */
    const name = applicationName(application, nameFor)
    const generic = name === journeyFor(application.product).displayName

    // Built from the case, not from the model's words (Invariant 2). Values are
    // printed as the reuse card prints them, money as money and a PPS number
    // masked, rather than "60000" and "true".
    const card: Card = {
      type: 'review',
      applicationId,
      displayName: name,
      summary: evaluation.satisfied
        .flatMap((item) =>
          item.fact === null
            ? []
            : [
                {
                  label: item.requirement.label,
                  value: formatFactValue(item.fact.key, item.fact.value),
                },
              ],
        )
        .slice(0, 12),
      confirmations: confirmationsForReview(evaluation).map((item) => ({
        requirementId: item.requirement.id,
        label: item.requirement.label,
        kind:
          item.requirement.kind === 'declaration'
            ? ('declaration' as const)
            : item.requirement.kind === 'confirmation'
              ? ('confirmation' as const)
              : ('reuse' as const),
        knownValue:
          item.knownFact === null
            ? null
            : formatFactValue(item.knownFact.key, item.knownFact.value),
      })),
      confirmLabel: `Submit ${generic ? name.toLowerCase() : name}`,
    }

    return {
      result:
        'Review shown. Nothing is submitted until the customer taps. Say in a line ' +
        'what they are checking and that the tap is what sends it.',
      card,
    }
  },
}
