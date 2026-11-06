import type { ApplicationId, ParticipantRole } from './facts.ts'
import type { Product } from './journey.ts'

/**
 * Application state (§13) and the only route between states (§14, Invariant 2).
 *
 * Every state change goes through `transition`, which is called from Edge Functions.
 * Clients cannot update `applications`, and the model has no tool that moves state.
 */

export const APPLICATION_STATES = [
  'not_started',
  'in_progress',
  'waiting_customer',
  'waiting_partner',
  'ready',
  'submitted',
  'under_review',
  'info_required',
  'approved',
  'declined',
  'paused',
  'completed',
] as const

export type ApplicationState = (typeof APPLICATION_STATES)[number]

export type Application = {
  readonly id: ApplicationId
  readonly product: Product
  /**
   * Which catalogue product, where the kind alone does not say.
   *
   * `product` chooses the journey; nine savings products share one. Null for applications
   * started before the catalogue was wired in, and for journeys with no specific product
   * behind them.
   */
  readonly catalogueId?: string | null
  /**
   * What the customer saw it called when they started it, e.g. "SuperSaver".
   *
   * Written once at creation from the tenant's catalogue, so the name survives into a layer
   * that cannot look the catalogue up (Invariant 11). Null for applications created before
   * the column existed; they are called what the journey is called.
   */
  readonly displayName?: string | null
  readonly state: ApplicationState
  /** Where `resumed` returns to. Non-null only while `paused`. */
  readonly resumeTo: ApplicationState | null
}

/**
 * States in which the customer is still assembling the application. These are the only
 * states the requirement engine may recompute, and the only ones that can be paused.
 */
const PRE_SUBMISSION = [
  'not_started',
  'in_progress',
  'waiting_customer',
  'waiting_partner',
  'ready',
] as const satisfies readonly ApplicationState[]

type PreSubmissionState = (typeof PRE_SUBMISSION)[number]

function isPreSubmission(state: ApplicationState): state is PreSubmissionState {
  return (PRE_SUBMISSION as readonly ApplicationState[]).includes(state)
}

/** Pausing a not-yet-started application means nothing, so it is excluded. */
const PAUSABLE = ['in_progress', 'waiting_customer', 'waiting_partner', 'ready'] as const

export type TransitionEvent =
  /**
   * The requirement engine has recomputed. The resulting state is derived, never chosen by
   * the model or the client (Invariant 3).
   */
  | {
      readonly type: 'requirements_changed'
      readonly complete: boolean
      readonly waitingOn: ParticipantRole | null
      /**
       * Whether the customer is working on this application right now. Distinguishes
       * `in_progress` from `waiting_customer`. Defaults to true.
       */
      readonly activeInConversation?: boolean
    }
  /** The customer confirmed submission from the review card. The only way out of `ready`. */
  | { readonly type: 'submission_confirmed' }
  | { readonly type: 'received_by_bank' }
  | { readonly type: 'information_requested' }
  | { readonly type: 'information_supplied' }
  | { readonly type: 'assessment_approved' }
  | { readonly type: 'assessment_declined' }
  | { readonly type: 'paused' }
  | { readonly type: 'resumed' }
  | { readonly type: 'completed' }

export type TransitionErrorCode = 'illegal_transition' | 'missing_resume_state'

export type TransitionResult =
  | {
      readonly ok: true
      readonly application: Application
      /** False when the event was legal but produced the same state. */
      readonly changed: boolean
    }
  | {
      readonly ok: false
      readonly error: { readonly code: TransitionErrorCode; readonly message: string }
    }

function illegal(state: ApplicationState, event: TransitionEvent): TransitionResult {
  return {
    ok: false,
    error: {
      code: 'illegal_transition',
      message: `An application in "${state}" cannot handle "${event.type}".`,
    },
  }
}

function settle(
  application: Application,
  state: ApplicationState,
  resumeTo: ApplicationState | null = null,
): TransitionResult {
  return {
    ok: true,
    application: { ...application, state, resumeTo },
    changed: application.state !== state || application.resumeTo !== resumeTo,
  }
}

/** Derives the pre-submission state from the requirement engine's verdict. */
function stateFromRequirements(
  event: Extract<TransitionEvent, { type: 'requirements_changed' }>,
): ApplicationState {
  if (event.complete) return 'ready'
  if (event.waitingOn === 'partner') return 'waiting_partner'
  return event.activeInConversation === false ? 'waiting_customer' : 'in_progress'
}

/**
 * The only path to a state change. Pure: it returns a new application and never mutates
 * the one it is given.
 */
export function transition(application: Application, event: TransitionEvent): TransitionResult {
  const { state } = application

  switch (event.type) {
    case 'requirements_changed':
      if (!isPreSubmission(state)) return illegal(state, event)
      return settle(application, stateFromRequirements(event))

    case 'submission_confirmed':
      // §48, Invariant 1: only a ready application, and only on the customer's confirmation.
      if (state !== 'ready') return illegal(state, event)
      return settle(application, 'submitted')

    case 'received_by_bank':
      if (state !== 'submitted') return illegal(state, event)
      return settle(application, 'under_review')

    case 'information_requested':
      if (state !== 'under_review') return illegal(state, event)
      return settle(application, 'info_required')

    case 'information_supplied':
      if (state !== 'info_required') return illegal(state, event)
      return settle(application, 'under_review')

    case 'assessment_approved':
      if (state !== 'under_review') return illegal(state, event)
      return settle(application, 'approved')

    case 'assessment_declined':
      if (state !== 'under_review') return illegal(state, event)
      return settle(application, 'declined')

    case 'paused':
      if (!(PAUSABLE as readonly ApplicationState[]).includes(state)) return illegal(state, event)
      return settle(application, 'paused', state)

    case 'resumed': {
      if (state !== 'paused') return illegal(state, event)
      if (application.resumeTo === null) {
        return {
          ok: false,
          error: {
            code: 'missing_resume_state',
            message: 'A paused application has no state to resume to.',
          },
        }
      }
      return settle(application, application.resumeTo)
    }

    case 'completed':
      if (state !== 'approved') return illegal(state, event)
      return settle(application, 'completed')
  }
}

// ---------------------------------------------------------------------------
// Presentation helpers (state is reported from here, never from model text)
// ---------------------------------------------------------------------------

/** Whether the bank now holds the application. */
export function isWithBank(state: ApplicationState): boolean {
  return (
    state === 'submitted' ||
    state === 'under_review' ||
    state === 'info_required' ||
    state === 'approved' ||
    state === 'declined' ||
    state === 'completed'
  )
}

export function isTerminal(state: ApplicationState): boolean {
  return state === 'declined' || state === 'completed'
}

/** Plain-language state labels for the status card (§14, §59). */
const STATE_LABELS: Record<ApplicationState, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  waiting_customer: 'Waiting for you',
  waiting_partner: 'Waiting for your partner',
  ready: 'Ready to submit',
  submitted: 'Submitted',
  under_review: 'Being assessed',
  info_required: 'More information needed',
  approved: 'Approved',
  declined: 'Not approved',
  paused: 'Paused',
  completed: 'Complete',
}

export function stateLabel(state: ApplicationState): string {
  return STATE_LABELS[state]
}
