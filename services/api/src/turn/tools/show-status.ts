import type { Card } from '@shared/contracts/cards.ts'
import { applicationName, evaluateFor, statusSteps } from '@shared/db/applications.ts'
import { stateLabel } from '@shared/domain/state-machine.ts'
import type { ToolModule } from './_shared.ts'

/**
 * Status is worth refreshing as things change, so this window is short — it only stops the
 * same card appearing twice in a row, which is what happens when the model reaches for it as
 * something to say.
 */

const STATUS_CARD_WINDOW = 2

export const showStatusTool: ToolModule<'show_status'> = {
  name: 'show_status',
  run(_input, ctx) {
    const { loaded, nameFor, digest } = ctx

    const justShown = loaded.messages
      .slice(-STATUS_CARD_WINDOW)
      .some((message) => message.cards.includes('status'))

    if (justShown) {
      return {
        result:
          'The status card is already on screen from the previous turn. Say what has changed in your own words rather than showing it again.',
      }
    }

    /*
     * Nothing to show is a refusal, not an empty card.
     *
     * On case ad93c361 the model, denied the plan tool by the stage, drew this card
     * twice on a case with no applications and narrated "Nothing in progress yet"
     * as "your plan so far". A status card is a report on applications; with none,
     * there is nothing for it to report and nothing for it to stand in for.
     */
    if (loaded.applications.length === 0) {
      return {
        result:
          'Nothing has been started, so there is no status to show and no card to ' +
          'draw. Do not use this card to stand in for a plan or a summary: say in ' +
          'words where things are, and ask for what is still needed.',
        refused: true,
      }
    }

    const card: Card = {
      type: 'status',
      applications: loaded.applications.map((application) => {
        const match = digest.applications.find((a) => a.id === application.id)
        const evaluation = evaluateFor(loaded, application)

        // Journey order, not satisfied-then-outstanding: the customer reads this as
        // a path through the application, and reordering it as things complete
        // would make the same card look different for no reason. A checked
        // document says so on its step.
        const steps = [...statusSteps(evaluation)]

        return {
          id: String(application.id),
          product: application.product,
          displayName: applicationName(application, nameFor),
          state: application.state,
          stateLabel: stateLabel(application.state),
          outstandingCount: match?.outstanding.length ?? 0,
          waitingOn: match?.waitingOn ?? null,
          steps,
        }
      }),
    }
    return {
      result:
        'Status card shown, rendered from the case. Say one line about where things ' +
        'stand — what just moved, or what is next. A card on its own, with nothing ' +
        'said, reads as the conversation having dropped.',
      card,
    }
  },
}
