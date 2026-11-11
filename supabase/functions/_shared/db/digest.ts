import { factCatalogue, type Fact } from '../domain/facts.ts'
import { awaitingCard } from '../domain/conversation/awaiting.ts'
import { caseFactReader } from './fact-reader.ts'
import { describeEvent } from '../domain/narration.ts'
export { NARRATABLE_EVENTS } from '../domain/narration.ts'
export type { NarratableEvent } from '../domain/narration.ts'
import { accountEvidence } from '../domain/open-banking/evidence.ts'
import type { OutstandingItem } from '../domain/requirements.ts'
import { evaluateAdvisories } from '../domain/advisories.ts'
import { stateLabel } from '../domain/state-machine.ts'
import type {
  CaseDigest,
  DigestApplication,
  DigestFact,
  DigestLinkedAccounts,
  DigestNeeds,
} from '../llm/prompt.ts'
import { needContextFor } from './needs.ts'
import { formDigestSection, formDigests } from './form-digest.ts'
import type { Stage } from '../domain/conversation/stages.ts'
import { deferred, evaluateNeeds, nextToClarify, readyToSurface } from '../domain/needs/engine.ts'
import { buildPlan } from '../domain/needs/plan.ts'
import type { DigestPlan } from '../llm/prompt.ts'
import { participantFor, type LoadedCase } from './loaded-case.ts'
import { applicationName, evaluateFor } from './applications.ts'

/**
 * Builds the case digest the model sees (§14, Invariant 2).
 *
 * Every status in it comes from controlled data: application state from the state machine,
 * outstanding requirements from the requirement engine, advisories from the deterministic
 * rules. The model is given no opportunity to remember a status, because nothing here is
 * carried over from a previous turn.
 */

