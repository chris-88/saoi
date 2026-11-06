import type { TurnTiming } from '../domain/cost.ts'
import type { CaseKind } from '../domain/case.ts'
import type { ApplicationId, Fact, ParticipantId, ParticipantRole } from '../domain/facts.ts'
import type { Product } from '../domain/journey.ts'
import type { Application } from '../domain/state-machine.ts'
import type { PersonaSliders } from '../llm/persona.ts'
import type { CatalogueOverride } from '../domain/catalogue/overlay.ts'
import type { GoalBlueprint } from '../domain/goals/types.ts'
import type { NeedDefinition } from '../domain/needs/types.ts'

/**
 * Everything a turn needs, loaded once and then used purely.
 *
 * Deliberately free of Deno and of the Supabase client: the repository fills this in, and
 * everything downstream — the digest, the requirement engine, the advisories — is a pure
 * function of it, so a turn can be reasoned about and tested without a database.
 */

export type LoadedParticipant = {
  readonly id: ParticipantId
  readonly role: ParticipantRole
  readonly displayName: string | null
}

export type LoadedConfirmation = {
  readonly applicationId: ApplicationId
  readonly requirementId: string
}

export type LoadedDocument = {
  readonly applicationId: ApplicationId
  readonly requirementId: string
  readonly verified: boolean
}

export type LoadedRequest = {
  readonly id: string
  readonly applicationId: ApplicationId
  readonly requirementId: string
  readonly status: 'open' | 'fulfilled' | 'cancelled'
  readonly detail: string | null
}

export type LoadedProductInterest = {
  readonly product: Product
  readonly status: 'offered' | 'accepted' | 'declined' | 'deferred'
  readonly reason: string | null
}

export type LoadedLinkedTransaction = {
  readonly bookedOn: string
  /** Negative is money out. */
  readonly amount: number
  readonly description: string
  readonly category: string
}

export type LoadedLinkedAccount = {
  readonly id: string
  readonly bank: string
  readonly displayName: string
  readonly accountType: 'current' | 'savings'
  readonly iban: string
  readonly balance: number
  readonly consentScope: readonly string[]
  readonly consentExpiresAt: string
  readonly createdAt: string
  /** Newest first. */
  readonly transactions: readonly LoadedLinkedTransaction[]
}

export type LoadedTransfer = {
  readonly id: string
  readonly fromAccountId: string
  readonly toApplicationId: string | null
  readonly toLabel: string
  readonly amount: number
  readonly cadence: 'once' | 'monthly'
  readonly state: 'initiated' | 'settled' | 'failed'
  readonly createdAt: string
}

export type LoadedMessage = {
  readonly role: 'customer' | 'assistant' | 'system'
  readonly content: string
  /** Types of the cards rendered with this turn, oldest first. */
  readonly cards: readonly string[]
  readonly createdAt: string
  /** Where the turn's time went, on Saoirse's turns that were measured. */
  readonly timing: TurnTiming | null
}

export type LoadedEvent = {
  readonly type: string
  readonly createdAt: string
  readonly payload: Record<string, unknown>
}

export type LoadedFormApplication = {
  readonly id: string
  /** The bank's form id, e.g. "1940". */
  readonly formId: string
  /** Keyed by the definition's own field ids. */
  readonly answers: Readonly<Record<string, unknown>>
}

export type LoadedCase = {
  readonly caseId: string
  readonly kind: CaseKind
  readonly authLevel: 'anonymous' | 'authenticated'
  readonly customerName: string | null
  readonly lastSeenAt: string | null

  readonly participants: readonly LoadedParticipant[]
  readonly facts: readonly Fact[]
  readonly applications: readonly Application[]
  readonly confirmations: readonly LoadedConfirmation[]
  readonly documents: readonly LoadedDocument[]
  readonly requests: readonly LoadedRequest[]
  readonly productInterests: readonly LoadedProductInterest[]
  /**
   * Applications against the bank's own digital forms, with what has been collected so far.
   *
   * Here rather than fetched where it is needed, because the digest reads it on every turn:
   * what a form still wants is part of what Saoirse knows about a case.
   */
  readonly formApplications: readonly LoadedFormApplication[]

  /**
   * Open banking, simulated: accounts linked under a consent that has not been revoked, with
   * their transactions, and the transfers initiated from them. Empty on most cases.
   */
  readonly linkedAccounts: readonly LoadedLinkedAccount[]
  readonly transfers: readonly LoadedTransfer[]

  /** Oldest first. Only the tail is sent to the model. */
  readonly messages: readonly LoadedMessage[]
  readonly eventsSinceLastSeen: readonly LoadedEvent[]

  readonly persona: PersonaSliders
  readonly killSwitch: boolean

  /** The admin's prose edits, as rows. The console shows these; nothing else needs them. */
  readonly overrides: readonly CatalogueOverride[]
  /**
   * The catalogues actually in force, with `overrides` already applied.
   *
   * Everything downstream reads these rather than importing the module constants, so a disabled
   * goal is a goal the engines never hear about (plan §3.2, `domain/catalogue/overlay.ts`).
   */
  readonly goals: readonly GoalBlueprint[]
  readonly needs: readonly NeedDefinition[]
}

export function participantFor(
  loaded: Pick<LoadedCase, 'participants'>,
  role: ParticipantRole,
): ParticipantId | null {
  return loaded.participants.find((participant) => participant.role === role)?.id ?? null
}

/** The previous Saoirse turn, which the gate needs so short answers classify correctly. */
export function previousAssistantTurn(loaded: Pick<LoadedCase, 'messages'>): string | undefined {
  for (let index = loaded.messages.length - 1; index >= 0; index -= 1) {
    const message = loaded.messages[index]
    if (message?.role === 'assistant') return message.content
  }
  return undefined
}
