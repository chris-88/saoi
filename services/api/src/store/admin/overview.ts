import {
  PERIOD_DAYS,
  type AdminOverview,
  type Analytics,
  type Collaborator,
  type FeedbackItem,
  type Period,
} from '@shared/contracts/admin.ts'
import { describeAdminEvent } from '@shared/db/admin-events.ts'
import {
  CASE_OUTCOMES,
  CASE_OUTCOME_LABELS,
  CASE_OUTCOME_NOTES,
  caseOutcome,
  caseStatus,
  type CaseKind,
  type CaseOutcome,
} from '@shared/domain/case.ts'
import { cameBack, countJourney, countStalls, summariseFeedback } from '@shared/domain/arrivals.ts'
import { goalCatalogue } from '@shared/domain/goals/catalogue.ts'
import { slidersFor } from '@shared/llm/persona.ts'
import type { Db } from '../client.ts'
import { must } from '../client.ts'
import { movesFor } from './demoMoves.ts'
import { costOf, headlineCounts } from './overview-helpers.ts'

export interface AdminOverviewStore {
  /** The console's headline numbers, case list, activity and the one-click moves. */
  overview(period: Period, caseId?: string): Promise<AdminOverview>
  /** The analytics screen over a period. */
  analytics(period: Period): Promise<Analytics>
  /** Feedback, newest first. */
  feedback(period: Period): Promise<FeedbackItem[]>
  /** Who asked to be contacted, newest first. */
  collaborators(): Promise<Collaborator[]>
}

const DAY_MS = 86_400_000

type Rows<T> = { data: T[] | null; error: { message: string } | null }
const rowsOf = <T>(result: Rows<T>, what: string): T[] => must(result, what) ?? []

export async function loadFeedback(
  db: Db,
  where: { caseId?: string; since?: string },
): Promise<FeedbackItem[]> {
  let query = db
    .from('feedback')
    .select('id, case_id, kind, rating, comment, reply_to, created_at, messages(content)')
    .order('created_at', { ascending: false })
  if (where.caseId !== undefined) query = query.eq('case_id', where.caseId)
  if (where.since !== undefined) query = query.gte('created_at', where.since)

  const result = await query
  if (result.error !== null) throw new Error(`Failed to load feedback: ${result.error.message}`)

  const rows = result.data as unknown as {
    id: string
    case_id: string
    kind: string
    rating: number
    comment: string | null
    reply_to: string | null
    created_at: string
    messages: { content: string } | null
  }[]

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    kind: row.kind === 'turn' ? 'turn' : 'session',
    rating: row.rating,
    comment: row.comment,
    replyTo: row.reply_to,
    about: row.kind === 'turn' && row.messages !== null ? row.messages.content.slice(0, 160) : null,
    createdAt: row.created_at,
  }))
}

function countByCase(rows: readonly { case_id: string }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.case_id, (counts.get(row.case_id) ?? 0) + 1)
  return counts
}

