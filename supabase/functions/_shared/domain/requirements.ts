import {
  factCatalogue,
  type ApplicationId,
  type Fact,
  type FactKey,
  type FactSubject,
  type ParticipantId,
  type ParticipantRole,
  type ReusePolicy,
} from './facts.ts'
import type { Branch, FactReader, Journey, Requirement, RequirementSubject } from './journey.ts'
import type { AccountEvidence } from './open-banking/evidence.ts'
export type { AccountEvidence }

/**
 * What does this application still require?
 *
 * This is computed from facts every time, never remembered by the model (Invariant 3, §8).
 * The model decides only how to ask.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type RequirementContext = {
  readonly applicationId: ApplicationId
  /** `partner` is null until a second applicant has actually joined. */
  readonly participants: {
    readonly primary: ParticipantId
    readonly partner: ParticipantId | null
  }
  /** Every fact on the case. Superseded facts are ignored. */
  readonly facts: readonly Fact[]
  /**
   * Requirement ids confirmed for THIS application: reuse confirmations, declarations and
   * customer confirmations. Scoping is per application, so a declaration signed for the
   * mortgage does not satisfy the credit card.
   */
  readonly confirmations: readonly string[]
  readonly documents: readonly { readonly requirementId: string; readonly verified: boolean }[]
  /**
   * What the customer's linked accounts show, when they have linked any (open banking,
   * simulated). A payslip is asked for to see a salary arriving, and a statement to see how
   * money moves; ninety days of booked transactions show both, so a document requirement can
   * be met by the data without anything being uploaded. Absent on most cases.
   */
  readonly accountEvidence?: AccountEvidence
}

/** Two payslips is what the bank asks for, so two months of pay seen arriving is the bar. */
const PAYSLIP_MONTHS_OBSERVED = 2
/** A statement covers a period; sixty days of history covers the two-month version of it. */
const STATEMENT_DAYS_OBSERVED = 60

/**
 * Whether what the linked accounts show stands in for a document the journey asks for.
 *
 * Only a payslip or a statement, because those are what the data is: pay arriving and money
 * moving. Photo ID and proof of address are not in a transaction feed, and the bank's own
 * post-submission requests are asked for by people who have already seen the data.
 */
export function evidenceCovers(
  requirement: Extract<Requirement, { kind: 'document' }>,
  evidence: AccountEvidence | undefined,
): boolean {
  if (evidence === undefined) return false
  switch (requirement.documentType) {
    case 'payslip':
      return (
        evidence.salaryObserved !== null &&
        evidence.salaryObserved.months >= PAYSLIP_MONTHS_OBSERVED
      )
    case 'bank_statement':
      return evidence.daysOfHistory >= STATEMENT_DAYS_OBSERVED
    case 'photo_id':
    case 'proof_of_address':
    case 'salary_certificate':
    case 'bank_request':
      return false
  }
}

export type OutstandingReason =
  /** Nothing known at all. */
  | 'missing'
  /** Known from elsewhere; the customer must confirm it is still right. */
  | 'needs_confirmation'
  /** Known from elsewhere, but this journey demands a fresh answer. */
  | 'needs_fresh'
  | 'awaiting_document'
  /** Sent in, but it needs checking before it counts. */
  | 'awaiting_verification'
  | 'awaiting_declaration'
  /** Belongs to a partner who has not joined yet. */
  | 'awaiting_partner'

export type OutstandingItem = {
  readonly requirement: Requirement
  readonly reason: OutstandingReason
  /** Who must act. Household requirements are supplied by the primary customer. */
  readonly waitingOn: ParticipantRole
  /** Optional requirements appear here but never hold an application back. */
  readonly blocking: boolean
  /** The value being offered for confirmation, when `reason` is `needs_confirmation`. */
  readonly knownFact: Fact | null
  /**
   * The open `application_requests` row behind a document the bank asked for after submission
   * (`bank-requests.ts`). Absent for everything the journey itself requires.
   */
  readonly requestId?: string
}

