import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { effectiveGoals, effectiveNeeds } from '../domain/catalogue/overlay.ts'
import type { TurnUsage } from '../domain/cost.ts'
import { goalCatalogue } from '../domain/goals/catalogue.ts'
import { needCatalogue } from '../domain/needs/catalogue.ts'
import type { Database, Json } from './database.types.ts'

/**
 * The service-role client these helpers take, typed against the real schema.
 *
 * Generated from the linked project with `npm run db:types`. Untyped, every insert resolved
 * to `never` and every column name was a guess — which is how a call to a function that does
 * not exist, and a write naming a column that does not exist, both deployed cleanly. Nobody
 * saw either because the Edge Functions were never typechecked at all.
 */
export type Db = SupabaseClient<Database>

/** A row as the database wants it written, so a column typo is a compile error. */
export type Insert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

import {
  asApplicationId,
  asFactId,
  asParticipantId,
  factCatalogue,
  parseFactValue,
  type Fact,
  type FactKey,
  type FactSource,
  type ParticipantRole,
} from '../domain/facts.ts'
import type { Application } from '../domain/state-machine.ts'
import { slidersFor, type PersonaSliders } from '../llm/persona.ts'
import type { LoadedCase } from './loaded-case.ts'
import { loadLinkedAccounts, loadTransfers } from './linked.ts'
import * as rows from './rows.ts'

/**
 * Reads and writes for a turn. Takes the client rather than creating one, and touches no Deno
 * API, so it compiles and tests under Node as well as Deno.
 *
 * Every write here runs with the service role, which is why the schema has no client write
 * policies at all (Invariant 2).
 */

const MESSAGE_WINDOW = 24

/**
 * The console's limit. High enough to be "everything" for any real conversation, and still a
 * number — an unbounded query against a table somebody can write to is how one long case takes
 * the console down.
 */
const ALL_MESSAGES = 2000

/** The key off an unparsed fact row, for the log line when it could not be read. */
function keyOf(row: unknown): string {
  return typeof row === 'object' && row !== null && 'key' in row && typeof row.key === 'string'
    ? row.key
    : '(no key)'
}

type Query = { data: unknown; error: { message: string } | null }

function unwrap(result: Query, what: string): unknown {
  if (result.error) throw new Error(`Failed to load ${what}: ${result.error.message}`)
  return result.data
}

/**
 * A write whose failure must not pass unnoticed.
 *
 * Supabase returns errors rather than throwing them, so `await client.from(…).insert(…)` with
 * nothing reading the result is a write that can fail in complete silence. Thirty-nine of those
 * had accumulated.
 *
 * It is not hypothetical. `product_interests` spent a week rejecting every savings and current
 * account against a check constraint nobody had widened, and the only symptom was §49 quietly
 * not working: a declined product had no row to be declined in, so Saoirse offered it again. The
 * same shape was one line away from losing a health consent (Invariant 6), a submission that
 * Saoirse had already announced (Invariant 2), and the token behind an invitation link that had
 * just been handed to somebody.
 *
 * Throwing is right here. Every caller sits inside a request that either worked or did not,
 * and a customer told "that's started" when nothing was written is worse than an error.
 */
export function mustWrite<T extends { error: { message: string } | null }>(
  result: T,
  what: string,
): T {
  if (result.error) throw new Error(`Could not write ${what}: ${result.error.message}`)
  // Returned rather than consumed, so a write whose id the caller needs can still be checked.
  return result
}

/**
 * How much of the conversation to load.
 *
 * `MESSAGE_WINDOW` is sized for the model: a turn only needs recent history, and sending all of
 * it would be paying to re-read a conversation the model has already acted on. The console
 * needs the opposite — it is the record somebody reads before phoning a customer, and a
 * transcript that quietly stops twenty-four messages ago is worse than no transcript, because
 * it looks complete.
 */
export type LoadOptions = {
  /** Omitted, the model's window. `'all'` for anything that shows a human the case. */
  readonly messages?: number | 'all'
}

