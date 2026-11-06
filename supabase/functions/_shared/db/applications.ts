import type { Db } from './case-repository.ts'
import { asApplicationId, type ApplicationId } from '../domain/facts.ts'
import { journeyFor } from '../domain/journeys/index.ts'
import type { Product } from '../domain/journey.ts'
import { withBankRequests } from '../domain/bank-requests.ts'
import { accountEvidence } from '../domain/open-banking/evidence.ts'
import {
  evaluateJourney,
  type JourneyEvaluation,
  type RequirementContext,
  type SatisfiedItem,
} from '../domain/requirements.ts'
import {
  stateLabel,
  transition,
  type Application,
  type TransitionEvent,
} from '../domain/state-machine.ts'
import type { ApplicationSummary } from '../contracts/case-action.ts'
import { participantFor, type LoadedCase } from './loaded-case.ts'
import { mustWrite, writeEvent } from './case-repository.ts'

/**
 * Applications: created by the customer's choice, and moved only by the state machine.
 *
 * Every state change in the system goes through `transition`, so an illegal move is refused
 * rather than written (Invariant 2, §14). Nothing here trusts a state supplied by a caller.
 */

export function evaluateFor(loaded: LoadedCase, application: Application): JourneyEvaluation {
  const primary = participantFor(loaded, 'primary')
  if (primary === null) {
    return { outstanding: [], satisfied: [], complete: false, waitingOn: null, activeBranches: [] }
  }

  const context: RequirementContext = {
    applicationId: application.id,
    participants: { primary, partner: participantFor(loaded, 'partner') },
    facts: loaded.facts,
    confirmations: loaded.confirmations
      .filter((confirmation) => confirmation.applicationId === application.id)
      .map((confirmation) => confirmation.requirementId),
    documents: loaded.documents
      .filter((document) => document.applicationId === application.id)
      .map((document) => ({ requirementId: document.requirementId, verified: document.verified })),
    /*
     * What the linked accounts show, so a payslip or a statement the journey asks for can be
     * met by the data rather than an upload (open banking, simulated). Computed here and
     * nowhere else, because this is the one evaluation every caller reads: the digest, the
     * status card and `request_upload` all have to agree about whether the document is still
     * wanted (Invariant 2).
     */
    ...(loaded.linkedAccounts.length === 0
      ? {}
      : {
          accountEvidence: accountEvidence(
            loaded.linkedAccounts,
            loaded.linkedAccounts.flatMap((account) => account.transactions),
            new Date().toISOString().slice(0, 10),
          ),
        }),
  }

  const journey = journeyFor(application.product)

  // What the bank asked for after submission is outstanding too. It is in no journey file, so
  // without this the status card, the counts and `request_upload` all said nothing was left
  // while the application sat in `info_required` (§41).
  return withBankRequests(
    journey,
    evaluateJourney(journey, context),
    loaded.requests.filter((request) => request.applicationId === application.id),
  )
}

/**
 * What the specific product is called, where the kind alone does not say.
 *
 * Without it a case holding SuperSaver, a notice account and MortgageSaver shows three rows
 * all reading "Savings account" — the same confusion the catalogue id was added to end, one
 * layer further down. Injected rather than looked up, because this file is tenant-free
 * (Invariant 11).
 */
export type NameFor = (product: Product, catalogueId: string | null) => string

/**
 * What an application is called, wherever it is shown or recorded.
 *
 * The name on the row first: it is what the customer saw when they chose, and three savings
 * accounts started with one tap each have their own. Three review cards all headed "Savings
 * account" were confirmed by a customer who was never told which account each was, because
 * every card and every event took the name from the journey, and nine savings products share
 * one journey. A row from before the column existed has no name, so the catalogue is asked
 * where a caller can reach it, and the journey's name is the last resort. Every card, summary
 * and event goes through here, so one application is never called two things.
 */
export function applicationName(
  application: Pick<Application, 'product' | 'catalogueId' | 'displayName'>,
  nameFor?: NameFor,
): string {
  return (
    application.displayName ??
    nameFor?.(application.product, application.catalogueId ?? null) ??
    journeyFor(application.product).displayName
  )
}