export type SatisfiedItem = {
  readonly requirement: Requirement
  readonly fact: Fact | null
  /**
   * True when this was satisfied without asking inside this application — bank-held, or
   * captured for another application or in general conversation. Drives §53.
   */
  readonly reused: boolean
  /**
   * The document that satisfied a `document` requirement, so a card can say it was checked
   * rather than only received. Absent for everything else.
   */
  readonly document?: { readonly verified: boolean }
  /**
   * `account_data` when a document requirement was met by what the customer's linked accounts
   * show rather than by an upload, so a card can say "seen in your linked account" and the
   * §53 record can say what was never sent in. Absent for everything else.
   */
  readonly reason?: 'account_data'
}

export type JourneyEvaluation = {
  readonly outstanding: readonly OutstandingItem[]
  readonly satisfied: readonly SatisfiedItem[]
  /** No blocking requirement remains. */
  readonly complete: boolean
  readonly waitingOn: ParticipantRole | null
  /** Branch ids whose condition currently holds, for the admin inspector. */
  readonly activeBranches: readonly string[]
}

// ---------------------------------------------------------------------------
// Reuse policy
// ---------------------------------------------------------------------------

const STRICTNESS: Record<ReusePolicy, number> = { auto: 0, confirm: 1, fresh: 2, never: 3 }

/**
 * A journey requirement may tighten the catalogue's policy but never loosen it: the stricter
 * of the two wins. Health data marked `never` in the catalogue stays `never` however a
 * journey asks for it (§11, Invariant 6).
 */
export function effectiveReusePolicy(
  catalogueDefault: ReusePolicy,
  override: ReusePolicy | undefined,
): ReusePolicy {
  if (override === undefined) return catalogueDefault
  return STRICTNESS[override] > STRICTNESS[catalogueDefault] ? override : catalogueDefault
}

// ---------------------------------------------------------------------------
// Subject resolution
// ---------------------------------------------------------------------------

/** Who must act for a requirement. Household information comes from the primary customer. */
function actorFor(subject: RequirementSubject): ParticipantRole {
  return subject === 'partner' ? 'partner' : 'primary'
}

/**
 * Turns a journey's role into the subject a fact is actually stored against. Returns null
 * when the role has no participant yet.
 */
function resolveFactSubject(
  subject: RequirementSubject,
  participants: RequirementContext['participants'],
): FactSubject | null {
  switch (subject) {
    case 'household':
      return 'household'
    case 'primary':
      return participants.primary
    case 'partner':
      return participants.partner
  }
}

// ---------------------------------------------------------------------------
// Fact lookup
// ---------------------------------------------------------------------------

type FactMatch = {
  /** Captured inside this application: the customer was asked here. */
  readonly local: Fact | null
  /** Known from bank records, general conversation, or another application. */
  readonly elsewhere: Fact | null
}

function newer(a: Fact | null, b: Fact): Fact {
  if (!a) return b
  return b.capturedAt >= a.capturedAt ? b : a
}

function findFact(
  facts: readonly Fact[],
  key: FactKey,
  subject: FactSubject,
  applicationId: ApplicationId,
): FactMatch {
  let local: Fact | null = null
  let elsewhere: Fact | null = null

  for (const fact of facts) {
    if (fact.key !== key) continue
    if (fact.subject !== subject) continue
    if (fact.supersededBy !== null) continue

    if (fact.capturedFor === applicationId) local = newer(local, fact)
    else elsewhere = newer(elsewhere, fact)
  }

  return { local, elsewhere }
}

// ---------------------------------------------------------------------------
// Branch evaluation
// ---------------------------------------------------------------------------

/**
 * Reads the case's facts by key and subject, newest first, ignoring superseded ones.
 *
 * Exported because the needs engine reads the same facts through the same rules — two readers
 * disagreeing about what the case says would be worse than either being wrong.
 */
