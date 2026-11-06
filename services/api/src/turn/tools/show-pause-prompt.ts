import type { Card } from '@shared/contracts/cards.ts'
import { evaluateAdvisories } from '@shared/domain/advisories.ts'
import { applicationName, findApplication } from '@shared/db/applications.ts'
import type { ToolModule } from './_shared.ts'

export const showPausePromptTool: ToolModule<'show_pause_prompt'> = {
  name: 'show_pause_prompt',
  run(input, ctx) {
    const { loaded, nameFor } = ctx

    const { applicationId } = input
    const application = findApplication(loaded, applicationId)
    if (!application) return { result: 'There is no such application.', refused: true }

    // The advisory is deterministic; the model may only explain one that applies.
    const advisory = evaluateAdvisories(loaded.applications).find(
      (candidate) => String(candidate.appliesTo) === applicationId,
    )
    if (!advisory) {
      return {
        result: 'There is no advisory for that application, so do not offer to pause it.',
        refused: true,
      }
    }

    const card: Card = {
      type: 'pause_prompt',
      applicationId,
      displayName: applicationName(application, nameFor),
      advisoryTitle: advisory.title,
      advisoryExplanation: advisory.explanation,
    }

    return { result: 'Pause offered. The customer decides in the card.', card }
  },
}
