import { describe, expect, it } from 'vitest'
import { asApplicationId } from './facts.ts'
import {
  APPLICATION_STATES,
  transition,
  type Application,
  type ApplicationState,
  type TransitionEvent,
} from './state-machine.ts'

const app = (state: ApplicationState, resumeTo: ApplicationState | null = null): Application => ({
  id: asApplicationId('app-1'),
  product: 'personal_loan',
  state,
  resumeTo,
})

/** One representative event per type, for the exhaustive rejection sweep. */
const EVENTS = {
  requirements_changed: { type: 'requirements_changed', complete: false, waitingOn: 'primary' },
  submission_confirmed: { type: 'submission_confirmed' },
  received_by_bank: { type: 'received_by_bank' },
  information_requested: { type: 'information_requested' },
  information_supplied: { type: 'information_supplied' },
  assessment_approved: { type: 'assessment_approved' },
  assessment_declined: { type: 'assessment_declined' },
  paused: { type: 'paused' },
  resumed: { type: 'resumed' },
  completed: { type: 'completed' },
} as const satisfies Record<TransitionEvent['type'], TransitionEvent>

type EventType = keyof typeof EVENTS

/** The whole transition table, as the specification describes it (§13). */
const LEGAL: Record<ApplicationState, readonly EventType[]> = {
  not_started: ['requirements_changed'],
  in_progress: ['requirements_changed', 'paused'],
  waiting_customer: ['requirements_changed', 'paused'],
  waiting_partner: ['requirements_changed', 'paused'],
  ready: ['requirements_changed', 'submission_confirmed', 'paused'],
  submitted: ['received_by_bank'],
  under_review: ['information_requested', 'assessment_approved', 'assessment_declined'],
  info_required: ['information_supplied'],
  approved: ['completed'],
  declined: [],
  paused: ['resumed'],
  completed: [],
}

describe('the transition table', () => {
  it('covers every state in §13', () => {
    expect(APPLICATION_STATES).toHaveLength(12)
    expect(Object.keys(LEGAL).sort()).toEqual([...APPLICATION_STATES].sort())
  })

  it('rejects every transition the table does not permit', () => {
    const rejected: string[] = []

    for (const state of APPLICATION_STATES) {
      for (const eventType of Object.keys(EVENTS) as EventType[]) {
        if (LEGAL[state].includes(eventType)) continue

        const result = transition(
          app(state, state === 'paused' ? 'in_progress' : null),
          EVENTS[eventType],
        )
        if (result.ok) rejected.push(`${state} + ${eventType} was allowed`)
      }
    }

    expect(rejected).toEqual([])
  })

  it('permits every transition the table does contain', () => {
    const failures: string[] = []

    for (const state of APPLICATION_STATES) {
      for (const eventType of LEGAL[state]) {
        const result = transition(
          app(state, state === 'paused' ? 'in_progress' : null),
          EVENTS[eventType],
        )
        if (!result.ok) failures.push(`${state} + ${eventType}: ${result.error.code}`)
      }
    }

    expect(failures).toEqual([])
  })
})

describe('requirements_changed', () => {
  it('moves to ready when nothing blocking remains', () => {
    const result = transition(app('in_progress'), {
      type: 'requirements_changed',
      complete: true,
      waitingOn: null,
    })

    expect(result.ok && result.application.state).toBe('ready')
  })

  it('moves to waiting_partner when only the partner has work left', () => {
    const result = transition(app('in_progress'), {
      type: 'requirements_changed',
      complete: false,
      waitingOn: 'partner',
    })

    expect(result.ok && result.application.state).toBe('waiting_partner')
  })

  it('moves to in_progress while the customer is in the conversation', () => {
    const result = transition(app('waiting_customer'), {
      type: 'requirements_changed',
      complete: false,
      waitingOn: 'primary',
      activeInConversation: true,
    })

    expect(result.ok && result.application.state).toBe('in_progress')
  })

  it('moves to waiting_customer when the customer has work left but has moved on', () => {
    const result = transition(app('in_progress'), {
      type: 'requirements_changed',
      complete: false,
      waitingOn: 'primary',
      activeInConversation: false,
    })

    expect(result.ok && result.application.state).toBe('waiting_customer')
  })

  it('can take a ready application back to in_progress if a requirement reappears', () => {
    const result = transition(app('ready'), {
      type: 'requirements_changed',
      complete: false,
      waitingOn: 'primary',
    })

    expect(result.ok && result.application.state).toBe('in_progress')
  })
})

describe('submission', () => {
  it('only a ready application can be submitted', () => {
    expect(transition(app('ready'), { type: 'submission_confirmed' }).ok).toBe(true)

    for (const state of APPLICATION_STATES.filter((s) => s !== 'ready')) {
      const result = transition(app(state, 'in_progress'), { type: 'submission_confirmed' })
      expect(result.ok, `${state} must not be submittable`).toBe(false)
    }
  })

  it('runs the full post-submission path', () => {
    let current = app('ready')
    for (const event of [
      { type: 'submission_confirmed' },
      { type: 'received_by_bank' },
      { type: 'information_requested' },
      { type: 'information_supplied' },
      { type: 'assessment_approved' },
      { type: 'completed' },
    ] satisfies TransitionEvent[]) {
      const result = transition(current, event)
      expect(result.ok, `${current.state} + ${event.type}`).toBe(true)
      if (result.ok) current = result.application
    }

    expect(current.state).toBe('completed')
  })

  it('can decline under review', () => {
    const result = transition(app('under_review'), { type: 'assessment_declined' })
    expect(result.ok && result.application.state).toBe('declined')
  })
})

describe('pause and resume', () => {
  it('records the state to resume to', () => {
    const result = transition(app('ready'), { type: 'paused' })

    expect(result.ok && result.application.state).toBe('paused')
    expect(result.ok && result.application.resumeTo).toBe('ready')
  })

  it('resumes to the recorded state', () => {
    const paused = transition(app('waiting_partner'), { type: 'paused' })
    expect(paused.ok).toBe(true)
    if (!paused.ok) return

    const resumed = transition(paused.application, { type: 'resumed' })
    expect(resumed.ok && resumed.application.state).toBe('waiting_partner')
    expect(resumed.ok && resumed.application.resumeTo).toBeNull()
  })

  it('refuses to resume a paused application with no recorded state', () => {
    const result = transition(app('paused', null), { type: 'resumed' })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('missing_resume_state')
  })

  it('cannot pause an application that has not started', () => {
    expect(transition(app('not_started'), { type: 'paused' }).ok).toBe(false)
  })

  it('cannot pause an application already with the bank', () => {
    for (const state of ['submitted', 'under_review', 'info_required', 'approved'] as const) {
      expect(transition(app(state), { type: 'paused' }).ok, state).toBe(false)
    }
  })
})

describe('purity', () => {
  it('never mutates the application it is given', () => {
    const original = app('ready')
    const snapshot = { ...original }

    transition(original, { type: 'paused' })

    expect(original).toEqual(snapshot)
  })

  it('reports no change when the computed state is the same', () => {
    const result = transition(app('waiting_partner'), {
      type: 'requirements_changed',
      complete: false,
      waitingOn: 'partner',
    })

    expect(result.ok && result.changed).toBe(false)
  })
})