export function createFactReader(context: RequirementContext): FactReader {
  const read = (key: FactKey, subject: RequirementSubject = 'household'): Fact | null => {
    const factSubject = resolveFactSubject(subject, context.participants)
    if (factSubject === null) return null
    const { local, elsewhere } = findFact(context.facts, key, factSubject, context.applicationId)
    return local ?? elsewhere
  }

  return {
    has: (key, subject) => read(key, subject) !== null,
    get: (key, subject) => read(key, subject)?.value,
    number: (key, subject) => {
      const value = read(key, subject)?.value
      return typeof value === 'number' ? value : null
    },
    boolean: (key, subject) => {
      const value = read(key, subject)?.value
      return typeof value === 'boolean' ? value : null
    },
  }
}

function activeBranches(journey: Journey, context: RequirementContext): readonly Branch[] {
  const reader = createFactReader(context)
  const confirmed = (requirementId: string): boolean =>
    context.confirmations.includes(requirementId)
  return journey.branches.filter((branch) => branch.when(reader, confirmed))
}

// ---------------------------------------------------------------------------
// Requirement evaluation
// ---------------------------------------------------------------------------

type Verdict =
  | {
      readonly status: 'satisfied'
      readonly fact: Fact | null
      readonly reused: boolean
      readonly document?: { readonly verified: boolean }
      readonly reason?: 'account_data'
    }
  | {
      readonly status: 'outstanding'
      readonly reason: OutstandingReason
      readonly knownFact: Fact | null
    }

const missing = (): Verdict => ({ status: 'outstanding', reason: 'missing', knownFact: null })

function evaluateFactRequirement(
  requirement: Extract<Requirement, { kind: 'fact' }>,
  context: RequirementContext,
  factSubject: FactSubject,
): Verdict {
  const policy = effectiveReusePolicy(factCatalogue[requirement.fact].reuse, requirement.reuse)
  const { local, elsewhere } = findFact(
    context.facts,
    requirement.fact,
    factSubject,
    context.applicationId,
  )

  // Asked and answered inside this application: satisfied under every policy.
  if (local) return { status: 'satisfied', fact: local, reused: false }

  switch (policy) {
    case 'auto':
      return elsewhere ? { status: 'satisfied', fact: elsewhere, reused: true } : missing()

    case 'confirm':
      if (!elsewhere) return missing()
      return context.confirmations.includes(requirement.id)
        ? { status: 'satisfied', fact: elsewhere, reused: true }
        : { status: 'outstanding', reason: 'needs_confirmation', knownFact: elsewhere }

    case 'fresh':
    case 'never':
      return elsewhere
        ? { status: 'outstanding', reason: 'needs_fresh', knownFact: null }
        : missing()
  }
}

