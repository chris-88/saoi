import { asApplicationId } from '@shared/domain/facts.ts'
import type { Product } from '@shared/domain/journey.ts'
import {
  transition,
  type ApplicationState,
  type TransitionEvent,
} from '@shared/domain/state-machine.ts'

/** With the bank and not yet decided: the only time anyone there is checking documents. */
export function underAssessment(state: string): boolean {
  return state === 'submitted' || state === 'under_review' || state === 'info_required'
}

/**
 * What each one-click move means, in transitions.
 *
 * A sequence rather than one step, because "approved" from the presenter's point of view means
 * submitted, received, assessed: three transitions the machine insists on in order.
 */
export const DEMO_MOVES: Record<
  string,
  { product: string; label: string; steps: readonly string[]; note: string }
> = {
  credit_card_approved: {
    product: 'credit_card',
    label: 'Credit card approved',
    steps: ['received_by_bank', 'assessment_approved'],
    note: 'Takes the submitted card through assessment to approved.',
  },
  joint_account_approved: {
    product: 'joint_account',
    label: 'Joint account approved',
    steps: ['received_by_bank', 'assessment_approved'],
    note: 'Takes the submitted joint account through to approved.',
  },
  mortgage_to_assessment: {
    product: 'mortgage',
    label: 'Mortgage moved to assessment',
    steps: ['received_by_bank'],
    note: 'Moves the submitted mortgage into assessment.',
  },
  mortgage_requests_document: {
    product: 'mortgage',
    label: 'Mortgage requests a document',
    steps: ['information_requested'],
    note: 'The mortgage team asks for one more payslip.',
  },
  protection_approved: {
    product: 'protection',
    label: 'Protection approved',
    steps: ['received_by_bank', 'assessment_approved'],
    note: 'Takes the submitted protection through to approved.',
  },
}

/**
 * Which hand-moves are possible on a case right now, and why not when they are not.
 *
 * Shared, because the case list and the case itself both offer them and a button that is live
 * on one screen and dead on the other is worse than no button. Each is checked against the
 * state machine rather than guessed, so nothing fails in front of anybody (§41).
 */
export function movesFor(
  applications: readonly { id: string; product: string; state: string; resume_to: string | null }[],
): readonly { id: string; label: string; available: boolean; note: string }[] {
  return Object.entries(DEMO_MOVES).map(([id, move]) => {
    const application = applications.find((candidate) => candidate.product === move.product)

    if (!application) {
      return {
        id,
        label: move.label,
        available: false,
        note: `No ${move.product.replaceAll('_', ' ')} on the case yet.`,
      }
    }

    const first = move.steps[0]
    const possible = transition(
      {
        id: asApplicationId(application.id),
        product: application.product as Product,
        state: application.state as ApplicationState,
        resumeTo: application.resume_to as ApplicationState | null,
      },
      { type: first } as TransitionEvent,
    ).ok

    return {
      id,
      label: move.label,
      available: possible,
      note: possible ? move.note : `Not possible from "${application.state}".`,
    }
  })
}