export async function loadCase(
  client: Db,
  caseId: string,
  options: LoadOptions = {},
): Promise<LoadedCase | null> {
  const caseResult = (await client
    .from('cases')
    .select('id, kind, auth_level, last_seen_at, customer_id')
    .eq('id', caseId)
    .maybeSingle()) as Query

  const caseData = unwrap(caseResult, 'the case')
  if (caseData === null) return null
  const theCase = rows.caseRow.parse(caseData)

  const [
    participantsData,
    factsData,
    applicationsData,
    confirmationsData,
    documentsData,
    requestsData,
    interestsData,
    messagesData,
    personaData,
    domainData,
    overridesData,
    formApplicationsData,
    customerNameResult,
    eventsSinceLastSeen,
    linkedAccounts,
    transfers,
  ] = await Promise.all([
    client.from('participants').select('id, role, display_name').eq('case_id', caseId),
    client
      .from('facts')
      .select(
        'id, key, participant_id, subject_kind, value, source, verified, captured_for, superseded_by, captured_at',
      )
      .eq('case_id', caseId),
    client
      .from('applications')
      .select('id, product, state, resume_to, catalogue_id, display_name')
      .eq('case_id', caseId),
    client.from('application_confirmations').select('application_id, requirement_id'),
    client
      .from('documents')
      .select('application_id, requirement_id, verified')
      .eq('case_id', caseId),
    client
      .from('application_requests')
      .select('id, application_id, requirement_id, status, detail'),
    client.from('product_interests').select('product, status, reason').eq('case_id', caseId),
    client
      .from('messages')
      .select('role, content, cards, created_at, usage')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false })
      .limit(options.messages === 'all' ? ALL_MESSAGES : (options.messages ?? MESSAGE_WINDOW)),
    client.from('persona_config').select('preset, sliders').eq('scope', 'global').maybeSingle(),
    client.from('domain_config').select('kill_switch').eq('scope', 'global').maybeSingle(),
    /*
     * Read fresh every turn, for the same reason persona is: a presenter who reworded a goal
     * between run-throughs expects the next message to use the new wording, not the wording
     * that happened to be deployed.
     */
    client
      .from('catalogue_overrides')
      .select(
        'kind, entry_id, enabled, name, summary, priority, milestone_labels, checkin_agendas, version, created_at, updated_at',
      ),
    /*
     * The digital form applications, so a turn can see what the bank's own document still
     * wants. Without them the digest can only describe the journey Saoirse wrote, and the point of
     * the feature is that the journey is the bank's.
     */
    client.from('form_applications').select('id, form_id, answers').eq('case_id', caseId),
    /*
     * These two used to run after the batch, one after the other.
     *
     * Both need only the case row, which is already in hand, so waiting for twelve other
     * queries to finish before starting them bought nothing and cost two round trips on the
     * critical path of every single turn. The customer is watching an empty stream for that
     * whole time.
     */
    loadCustomerName(client, theCase.customer_id),
    loadEventsSince(client, caseId, theCase.last_seen_at),
    // Open banking, simulated: the accounts under a standing consent and the transfers out
    // of them. Two more reads in the same batch, so a case with nothing linked pays one
    // round trip for the answer and not two in series.
    loadLinkedAccounts(client, caseId),
    loadTransfers(client, caseId),
  ])

  /*
   * Applied here rather than at each call site. The engines take a catalogue and evaluate
   * everything in it; if the overlay were applied by each caller, one caller forgetting would be
   * a goal that was switched off still being offered.
   */
  const overrides = rows.catalogueOverrideRow
    .array()
    .parse(unwrap(overridesData as Query, 'catalogue overrides'))
    .map(rows.toOverride)

  const formApplications = (
    (unwrap(formApplicationsData as Query, 'form applications') ?? []) as {
      id: string
      form_id: string
      answers: unknown
    }[]
  ).map((row) => ({
    id: row.id,
    formId: row.form_id,
    answers: (row.answers ?? {}) as Readonly<Record<string, unknown>>,
  }))

  const participants = rows.participantRow
    .array()
    .parse(unwrap(participantsData as Query, 'participants'))
    .map((row) => ({
      id: asParticipantId(row.id),
      role: row.role satisfies ParticipantRole,
      displayName: row.display_name,
    }))

  /*
   * The synthetic bank record first, then whatever the person is actually called.
   *
   * `customers` only holds the seeded demonstration customer. Somebody who signed in with
   * signed in has a name on their participant and no customer row at all, and Saoirse greeting
   * them as nobody would be the one obvious hole in "it knows who you are".
   */
  const customerName =
    customerNameResult ??
    participants
      .find((participant) => participant.role === 'primary')
      ?.displayName?.split(' ')[0] ??
    null

  /*
   * A fact whose key this build does not know is skipped, not fatal.
   *
   * `factRow` refuses a key that is not in the catalogue, which is right for a write and wrong
   * for a read: parsing the batch meant one unrecognised row took the whole case down with it.
   * Builds can disagree about the catalogue (an older service reading a row a newer one wrote),
   * and the console used to return a bare 500 for any case containing a new fact, which reaches
   * the browser as a CORS error and looks like the database is down.
   *
   * This build cannot interpret such a fact, so leaving it out is the honest handling. It is
   * logged rather than swallowed, because the other reason a key fails this check is that
   * something wrote a bad one.
   */
  const factRows = z.array(z.unknown()).parse(unwrap(factsData, 'facts'))
  const parsedFacts = factRows.map((row) => rows.factRow.safeParse(row))
  const unknownKeys = parsedFacts.flatMap((result, index) =>
    result.success ? [] : [keyOf(factRows[index])],
  )
  if (unknownKeys.length > 0) {
    console.warn(
      `skipped ${String(unknownKeys.length)} fact(s) this build cannot read: ${unknownKeys.join(', ')}`,
    )
  }

  const facts: Fact[] = parsedFacts
    .flatMap((result) => (result.success ? [result.data] : []))
    .map((row) => ({
      id: asFactId(row.id),
      key: row.key,
      subject:
        row.subject_kind === 'household' ? 'household' : asParticipantId(row.participant_id ?? ''),
      value: row.value,
      source: row.source satisfies FactSource,
      verified: row.verified,
      capturedFor: row.captured_for === null ? null : asApplicationId(row.captured_for),
      supersededBy: row.superseded_by === null ? null : asFactId(row.superseded_by),
      capturedAt: row.captured_at,
    }))

  const applications: Application[] = rows.applicationRow
    .array()
    .parse(unwrap(applicationsData as Query, 'applications'))
    .map((row) => ({
      id: asApplicationId(row.id),
      product: row.product,
      catalogueId: row.catalogue_id ?? null,
      displayName: row.display_name ?? null,
      state: row.state,
      resumeTo: row.resume_to,
    }))

  const applicationIds = new Set(applications.map((application) => String(application.id)))

  const persona = parsePersona(unwrap(personaData, 'persona'))
  const domainConfig = unwrap(domainData, 'domain config')

  return {
    caseId: theCase.id,
    kind: theCase.kind,
    authLevel: theCase.auth_level,
    customerName,
    lastSeenAt: theCase.last_seen_at,
    participants,
    facts,
    applications,
    formApplications,
    linkedAccounts,
    transfers,
    // Confirmations and requests are not scoped by case in the query, so they are filtered
    // to this case's applications here.
    confirmations: rows.confirmationRow
      .array()
      .parse(unwrap(confirmationsData as Query, 'confirmations'))
      .filter((row) => applicationIds.has(row.application_id))
      .map((row) => ({
        applicationId: asApplicationId(row.application_id),
        requirementId: row.requirement_id,
      })),
    documents: rows.documentRow
      .array()
      .parse(unwrap(documentsData as Query, 'documents'))
      .filter((row) => row.application_id !== null && row.requirement_id !== null)
      .map((row) => ({
        applicationId: asApplicationId(row.application_id ?? ''),
        requirementId: row.requirement_id ?? '',
        verified: row.verified,
      })),
    requests: rows.requestRow
      .array()
      .parse(unwrap(requestsData as Query, 'requests'))
      .filter((row) => applicationIds.has(row.application_id))
      .map((row) => ({
        id: row.id,
        applicationId: asApplicationId(row.application_id),
        requirementId: row.requirement_id,
        status: row.status,
        detail: row.detail,
      })),
    productInterests: rows.productInterestRow
      .array()
      .parse(unwrap(interestsData, 'product interests')),
    // Fetched newest-first for the limit, then reversed so the model reads them in order.
    messages: rows.messageRow
      .array()
      .parse(unwrap(messagesData, 'messages'))
      .reverse()
      .map((message) => ({
        role: message.role,
        content: message.content,
        cards: message.cards,
        createdAt: message.created_at,
        timing: rows.toUsage(message.usage)?.timing ?? null,
      })),
    eventsSinceLastSeen,
    persona,
    killSwitch:
      domainConfig === null ? false : rows.domainConfigRow.parse(domainConfig).kill_switch,
    overrides,
    goals: effectiveGoals(goalCatalogue, overrides),
    needs: effectiveNeeds(needCatalogue, overrides),
  }
}