export function summarise(
  application: Application,
  evaluation: JourneyEvaluation,
  /** See `applicationName`: for a row created before names were stored. */
  nameFor?: NameFor,
): ApplicationSummary {
  const blocking = evaluation.outstanding.filter((item) => item.blocking)
  const satisfied = evaluation.satisfied.length
  const total = satisfied + blocking.length

  return {
    id: String(application.id),
    product: application.product,
    displayName: applicationName(application, nameFor),
    state: application.state,
    stateLabel: stateLabel(application.state),
    outstanding: blocking.filter((i) => i.waitingOn === 'primary').map((i) => i.requirement.label),
    outstandingForPartner: blocking
      .filter((i) => i.waitingOn === 'partner')
      .map((i) => i.requirement.label),
    waitingOn: evaluation.waitingOn,
    progress: total === 0 ? 1 : satisfied / total,
  }
}

/** One line of the status card: a requirement, and whether it is met. */
export type StatusStep = {
  readonly label: string
  readonly done: boolean
  readonly waitingOnPartner: boolean
}

/**
 * What the status card lists for an application: what is met, then what is still blocking.
 *
 * A document the bank has checked says so after its label. "Photo ID" ticked means only that
 * something arrived, and the customer who sent it in is waiting to hear whether it was
 * accepted; the check is the console's `documents_verified` move, read back here from the
 * document's own flag rather than from any event (§41).
 */
export function statusSteps(evaluation: JourneyEvaluation): readonly StatusStep[] {
  return [
    ...evaluation.satisfied.map((item) => ({
      label:
        item.requirement.kind === 'document' && item.document?.verified === true
          ? `${item.requirement.label} (checked)`
          : item.requirement.label,
      done: true,
      waitingOnPartner: false,
    })),
    ...evaluation.outstanding
      .filter((item) => item.blocking)
      .map((item) => ({
        label: item.requirement.label,
        done: false,
        waitingOnPartner: item.waitingOn === 'partner',
      })),
  ]
}

/**
 * Recomputes every application on the case and records any state change.
 *
 * Called after anything that could satisfy a requirement — a fact, a confirmation, a document.
 * The resulting state is derived, never chosen (Invariant 3).
 */
export async function recomputeApplications(
  client: Db,
  loaded: LoadedCase,
  options: {
    readonly activeApplicationId?: ApplicationId | undefined
    /** See `applicationName`: for a row created before names were stored. */
    readonly nameFor?: NameFor
  } = {},
): Promise<readonly ApplicationSummary[]> {
  const summaries: ApplicationSummary[] = []

  for (const application of loaded.applications) {
    const evaluation = evaluateFor(loaded, application)

    // A submitted or paused application is not recomputed: the customer is no longer
    // assembling it, and the state machine refuses the event anyway.
    const event: TransitionEvent = {
      type: 'requirements_changed',
      complete: evaluation.complete,
      waitingOn: evaluation.waitingOn,
      activeInConversation: options.activeApplicationId === application.id,
    }

    const result = transition(application, event)

    if (result.ok && result.changed) {
      mustWrite(
        await client
          .from('applications')
          .update({ state: result.application.state, resume_to: result.application.resumeTo })
          .eq('id', application.id),
        'the application',
      )

      await writeEvent(client, {
        caseId: loaded.caseId,
        type: 'application_state_changed',
        actor: 'system',
        applicationId: String(application.id),
        payload: {
          from: application.state,
          to: result.application.state,
          applicationName: applicationName(application, options.nameFor),
        },
      })

      summaries.push(summarise(result.application, evaluation, options.nameFor))
      continue
    }

    summaries.push(summarise(application, evaluation, options.nameFor))
  }

  return summaries
}

/** Which product of its kind, where the customer picked a specific one. */
export type ProductChoice = {
  readonly product: Product
  readonly catalogueId?: string | undefined
}

/**
 * What makes two choices the same choice.
 *
 * It used to be the kind alone, which quietly merged "SuperSaver for the €500 a month" and
 * "the 31-day notice account for the €20,000" into one savings application: both are
 * `savings`, so the second looked like a repeat of the first. A customer who asks for two
 * savings accounts should end up with two.
 */
const identify = (choice: { product: Product; catalogueId?: string | null | undefined }): string =>
  `${choice.product}:${choice.catalogueId ?? ''}`