async function overview(db: Db, period: Period, asked: string | undefined): Promise<AdminOverview> {
  const [config, persona, cases, events, blocked] = await Promise.all([
    db.from('domain_config').select('kill_switch').eq('scope', 'global').maybeSingle(),
    db.from('persona_config').select('preset, sliders').eq('scope', 'global').maybeSingle(),
    db
      .from('cases')
      .select('id, kind, label, updated_at')
      .order('updated_at', { ascending: false })
      .limit(25),
    // Capped: metrics are a headline, not an audit, and the log grows without bound.
    db
      .from('events')
      .select('type, created_at')
      .order('created_at', { ascending: false })
      .limit(5000),
    db
      .from('events')
      .select('payload, created_at')
      .eq('type', 'request_blocked')
      .order('created_at', { ascending: false })
      .limit(10),
  ])
  if (config.error) throw new Error(`Failed to load domain config: ${config.error.message}`)
  if (persona.error) throw new Error(`Failed to load persona: ${persona.error.message}`)

  // Two windows: the one asked for, and the one immediately before it.
  const days = PERIOD_DAYS[period]
  const now = Date.now()
  const windowStart = days === null ? null : now - days * DAY_MS
  const previousStart = days === null || windowStart === null ? null : windowStart - days * DAY_MS

  const counts = new Map<string, number>()
  const before = new Map<string, number>()
  for (const row of rowsOf(events, 'events') as { type: string; created_at: string }[]) {
    const at = Date.parse(row.created_at)
    if (windowStart !== null && previousStart !== null && at < windowStart) {
      if (at >= previousStart) before.set(row.type, (before.get(row.type) ?? 0) + 1)
      continue
    }
    counts.set(row.type, (counts.get(row.type) ?? 0) + 1)
  }

  const caseRows = rowsOf(cases, 'cases') as {
    id: string
    kind: string
    label: string | null
    updated_at: string
  }[]
  const caseIds = caseRows.map((row) => row.id)

  // Two queries, not two per case: this is a console someone drives live.
  const [allApps, allMessages, allNames, allBlocked, allCheckins] = await Promise.all([
    db.from('applications').select('case_id, state').in('case_id', caseIds),
    db
      .from('messages')
      .select('case_id, role, content, created_at, usage')
      .in('case_id', caseIds)
      .order('created_at', { ascending: true }),
    db
      .from('facts')
      .select('case_id, value, captured_at')
      .eq('key', 'identity.fullName')
      .is('superseded_by', null)
      .in('case_id', caseIds)
      .order('captured_at', { ascending: true }),
    db.from('events').select('case_id').eq('type', 'request_blocked').in('case_id', caseIds),
    // A check-in the bank promised and has not kept is the clearest "somebody look at this".
    db.from('plan_checkins').select('state, plans!inner(case_id)').eq('state', 'due'),
  ])

  const appRows = rowsOf(allApps, 'applications') as { case_id: string; state: string }[]
  const messageRows = rowsOf(allMessages, 'messages') as {
    case_id: string
    role: string
    content: string
    usage: unknown
  }[]

  const appCounts = countByCase(appRows)
  const messageCounts = countByCase(messageRows)

  const appStates = new Map<string, { state: string }[]>()
  for (const row of appRows) {
    appStates.set(row.case_id, [...(appStates.get(row.case_id) ?? []), { state: row.state }])
  }

  const customerCounts = new Map<string, number>()
  const latest = new Map<string, string>()
  for (const row of messageRows) {
    if (row.role === 'customer') {
      customerCounts.set(row.case_id, (customerCounts.get(row.case_id) ?? 0) + 1)
    }
    // Ordered oldest first, so the last one written wins.
    if (row.role !== 'system') latest.set(row.case_id, row.content)
  }

  const blockedCases = new Set(
    (rowsOf(allBlocked, 'events') as { case_id: string }[]).map((row) => row.case_id),
  )
  const dueCases = new Set(
    (rowsOf(allCheckins, 'plan check-ins') as unknown as { plans?: { case_id?: string } }[])
      .map((row) => row.plans?.case_id)
      .filter((id): id is string => typeof id === 'string'),
  )

  // The primary applicant's name tells cases apart; until it is known, a short stable id.
  const names = new Map<string, string>()
  for (const row of rowsOf(allNames, 'facts') as { case_id: string; value: unknown }[]) {
    if (typeof row.value === 'string' && row.value.trim().length > 0 && !names.has(row.case_id)) {
      names.set(row.case_id, row.value.trim())
    }
  }

  const summaries = caseRows.map((row) => ({
    id: row.id,
    kind: row.kind as CaseKind,
    label:
      row.kind === 'presenter'
        ? row.label
        : (names.get(row.id) ?? `Unnamed · ${row.id.slice(0, 8)}`),
    applications: appCounts.get(row.id) ?? 0,
    messages: messageCounts.get(row.id) ?? 0,
    updatedAt: row.updated_at,
    status: caseStatus({
      everBlocked: blockedCases.has(row.id),
      applications: appStates.get(row.id) ?? [],
      checkinDue: dueCases.has(row.id),
      customerMessages: customerCounts.get(row.id) ?? 0,
    }),
    latest: (latest.get(row.id) ?? '').replace(/\s+/g, ' ').slice(0, 140),
  }))

  // The case the console is driving: the one asked for, else the most recently active.
  const mostRecent = [...caseRows].sort((a, b) =>
    String(b.updated_at).localeCompare(String(a.updated_at)),
  )[0]
  const focus =
    (asked === undefined ? undefined : caseRows.find((row) => row.id === asked)) ??
    mostRecent ??
    null

  const focusApps = focus
    ? rowsOf(
        await db
          .from('applications')
          .select('product, state, resume_to, id')
          .eq('case_id', focus.id),
        'applications',
      )
    : []
  const demoActions = movesFor(focusApps)

  const recent = await db
    .from('events')
    .select('type, actor, created_at, payload, case_id')
    .in('case_id', caseIds)
    .order('created_at', { ascending: false })
    .limit(30)

  const labelFor = new Map(summaries.map((row) => [row.id, row.label ?? 'Case']))
  const activity = (
    rowsOf(recent, 'events') as unknown as {
      type: string
      actor: string
      created_at: string
      payload: Record<string, unknown> | null
      case_id: string
    }[]
  ).map((row) => ({
    at: row.created_at,
    actor: row.actor,
    caseLabel: labelFor.get(row.case_id) ?? 'Case',
    ...describeAdminEvent(row.type, row.payload ?? {}),
  }))

  // Only Saoirse's turns carry usage: a customer message costs nothing to store.
  const saoirseTurns = messageRows.filter((row) => row.role === 'assistant')

  return {
    activity,
    cost: costOf(saoirseTurns),
    killSwitch: (config.data as { kill_switch?: boolean } | null)?.kill_switch ?? false,
    demoActions: [...demoActions],
    focusCaseId: focus?.id ?? null,
    persona: {
      preset: (persona.data as { preset?: string } | null)?.preset ?? 'default',
      sliders: ((persona.data as { sliders?: unknown } | null)?.sliders ??
        slidersFor('default')) as AdminOverview['persona']['sliders'],
    },
    cases: summaries,
    metrics: headlineCounts(counts),
    period,
    // `all` has no earlier window, so there is nothing honest to compare against.
    previous: days === null ? null : headlineCounts(before),
    blocked: (
      rowsOf(blocked, 'events') as unknown as {
        payload: { category?: string; request?: string }
        created_at: string
      }[]
    ).map((row) => ({
      category: row.payload?.category ?? 'unknown',
      at: row.created_at,
      request: row.payload?.request ?? '',
    })),
  }
}