async function loadCustomerName(client: Db, customerId: string | null): Promise<string | null> {
  if (customerId === null) return null
  const result = (await client
    .from('customers')
    .select('full_name')
    .eq('id', customerId)
    .maybeSingle()) as Query
  const data = unwrap(result, 'the customer')
  if (data === null) return null
  return rows.customerRow.parse(data).full_name.split(' ')[0] ?? null
}

async function loadEventsSince(
  client: Db,
  caseId: string,
  since: string | null,
): Promise<LoadedCase['eventsSinceLastSeen']> {
  if (since === null) return []

  const result = (await client
    .from('events')
    .select('type, created_at, payload')
    .eq('case_id', caseId)
    .gt('created_at', since)
    .order('created_at', { ascending: true })) as Query

  return rows.eventRow
    .array()
    .parse(unwrap(result, 'events'))
    .map((row) => ({ type: row.type, createdAt: row.created_at, payload: row.payload ?? {} }))
}

function parsePersona(data: unknown): PersonaSliders {
  if (data === null) return slidersFor('default')
  const parsed = rows.personaRow.safeParse(data)
  // A malformed persona row must never stop a turn: style is the least important thing here.
  return parsed.success ? parsed.data.sliders : slidersFor('default')
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function saveMessage(
  client: Db,
  message: {
    caseId: string
    participantId: string | null
    role: 'customer' | 'assistant' | 'system'
    content: string
    gateCategory?: string | null
    /** Rendered alongside this turn, so a reload restores the whole thing. */
    cards?: readonly unknown[]
    /** What the whole turn consumed. Omitted when nothing was measured. */
    usage?: TurnUsage
  },
): Promise<string> {
  const result = (await client
    .from('messages')
    .insert({
      case_id: message.caseId,
      participant_id: message.participantId,
      role: message.role,
      content: message.content,
      gate_category: message.gateCategory ?? null,
      cards: (message.cards ?? []) as Json,
      // Null rather than zero when unmeasured: a turn nobody counted is not a free turn.
      usage: (message.usage ?? null) as Json,
    })
    .select('id')
    .single()) as Query

  const data = unwrap(result, 'the saved message')
  return z_id(data)
}

export async function writeEvent(
  client: Db,
  event: {
    caseId: string
    type: string
    actor: 'customer' | 'partner' | 'model' | 'admin' | 'system'
    applicationId?: string | null
    payload?: Record<string, unknown>
  },
): Promise<void> {
  const result = (await client.from('events').insert({
    case_id: event.caseId,
    type: event.type,
    actor: event.actor,
    application_id: event.applicationId ?? null,
    payload: (event.payload ?? {}) as Json,
  })) as Query
  unwrap(result, 'the event')
}

export type FactWrite = {
  readonly key: FactKey
  /** Only meaningful for person-level keys. Defaults to the primary customer. */
  readonly subject?: 'primary' | 'partner' | undefined
  readonly value: unknown
}

export type FactWriteOutcome = {
  readonly accepted: readonly FactKey[]
  readonly rejected: readonly { readonly key: string; readonly reason: string }[]
}

/**
 * Writes facts the model extracted from conversation.
 *
 * Three checks, all server-side and none of them the model's to skip: the key must be in the
 * catalogue, the catalogue must mark it extractable (Invariant 6), and the value must satisfy
 * the key's schema. A rejection is returned to the model as a tool error, never shown to the
 * customer.
 *
 * Whether a fact is household-level or personal comes from the catalogue, not from the model.
 * Asking the model to classify it lost facts: it would send a household key under `primary`
 * and the write would be refused for a reason the customer never caused.
 */
export async function recordFacts(
  client: Db,
  input: {
    caseId: string
    facts: readonly FactWrite[]
    participants: Readonly<Record<'primary' | 'partner', string | null>>
    /**
     * Widened from the two conversational sources so the console can write a bank-held
     * figure through the same door. Hand-rolled inserts got the household/participant pairing
     * wrong and were rejected by the schema silently; one writer that reads the catalogue is
     * the fix.
     */
    source: FactSource
    capturedFor?: string | null
  },
): Promise<FactWriteOutcome> {
  const accepted: FactKey[] = []
  const rejected: { key: string; reason: string }[] = []
  const inserts: Insert<'facts'>[] = []

  for (const fact of input.facts) {
    const definition = factCatalogue[fact.key]

    if (!definition.extractable) {
      rejected.push({
        key: fact.key,
        reason:
          'This cannot be recorded from conversation. It is collected through a form with consent.',
      })
      continue
    }

    const parsed = parseFactValue(fact.key, fact.value)
    if (!parsed.ok) {
      rejected.push({ key: fact.key, reason: parsed.issues.join('; ') })
      continue
    }

    const household = definition.subject === 'household'
    const role = fact.subject ?? 'primary'
    const participantId = household ? null : input.participants[role]

    if (!household && participantId === null) {
      rejected.push({ key: fact.key, reason: missingParticipant(role, fact.key) })
      continue
    }

    accepted.push(fact.key)
    inserts.push({
      case_id: input.caseId,
      key: fact.key,
      participant_id: participantId,
      subject_kind: household ? 'household' : 'participant',
      value: parsed.value as Json,
      source: input.source,
      verified: false,
      captured_for: input.capturedFor ?? null,
    })
  }

  if (inserts.length === 0) return { accepted, rejected }

  /**
   * A new answer replaces the old one rather than sitting beside it.
   *
   * `superseded_by` was never written, so every correction left both values live and the
   * domain's "superseded facts never satisfy anything" rule was dead code. Worse, a value
   * recorded against the wrong person — a partner's salary attributed to the customer —
   * silently became the newer of two and won.
   *
   * An identical value is not written at all: re-stating something is not a correction, and
   * recording it again inflates the captured-facts count and clutters the inspector.
   */
  const keys = [...new Set(inserts.map((row) => row.key))]
  const current = (await client
    .from('facts')
    .select('id, key, participant_id, value')
    .eq('case_id', input.caseId)
    .in('key', keys)
    .is('superseded_by', null)) as Query

  const live = (current.data ?? []) as {
    id: string
    key: string
    participant_id: string | null
    value: unknown
  }[]

  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const matching = (row: Insert<'facts'>) =>
    live.filter(
      (existing) =>
        existing.key === row.key && existing.participant_id === (row.participant_id ?? null),
    )

  const changed = inserts.filter((row) => !matching(row).some((e) => same(e.value, row.value)))
  if (changed.length === 0) return { accepted, rejected }

  const written = (await client
    .from('facts')
    .insert(changed)
    .select('id, key, participant_id')) as Query

  unwrap(written, 'the recorded facts')

  for (const row of (written.data ?? []) as {
    id: string
    key: string
    participant_id: string | null
  }[]) {
    const replaced = live
      .filter((e) => e.key === row.key && e.participant_id === row.participant_id)
      .map((e) => e.id)

    if (replaced.length > 0) {
      mustWrite(
        await client.from('facts').update({ superseded_by: row.id }).in('id', replaced),
        'the facts',
      )
    }
  }

  return { accepted, rejected }
}

/**
 * Why a fact about somebody not on the case yet cannot be written, and what to do instead.
 *
 * "There is no partner on this case yet" was true and not enough. The model read it as a
 * passing failure and sent the same write on the next five turns, refused every time, while
 * the salary the customer had quoted for their partner was kept nowhere. A refusal the model
 * acts on says three things: the fact is the partner's to give when they join, do not retry,
 * and, for income, the key that holds what the customer said about it.
 */
function missingParticipant(role: 'primary' | 'partner', key: FactKey): string {
  const refusal =
    `There is no ${role} on this case yet; ${key} is asked of them directly when they join. ` +
    'Do not try again.'
  return role === 'partner' && key === 'income.annualBasic'
    ? `${refusal} Record what the customer said about it as income.partnerAnnualStated instead.`
    : refusal
}

export async function touchLastSeen(client: Db, caseId: string): Promise<void> {
  const result = (await client
    .from('cases')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', caseId)) as Query
  unwrap(result, 'the last-seen timestamp')
}

function z_id(data: unknown): string {
  const parsed = data as { id?: unknown }
  if (typeof parsed.id !== 'string') throw new Error('Insert returned no id')
  return parsed.id
}