/** §6 Stage 6 — the customer's choice creates several applications at once. */
export async function createApplications(
  client: Db,
  loaded: LoadedCase,
  products: readonly ProductChoice[],
  /**
   * What to call the application, given the catalogue product behind it.
   *
   * Injected rather than looked up here: this file is tenant-free, and the catalogue that knows
   * "savings.supersaver" is called SuperSaver belongs to the tenant (Invariant 11). The name is
   * written on the row, once, so everything that shows the application afterwards can read it
   * without the catalogue. Omitted, every savings application is called "Savings account",
   * which is where this started.
   */
  nameFor?: NameFor,
): Promise<readonly ProductChoice[]> {
  const existing = new Set(loaded.applications.map(identify))

  /*
   * Deduplicated against itself as well as against the case. A card offering two savings
   * accounts with no catalogue id on either is two choices that really are the same one, and
   * starting it twice would be the opposite failure to the one this fixes.
   */
  const wanted: ProductChoice[] = []
  for (const choice of products) {
    const key = identify(choice)
    if (existing.has(key)) continue
    existing.add(key)
    wanted.push(choice)
  }

  if (wanted.length === 0) return []

  const inserted = await client
    .from('applications')
    .insert(
      wanted.map((choice) => ({
        case_id: loaded.caseId,
        product: choice.product,
        catalogue_id: choice.catalogueId ?? null,
        display_name: applicationName(
          { product: choice.product, catalogueId: choice.catalogueId ?? null, displayName: null },
          nameFor,
        ),
        state: 'not_started',
      })),
    )
    .select('id, product, catalogue_id, display_name')

  if (inserted.error) throw new Error(inserted.error.message)

  for (const row of (inserted.data ?? []) as {
    id: string
    product: Product
    catalogue_id: string | null
    display_name: string | null
  }[]) {
    await writeEvent(client, {
      caseId: loaded.caseId,
      type: 'application_created',
      actor: 'customer',
      applicationId: row.id,
      payload: {
        product: row.product,
        applicationName: applicationName(
          { product: row.product, catalogueId: row.catalogue_id, displayName: row.display_name },
          nameFor,
        ),
        ...(row.catalogue_id === null ? {} : { catalogueId: row.catalogue_id }),
      },
    })
  }

  /*
   * Interest stays at the level of the kind. "Yes to savings" is what a tap means, and the
   * unique key here is (case, product) — two savings accounts are one interest in savings.
   */
  /*
   * Checked, because it was not.
   *
   * This upsert spent a week violating a check constraint that had never been widened for
   * savings or current accounts. Nothing read the result, so it failed on every one of them in
   * silence, and the only symptom was §49 quietly not working: a declined product had no
   * interest row to be declined in, so Saoirse offered it again.
   */
  const interests = await client.from('product_interests').upsert(
    [...new Set(wanted.map((choice) => choice.product))].map((product) => ({
      case_id: loaded.caseId,
      product,
      status: 'accepted',
    })),
    { onConflict: 'case_id,product' },
  )

  if (interests.error) throw new Error(interests.error.message)

  return wanted
}

/**
 * §53 — a requirement satisfied by a fact that was bank-held or captured for a different
 * application is a question the customer never had to answer. Recorded as it happens, so the
 * metric is derived from events rather than recomputed later.
 *
 * Returns what it recorded rather than how many, because the number to say to the customer is
 * not the number of events: `countReusedFacts` in `domain/reuse.ts` says why.
 */
export async function recordReuse(
  client: Db,
  loaded: LoadedCase,
  application: Application,
  evaluation: JourneyEvaluation,
  /**
   * Record only reuse of these keys. For the moment a sign-in puts an address on file and an
   * open application stops needing to ask for it: everything else that application reuses was
   * recorded when it started, and recording it again would count it twice (§53).
   */
  only?: ReadonlySet<string>,
): Promise<readonly SatisfiedItem[]> {
  const reused = evaluation.satisfied.filter(
    (item) =>
      item.reused && (only === undefined || (item.fact !== null && only.has(item.fact.key))),
  )

  for (const item of reused) {
    await writeEvent(client, {
      caseId: loaded.caseId,
      type: 'context_reused',
      actor: 'system',
      applicationId: String(application.id),
      payload: {
        requirementId: item.requirement.id,
        label: item.requirement.label,
        applicationName: applicationName(application),
        /*
         * Which fact satisfied it and where that fact came from. Added so the reuse card can
         * be built from these rows alone: the value is read from the facts table at render
         * time rather than copied here, because an events row is a record of what happened
         * and not a second home for personal data.
         */
        key: item.fact?.key ?? null,
        /*
         * A document the linked accounts covered has no fact: its source is `account_data`,
         * and the bank it was seen at is named so the card can say "seen in your linked AIB
         * account" rather than something vaguer.
         */
        source: item.fact?.source ?? item.reason ?? null,
        ...(item.reason === 'account_data' ? { bank: loaded.linkedAccounts[0]?.bank ?? null } : {}),
      },
    })
  }

  return reused
}

export function findApplication(
  loaded: LoadedCase,
  applicationId: string,
): Application | undefined {
  return loaded.applications.find((application) => String(application.id) === applicationId)
}

export { asApplicationId }
