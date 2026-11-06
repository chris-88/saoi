import type { LoadedCase } from '@shared/db/loaded-case.ts'
import type { ApplicationSummary } from '@shared/contracts/case-action.ts'
import { asApplicationId, asParticipantId } from '@shared/domain/facts.ts'
import type { Product } from '@shared/domain/journey.ts'
import type { Application, ApplicationState } from '@shared/domain/state-machine.ts'
import { PRESETS } from '@shared/llm/persona.ts'
import type { CaseActionStore, PlanRow } from './store/actions.ts'

/** Fakes for the case action routes: an in-memory `CaseActionStore` that records what it is asked. */

export const APP_ID = '88888888-8888-4888-8888-888888888888'
export const PLAN_ID = '99999999-9999-4999-8999-999999999999'
export const LINKED_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const MESSAGE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

export const application = (
  product: Product,
  state: ApplicationState = 'waiting_customer',
  id: string = APP_ID,
): Application => ({
  id: asApplicationId(id),
  product,
  state,
  resumeTo: state === 'paused' ? 'in_progress' : null,
})

/** A case with nothing on it. Override what the test is about. */
export const loadedCase = (caseId: string, over: Partial<LoadedCase> = {}): LoadedCase => ({
  caseId,
  kind: 'customer',
  authLevel: 'anonymous',
  customerName: null,
  lastSeenAt: null,
  participants: [
    { id: asParticipantId('participant-primary'), role: 'primary', displayName: null },
  ],
  facts: [],
  applications: [],
  confirmations: [],
  documents: [],
  requests: [],
  productInterests: [],
  formApplications: [],
  linkedAccounts: [],
  transfers: [],
  messages: [],
  eventsSinceLastSeen: [],
  persona: PRESETS.default,
  killSwitch: false,
  overrides: [],
  goals: [],
  needs: [],
  ...over,
})

export type ActionCall = { readonly name: string; readonly args: unknown }

export type FakeActions = CaseActionStore & {
  readonly calls: ActionCall[]
  /** What `loadForAction` returns; replace it per test. */
  loaded: LoadedCase | null
  plan: PlanRow | null
  submitSucceeds: boolean
  saoirseMessages: Set<string>
  formApplicationRow: { id: string; answers: Record<string, unknown> } | null
  summaries: ApplicationSummary[]
}

export function fakeActions(caseId: string): FakeActions {
  const calls: ActionCall[] = []
  const record = (name: string, args: unknown) => {
    calls.push({ name, args })
  }

  const fake: FakeActions = {
    calls,
    loaded: loadedCase(caseId),
    plan: null,
    submitSucceeds: true,
    saoirseMessages: new Set([MESSAGE_ID]),
    formApplicationRow: null,
    summaries: [],

    loadForAction: () => Promise.resolve(fake.loaded),
    applicationNamer: () => Promise.resolve((product) => product),

    startApplications: (_loaded, choices) => {
      record('startApplications', choices)
      return Promise.resolve({ created: choices, reused: 0 })
    },
    declineProduct: (_caseId, product) => {
      record('declineProduct', product)
      return Promise.resolve()
    },
    confirmRequirement: (input) => {
      record('confirmRequirement', input)
      return Promise.resolve()
    },
    submitApplication: (input) => {
      record('submitApplication', input)
      return Promise.resolve(fake.submitSucceeds)
    },
    changeApplicationState: (input) => {
      record('changeApplicationState', input)
      return Promise.resolve()
    },
    findPlan: () => Promise.resolve(fake.plan),
    savePlanDecision: (input) => {
      record('savePlanDecision', input)
      return Promise.resolve()
    },
    invitePartner: (input) => {
      record('invitePartner', input)
      return Promise.resolve()
    },
    inviteLink: (token) => `https://app.example.test/#/join/${token}`,
    subscribePush: (input) => {
      record('subscribePush', input)
      return Promise.resolve()
    },
    grantConsent: (input) => {
      record('grantConsent', input)
      return Promise.resolve()
    },
    formApplication: () => Promise.resolve(fake.formApplicationRow),
    saveDeclarations: (input) => {
      record('saveDeclarations', input)
      return Promise.resolve()
    },
    saveHealthFacts: (input) => {
      record('saveHealthFacts', input)
      return Promise.resolve()
    },
    saveLinkedAccounts: (input) => {
      record('saveLinkedAccounts', input)
      return Promise.resolve()
    },
    revokeLinkedAccounts: (input) => {
      record('revokeLinkedAccounts', input)
      return Promise.resolve()
    },
    saveTransfer: (input) => {
      record('saveTransfer', input)
      return Promise.resolve('transfer-1')
    },
    saoirseMessageOnCase: (_caseId, messageId) =>
      Promise.resolve(fake.saoirseMessages.has(messageId)),
    saveFeedback: (input) => {
      record('saveFeedback', input)
      return Promise.resolve()
    },
    settle: () => {
      record('settle', null)
      return Promise.resolve(fake.summaries)
    },
  }
  return fake
}

/** The writes a test cares about: everything except the `settle` every action ends with. */
export const writesOf = (fake: FakeActions): ActionCall[] =>
  fake.calls.filter((call) => call.name !== 'settle')