function evaluateRequirement(requirement: Requirement, context: RequirementContext): Verdict {
  const factSubject = resolveFactSubject(requirement.subject, context.participants)

  // The requirement belongs to a partner who has not joined yet.
  if (factSubject === null) {
    return { status: 'outstanding', reason: 'awaiting_partner', knownFact: null }
  }

  switch (requirement.kind) {
    case 'fact':
      return evaluateFactRequirement(requirement, context, factSubject)

    case 'declaration':
      return context.confirmations.includes(requirement.id)
        ? { status: 'satisfied', fact: null, reused: false }
        : { status: 'outstanding', reason: 'awaiting_declaration', knownFact: null }

    case 'confirmation':
      return context.confirmations.includes(requirement.id)
        ? { status: 'satisfied', fact: null, reused: false }
        : { status: 'outstanding', reason: 'needs_confirmation', knownFact: null }

    case 'document': {
      const document = context.documents.find((d) => d.requirementId === requirement.id)
      if (document === undefined) {
        // Nothing uploaded, but the linked accounts may already show what the document would.
        // Reused, because it was satisfied without the customer being asked for it (§53).
        if (evidenceCovers(requirement, context.accountEvidence)) {
          return { status: 'satisfied', fact: null, reused: true, reason: 'account_data' }
        }
        return { status: 'outstanding', reason: 'awaiting_document', knownFact: null }
      }

      if (requirement.requiresVerification === true && !document.verified) {
        // Received but unchecked. Told apart from "never arrived" because otherwise the
        // customer uploads a payslip and is then told it did not come through.
        return { status: 'outstanding', reason: 'awaiting_verification', knownFact: null }
      }

      // Which document did it is carried along, so what is shown can say "checked" once the
      // bank has looked at it rather than only that it arrived (§41).
      return {
        status: 'satisfied',
        fact: null,
        reused: false,
        document: { verified: document.verified },
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Every requirement that currently applies, base plus any active branch. */
export function applicableRequirements(
  journey: Journey,
  context: RequirementContext,
): readonly Requirement[] {
  return [
    ...journey.requirements,
    ...activeBranches(journey, context).flatMap((branch) => branch.requirements),
  ]
}

export function evaluateJourney(journey: Journey, context: RequirementContext): JourneyEvaluation {
  const branches = activeBranches(journey, context)
  const requirements = [
    ...journey.requirements,
    ...branches.flatMap((branch) => branch.requirements),
  ]

  const outstandingItems: OutstandingItem[] = []
  const satisfiedItems: SatisfiedItem[] = []

  for (const requirement of requirements) {
    const verdict = evaluateRequirement(requirement, context)

    if (verdict.status === 'satisfied') {
      satisfiedItems.push({
        requirement,
        fact: verdict.fact,
        reused: verdict.reused,
        ...(verdict.document === undefined ? {} : { document: verdict.document }),
        ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
      })
      continue
    }

    outstandingItems.push({
      requirement,
      reason: verdict.reason,
      waitingOn: actorFor(requirement.subject),
      blocking: requirement.optional !== true,
      knownFact: verdict.knownFact,
    })
  }

  const blocking = outstandingItems.filter((item) => item.blocking)

  // The customer comes first: only wait on the partner once the customer has nothing to do.
  const waitingOn: ParticipantRole | null = blocking.some((item) => item.waitingOn === 'primary')
    ? 'primary'
    : blocking.some((item) => item.waitingOn === 'partner')
      ? 'partner'
      : null

  return {
    outstanding: outstandingItems,
    satisfied: satisfiedItems,
    complete: blocking.length === 0,
    waitingOn,
    activeBranches: branches.map((branch) => branch.id),
  }
}

/** `outstanding(journey, facts)` — the form referenced by CLAUDE.md and §8. */
export function outstanding(
  journey: Journey,
  context: RequirementContext,
): readonly OutstandingItem[] {
  return evaluateJourney(journey, context).outstanding
}

/**
 * Whether an application has everything except the things the customer confirms at the end.
 *
 * Declarations, consents and reuse confirmations are blocking requirements, so an application
 * can never be `complete` while they are outstanding — which would mean the review card could
 * never be shown, and §48 says the review card is exactly where those are made. This is the
 * state that means "ready to put in front of the customer".
 */
export function readyForReview(evaluation: JourneyEvaluation): boolean {
  return evaluation.outstanding
    .filter((item) => item.blocking)
    .every((item) => isCustomerConfirmation(item))
}

/** The items a review card asks the customer to agree to before anything is submitted. */
export function confirmationsForReview(evaluation: JourneyEvaluation): readonly OutstandingItem[] {
  return evaluation.outstanding.filter((item) => item.blocking && isCustomerConfirmation(item))
}

function isCustomerConfirmation(item: OutstandingItem): boolean {
  if (item.requirement.kind === 'declaration') return true
  if (item.requirement.kind === 'confirmation') return true
  // A value we already hold, which the customer is asked to confirm is still right (§11).
  return item.reason === 'needs_confirmation'
}