/** Where applications sit on the path; `declined` and `paused` are off it rather than behind. */
const ORDER = [
  'not_started',
  'in_progress',
  'waiting_customer',
  'waiting_partner',
  'ready',
  'submitted',
  'under_review',
  'info_required',
  'approved',
  'completed',
]
const rank = (state: string): number => {
  const index = ORDER.indexOf(state)
  return index === -1 ? 0 : index
}

async function analytics(db: Db, period: Period): Promise<Analytics> {
  const days = PERIOD_DAYS[period]
  const to = new Date()
  // `all` still needs a start for the series: the first event there has ever been.
  const earliest = await db
    .from('events')
    .select('created_at')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const from =
    days === null
      ? new Date(earliest.data?.created_at ?? to.toISOString())
      : new Date(to.getTime() - days * DAY_MS)
  const previousFrom = days === null ? null : new Date(from.getTime() - days * DAY_MS)

  const [series, messageSeries, windowEvents, priorEvents, applications, caseFacts] =
    await Promise.all([
      db.rpc('metrics_by_day', { from_ts: from.toISOString(), to_ts: to.toISOString() }),
      // Volume is messages, not events: merged into the same series so every chart reads one array.
      db.rpc('messages_by_day', { from_ts: from.toISOString(), to_ts: to.toISOString() }),
      db
        .from('events')
        .select('type, case_id, payload')
        .gte('created_at', from.toISOString())
        .lt('created_at', to.toISOString()),
      previousFrom === null
        ? Promise.resolve({ data: [], error: null })
        : db
            .from('events')
            .select('type')
            .gte('created_at', previousFrom.toISOString())
            .lt('created_at', from.toISOString()),
      // Application states are current, not historical.
      db.from('applications').select('case_id, state'),
      db
        .from('messages')
        .select('case_id, role')
        .eq('role', 'customer')
        .gte('created_at', from.toISOString()),
    ])

  // The same count over the window before, so the comparison measures the same thing.
  const priorFacts =
    previousFrom === null
      ? { data: [] as { case_id: string }[], error: null }
      : await db
          .from('messages')
          .select('case_id')
          .eq('role', 'customer')
          .gte('created_at', previousFrom.toISOString())
          .lt('created_at', from.toISOString())

  for (const [result, what] of [
    [series, 'daily metrics'],
    [messageSeries, 'daily messages'],
    [windowEvents, 'events'],
    [applications, 'applications'],
    [caseFacts, 'messages'],
    [priorFacts, 'messages'],
  ] as const) {
    if (result.error !== null) throw new Error(`Failed to load ${what}: ${result.error.message}`)
  }

  const rows = (windowEvents.data ?? []) as unknown as {
    type: string
    case_id: string
    payload: Record<string, unknown>
  }[]
  const countOf = (list: { type: string }[], type: string): number =>
    list.filter((row) => row.type === type).length

  // A conversation is a case somebody spoke in, counted once however much was said.
  const spokeIn = new Set(((caseFacts.data ?? []) as { case_id: string }[]).map((r) => r.case_id))

  const totals = {
    conversations: spokeIn.size,
    applications: countOf(rows, 'application_created'),
    goals: countOf(rows, 'goal_identified'),
    blocked: countOf(rows, 'request_blocked'),
  }

  const prior = (priorEvents.data ?? []) as { type: string }[]
  const previous =
    previousFrom === null
      ? null
      : {
          conversations: new Set(
            ((priorFacts.data ?? []) as { case_id: string }[]).map((row) => row.case_id),
          ).size,
          applications: countOf(prior, 'application_created'),
          goals: countOf(prior, 'goal_identified'),
          blocked: countOf(prior, 'request_blocked'),
        }

  const appRows = (applications.data ?? []) as { case_id: string; state: string }[]

  // Each stage counts applications that reached it or went past it.
  const funnel = [
    { stage: 'started', label: 'Started', at: 1 },
    { stage: 'ready', label: 'Ready to submit', at: ORDER.indexOf('ready') },
    { stage: 'submitted', label: 'Submitted', at: ORDER.indexOf('submitted') },
    { stage: 'approved', label: 'Approved', at: ORDER.indexOf('approved') },
  ].map((stage) => ({
    stage: stage.stage,
    label: stage.label,
    count: appRows.filter((row) => rank(row.state) >= stage.at).length,
  }))

  const tallyPayload = (type: string, key: string): Map<string, number> => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (row.type !== type) continue
      const value = row.payload[key]
      if (typeof value !== 'string') continue
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return counts
  }

  const topGoals = [...tallyPayload('goal_identified', 'goal').entries()]
    .map(([goal, count]) => ({
      goal,
      name: goalCatalogue.find((item) => item.id === goal)?.name ?? goal,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  const guardrails = [...tallyPayload('request_blocked', 'category').entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)

  // Outcomes are per case, from everything that happened to it, not only the window.
  const byCase = new Map<string, { blocked: boolean; goals: number; plans: number }>()
  for (const id of spokeIn) byCase.set(id, { blocked: false, goals: 0, plans: 0 })

  const allForCases = await db
    .from('events')
    .select('case_id, type, payload')
    .in('case_id', [...spokeIn])
  for (const row of rowsOf(allForCases, 'events') as { case_id: string; type: string }[]) {
    const entry = byCase.get(row.case_id)
    if (entry === undefined) continue
    if (row.type === 'request_blocked') entry.blocked = true
    if (row.type === 'goal_identified') entry.goals += 1
    if (row.type === 'plan_created') entry.plans += 1
  }

  const appsByCase = new Map<string, { state: string }[]>()
  for (const row of appRows) {
    appsByCase.set(row.case_id, [...(appsByCase.get(row.case_id) ?? []), { state: row.state }])
  }

  const outcomeCounts = new Map<CaseOutcome, number>()
  for (const [caseId, entry] of byCase) {
    const outcome = caseOutcome({
      everBlocked: entry.blocked,
      applications: appsByCase.get(caseId) ?? [],
      plans: entry.plans,
      goalsIdentified: entry.goals,
      // Every case in `byCase` is one somebody spoke in; that is how it got there.
      customerMessages: 1,
    })
    if (outcome === null) continue
    outcomeCounts.set(outcome, (outcomeCounts.get(outcome) ?? 0) + 1)
  }

  const outcomes = CASE_OUTCOMES.map((outcome) => ({
    outcome,
    label: CASE_OUTCOME_LABELS[outcome],
    note: CASE_OUTCOME_NOTES[outcome],
    count: outcomeCounts.get(outcome) ?? 0,
  })).filter((entry) => entry.count > 0)

  // The journey after a show and tell: a cohort of cases that arrived in the period. Probes
  // (kind 'test') are left out of everything here.
  const testCases = rowsOf(await db.from('cases').select('id').eq('kind', 'test'), 'cases')
  const testIds = new Set((testCases as { id: string }[]).map((row) => row.id))

  let arrivedQuery = db.from('cases').select('id, source').neq('kind', 'test')
  if (days !== null) arrivedQuery = arrivedQuery.gte('created_at', from.toISOString())
  const arrived = rowsOf(await arrivedQuery, 'cases') as { id: string; source: string | null }[]
  const arrivedIds = arrived.map((row) => row.id)

  const [arrivalEvents, arrivalMessages, feedbackRows] = await Promise.all([
    arrivedIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from('events')
          .select('case_id, type, created_at')
          .in('case_id', arrivedIds)
          .in('type', [
            'plan_created',
            'application_created',
            'application_submitted',
            'customer_signed_in',
            'notification_sent',
            'feedback_given',
          ]),
    arrivedIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db.from('messages').select('case_id, role, created_at').in('case_id', arrivedIds),
    db
      .from('feedback')
      .select('case_id, kind, rating')
      .gte('created_at', from.toISOString())
      .lt('created_at', to.toISOString()),
  ])
  must(arrivalEvents, 'events')
  must(arrivalMessages, 'messages')
  must(feedbackRows, 'feedback')

  const eventsByCase = new Map<string, { types: Set<string>; notifiedAt: string[] }>()
  for (const row of (arrivalEvents.data ?? []) as {
    case_id: string
    type: string
    created_at: string
  }[]) {
    const entry = eventsByCase.get(row.case_id) ?? { types: new Set<string>(), notifiedAt: [] }
    entry.types.add(row.type)
    if (row.type === 'notification_sent') entry.notifiedAt.push(row.created_at)
    eventsByCase.set(row.case_id, entry)
  }

  const messagesByCase = new Map<string, { customer: number; at: string[] }>()
  for (const row of (arrivalMessages.data ?? []) as {
    case_id: string
    role: string
    created_at: string
  }[]) {
    const entry = messagesByCase.get(row.case_id) ?? { customer: 0, at: [] }
    if (row.role === 'customer') entry.customer += 1
    if (row.role === 'customer' || row.role === 'assistant') entry.at.push(row.created_at)
    messagesByCase.set(row.case_id, entry)
  }

  const journey = countJourney(
    arrived.map((row) => {
      const happened = eventsByCase.get(row.id) ?? { types: new Set<string>(), notifiedAt: [] }
      const said = messagesByCase.get(row.id) ?? { customer: 0, at: [] }
      return {
        eventTypes: happened.types,
        customerMessages: said.customer,
        cameBack: cameBack(happened.notifiedAt, said.at),
      }
    }),
  )

  const sourceCounts = new Map<string, number>()
  for (const row of arrived) {
    const source = row.source ?? 'unknown'
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1)
  }
  const sources = [...sourceCounts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)

  // Stalls are events in the window, as the headline counts are, minus the probes.
  const stalls = countStalls(rows.filter((row) => !testIds.has(row.case_id)).map((r) => r.type))

  const feedback = summariseFeedback(
    ((feedbackRows.data ?? []) as { case_id: string; kind: string; rating: number }[]).filter(
      (row) => !testIds.has(row.case_id),
    ),
  )

  return {
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    totals,
    previous,
    series: [
      ...((series.data ?? []) as { day: string; type: string; count: number }[]),
      ...((messageSeries.data ?? []) as { day: string; role: string; count: number }[]).map(
        (row) => ({ day: row.day, type: `message:${row.role}`, count: row.count }),
      ),
    ],
    funnel,
    journey,
    sources,
    stalls,
    feedback,
    topGoals,
    guardrails,
    outcomes,
  }
}

export function supabaseAdminOverviewStore(db: Db): AdminOverviewStore {
  return {
    overview: (period, caseId) => overview(db, period, caseId),
    analytics: (period) => analytics(db, period),
    async feedback(period) {
      const days = PERIOD_DAYS[period]
      const since = days === null ? undefined : new Date(Date.now() - days * DAY_MS).toISOString()
      return loadFeedback(db, since === undefined ? {} : { since })
    },
    async collaborators() {
      const result = await db
        .from('collaborators')
        .select('id, kind, name, email, organisation, role, interest, source, created_at')
        .order('created_at', { ascending: false })
      const rows = must(result, 'collaborators') as {
        id: string
        kind: 'collaborate' | 'question'
        name: string
        email: string
        organisation: string | null
        role: string | null
        interest: string
        source: string | null
        created_at: string
      }[]
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        email: row.email,
        organisation: row.organisation,
        role: row.role,
        interest: row.interest,
        source: row.source,
        createdAt: row.created_at,
      }))
    },
  }
}