/** Values are rendered for reading, never dumped raw. */
function renderValue(fact: Fact): string {
  const { value } = fact

  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return value.toLocaleString('en-IE')
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function digestFacts(loaded: LoadedCase): readonly DigestFact[] {
  const primary = participantFor(loaded, 'primary')
  const partner = participantFor(loaded, 'partner')

  return (
    loaded.facts
      .filter((fact) => fact.supersededBy === null)
      // Special-category data is never put in front of the model (Invariant 6, §7.5).
      .filter((fact) => factCatalogue[fact.key].sensitivity !== 'special')
      .map((fact) => {
        const who =
          fact.subject === 'household'
            ? ''
            : fact.subject === primary
              ? ''
              : fact.subject === partner
                ? 'Partner’s '
                : ''

        return {
          label: `${who}${factCatalogue[fact.key].label}`,
          value: renderValue(fact),
          source: fact.source,
          verified: fact.verified,
        }
      })
  )
}

function digestApplications(loaded: LoadedCase): readonly DigestApplication[] {
  const primary = participantFor(loaded, 'primary')
  if (primary === null) return []

  return loaded.applications.map((application) => {
    // The one evaluation everything reads, so this, the status card and `request_upload`
    // agree about whether anything is left: the bank's post-submission requests and what the
    // linked accounts cover are both in it (Invariant 2, §41).
    const evaluation = evaluateFor(loaded, application)

    // Only blocking items: an optional extra is not something to chase anyone for. An
    // application can be waiting on the customer AND the partner at the same time, so the two
    // are split by each requirement's own `waitingOn` rather than the application's.
    const blocking = evaluation.outstanding.filter((item) => item.blocking)

    /**
     * Says WHY, not just what. Without the reason the model cannot tell "we have never been
     * told this" from "we have it and the customer confirms it at review", so it reports
     * values the customer has already given as though they were missing.
     */
    const describe = (item: OutstandingItem): string => {
      // The bank's own ask, after submission. Said as an instruction because the model has
      // nothing else to go on: the journey does not know this document, and what the
      // assessors meant by it is not something to guess at.
      if (item.requestId !== undefined) {
        return (
          `${item.requirement.label}: the bank has asked for this since the application went ` +
          'in. Offer the upload with request_upload; do not guess what else they want.'
        )
      }
      switch (item.reason) {
        case 'needs_confirmation':
          return `${item.requirement.label} — already known, confirmed on the review card`
        case 'needs_fresh':
          return `${item.requirement.label} — must be given again for this application`
        case 'awaiting_declaration':
          return `${item.requirement.label} — made on the review card`
        case 'awaiting_document':
          return `${item.requirement.label} — a document to upload`
        case 'awaiting_verification':
          return `${item.requirement.label} — already sent in, the team is checking it. Do NOT ask for it again or suggest it failed.`
        case 'awaiting_partner':
          return `${item.requirement.label} — waiting on the second applicant`
        case 'missing': {
          // A fact the catalogue will not accept from conversation must not be asked for,
          // however plainly it is missing — otherwise the customer answers and is refused.
          const formOnly =
            item.requirement.kind === 'fact' && !factCatalogue[item.requirement.fact].extractable
          return formOnly
            ? `${item.requirement.label} — must come from the form, never ask for it in chat`
            : `${item.requirement.label} — not yet known, ask for it`
        }
      }
    }

    return {
      id: application.id,
      product: application.product,
      // The row's own name: the model has to tell three savings accounts apart to pick one.
      displayName: applicationName(application),
      state: application.state,
      stateLabel: stateLabel(application.state),
      outstanding: blocking.filter((item) => item.waitingOn === 'primary').map(describe),
      outstandingForPartner: blocking.filter((item) => item.waitingOn === 'partner').map(describe),
      waitingOn: evaluation.waitingOn,
    }
  })
}

/**
 * Open banking, simulated: what the model is told about the accounts the customer linked.
 *
 * The balances are the rows; the salary, rent and savings are what `accountEvidence` read off
 * the transactions, the same reading the requirement engine assesses from, so the digest and
 * the assessment never disagree about what was seen. Undefined when nothing is linked: silence
 * is the signal, and a line saying "nothing linked" on every case would be read as a prompt
 * to link on every case.
 */
function digestLinkedAccounts(loaded: LoadedCase, today: string): DigestLinkedAccounts | undefined {
  if (loaded.linkedAccounts.length === 0) return undefined

  const evidence = accountEvidence(
    loaded.linkedAccounts,
    loaded.linkedAccounts.flatMap((account) => account.transactions),
    today,
  )
  const consentEndsOn = [...loaded.linkedAccounts]
    .map((account) => account.consentExpiresAt.slice(0, 10))
    .sort()[0]

  return {
    accounts: loaded.linkedAccounts.map((account) => ({
      bank: account.bank,
      name: account.displayName,
      type: account.accountType,
      balance: account.balance,
    })),
    salary: evidence.salaryObserved,
    rent: evidence.rentObserved,
    savingsHeld: evidence.savingsObserved,
    daysOfHistory: evidence.daysOfHistory,
    consentEndsOn: consentEndsOn ?? today,
    transfers: loaded.transfers.map((transfer) => ({
      amount: transfer.amount,
      cadence: transfer.cadence,
      toLabel: transfer.toLabel,
      state: transfer.state,
    })),
  }
}

/** §36 — what changed while they were away, in the customer's language. */
/**
 * Events a customer would recognise as news, and the only ones that bring them back (§36).
 *
 * One list, because there were three: one deciding whether to notify, one deciding what could
 * be narrated, and one in a test. Adding `savings_target_reached` to the narrator alone meant
 * the bank hit the milestone it had promised to watch for and said nothing, because the other
 * list had never heard of it.
 *
 * Sending the notification is not itself news: a return summary opening with "we sent you a
 * message" is worse than not opening at all.
 */
export function buildCaseDigest(
  loaded: LoadedCase,
  options: {
    readonly sensitiveDisclosure?: boolean
    /** Where the conversation has got to, from `stageFor`. Governs what this turn may do. */
    readonly stage?: Stage
    /**
     * The turn is the app reporting a tap. The case was read before that report was saved, so
     * the card it answered still looks untouched here; saying it is waiting would have Saoirse
     * pointing at a decision just made.
     */
    readonly acting?: boolean
    /** Plans already loaded, described by the plan engine. Kept out of here so the digest
     *  stays synchronous and the database round trip happens once, in the caller. */
    readonly plans?: readonly { readonly title: string; readonly lines: readonly string[] }[]
    readonly checkin?: CaseDigest['checkin']
    readonly revived?: CaseDigest['revived']
    readonly broughtPlans?: CaseDigest['broughtPlans']
    /** Unseen plan alerts and open reminders, as lines. */
    readonly alerts?: CaseDigest['alerts']
    /** Where the customer is trying to get to, from the Goal Engine. */
    readonly goals?: readonly string[]
    /** Whether what they are looking at is what suits them. */
    readonly suitability?: readonly string[]
    /** What applying for the product they have been quoted would involve. */
    readonly prospect?: readonly string[]
    /** How their money should be arranged across accounts, from the savings engine, as lines. */
    readonly arrangement?: readonly string[]
    /** What the savings engine needs to know before it will arrange anything. */
    readonly arrangementNeeds?: readonly string[]
    /** `YYYY-MM-DD`. What the linked accounts are read as of; defaults to the real day. */
    readonly today?: string
  } = {},
): CaseDigest {
  const linkedAccounts = digestLinkedAccounts(
    loaded,
    options.today ?? new Date().toISOString().slice(0, 10),
  )
  const needContext = needContextFor(loaded, {
    sensitiveDisclosure: options.sensitiveDisclosure ?? false,
  })
  const needs = needContext === null ? [] : evaluateNeeds(needContext, loaded.needs)
  const partnerParticipant = loaded.participants.find(
    (participant) => participant.role === 'partner',
  )
  const applications = digestApplications(loaded)
  const awaiting = options.acting === true ? null : awaitingCard(loaded)
  // Bank-held on a linked customer, stated otherwise; a linked customer banks here by definition.
  const banksHere =
    caseFactReader(loaded)?.boolean('banking.existingCustomer', 'primary') ??
    (loaded.customerName !== null ? true : null)
  // What the bank's own form still wants, which is a different list from the journey's.
  const forms = formDigestSection(formDigests(loaded))

  const partnerOutstanding = [
    ...new Set(applications.flatMap((application) => application.outstandingForPartner ?? [])),
  ]

  // Invariant 6: the model is told that special-category data exists so it can report status
  // honestly, but never what it says. Without this it reported answered health questions as
  // outstanding, because it genuinely could not see them.
  const sensitiveAreas = [
    ...new Set(
      loaded.facts
        .filter((fact) => fact.supersededBy === null)
        .filter((fact) => factCatalogue[fact.key].sensitivity === 'special')
        .map((fact) => {
          const application = loaded.applications.find(
            (candidate) => candidate.id === fact.capturedFor,
          )
          const where = application ? applicationName(application) : 'the case'
          return `Health information for ${where} — answered and recorded.`
        }),
    ),
  ]

  const ask = nextToClarify(needs)

  const digestNeeds: DigestNeeds = {
    surface: readyToSurface(needs).map((candidate) => ({
      name: candidate.need.name,
      framing: candidate.need.framing,
    })),
    ask:
      ask === null || ask.nextQuestion === null
        ? null
        : { name: ask.need.name, question: ask.nextQuestion },
    hold: deferred(needs).map((candidate) => ({
      name: candidate.need.name,
      reason: candidate.reason ?? 'the timing is wrong',
    })),
  }

  const plan = needContext === null ? null : buildPlan(needContext, needs)
  const digestPlan: DigestPlan | null =
    plan === null
      ? null
      : {
          steps: plan.steps.map((step) => ({
            title: step.title,
            because: step.because,
            when: step.when,
          })),
          watch: plan.watch?.describe ?? null,
          watchDetail: plan.watch,
        }

  return {
    customerName: loaded.customerName,
    sensitiveHeld: sensitiveAreas,
    needs: digestNeeds,
    plan: digestPlan,
    /*
     * Everything optional is copied here, and a new one that is not is silently dropped: the
     * caller spreads its options in, and TypeScript only flags excess properties on a direct
     * literal. `goals`, `suitability` and `prospect` were all computed every turn and thrown
     * away for exactly that reason. `digest.test.ts` now fails if any of them stops arriving.
     */
    ...(options.plans === undefined ? {} : { plans: options.plans }),
    ...(options.checkin === undefined ? {} : { checkin: options.checkin }),
    ...(options.revived === undefined ? {} : { revived: options.revived }),
    ...(options.broughtPlans === undefined ? {} : { broughtPlans: options.broughtPlans }),
    ...(options.alerts === undefined ? {} : { alerts: options.alerts }),
    ...(options.goals === undefined ? {} : { goals: options.goals }),
    ...(options.suitability === undefined ? {} : { suitability: options.suitability }),
    ...(options.prospect === undefined ? {} : { prospect: options.prospect }),
    ...(options.arrangement === undefined ? {} : { arrangement: options.arrangement }),
    ...(options.arrangementNeeds === undefined
      ? {}
      : { arrangementNeeds: options.arrangementNeeds }),
    ...(options.stage === undefined ? {} : { stage: options.stage }),
    // The card still waiting for a tap, read from the transcript and the case, never from the
    // model (which is what took "Great" for the tap).
    ...(awaiting === null ? {} : { awaiting }),
    banksHere,
    authLevel: loaded.authLevel,
    facts: digestFacts(loaded),
    ...(linkedAccounts === undefined ? {} : { linkedAccounts }),
    applications,
    ...(forms === '' ? {} : { forms }),
    declinedProducts: loaded.productInterests
      .filter((interest) => interest.status === 'declined')
      .map((interest) => interest.product),
    advisories: evaluateAdvisories(loaded.applications).map((advisory) => ({
      title: advisory.title,
      explanation: advisory.explanation,
    })),
    partner:
      partnerParticipant === undefined
        ? null
        : {
            name: partnerParticipant.displayName ?? 'Your partner',
            joined: true,
            outstanding: partnerOutstanding,
          },
    eventsSinceLastSeen: loaded.eventsSinceLastSeen
      .map(describeEvent)
      .filter((line): line is string => line !== null),
  }
}
