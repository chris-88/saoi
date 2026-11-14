import {
  AI_USAGE_PAGE,
  PERIOD_DAYS,
  aiUsageCallSchema,
  type AiUsage,
  type AiUsageCall,
  type Period,
} from '@shared/contracts/admin.ts'
import type { McpHost } from '@shared/contracts/telemetry.ts'
import type { Db } from '../client.ts'
import { must } from '../client.ts'
import {
  type CallRow,
  type PlanOutcome,
  callSeries,
  countCalls,
  cursorOf,
  funnelByHost,
  gateMissingTally,
  otherUserAgents,
  parseCursor,
  toolTable,
} from './ai-usage-summary.ts'

export interface AdminAiUsageStore {
  /**
   * Calls to the MCP server over the period, the link funnel per assistant, and a page of the
   * recent calls: the newest, or the page after `cursor`. Null when the cursor is not valid.
   */
  aiUsage(period: Period, cursor?: string): Promise<AiUsage | null>
}

const DAY_MS = 86_400_000
/** PostgREST answers at most this many rows a request; longer reads are paged. */
const PAGE = 1000
/** Ids per `in` filter, to keep the request line short. */
const CHUNK = 200

const CALL_COLUMNS =
  'id, called_at, host, name, outcome, ms, card, session_key, user_agent, gate_missing, plan_saved, link_opened_at, saved_plan_id'

type CallDbRow = {
  id: string
  called_at: string
  host: string
  name: string
  outcome: string
  ms: number
  card: boolean
  session_key: string | null
  user_agent: string | null
  gate_missing: string[]
  plan_saved: boolean
  link_opened_at: string | null
  saved_plan_id: string | null
}

const toCallRow = (row: CallDbRow): CallRow => ({
  id: row.id,
  calledAt: row.called_at,
  host: row.host as McpHost,
  name: row.name,
  outcome: row.outcome as CallRow['outcome'],
  ms: row.ms,
  card: row.card,
  sessionKey: row.session_key,
  userAgent: row.user_agent,
  gateMissing: row.gate_missing,
  planSaved: row.plan_saved,
  linkOpenedAt: row.link_opened_at,
  savedPlanId: row.saved_plan_id,
})

const chunks = <T>(items: readonly T[]): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

async function callsBetween(db: Db, from: Date, to: Date): Promise<CallRow[]> {
  const rows: CallRow[] = []
  for (let start = 0; ; start += PAGE) {
    const page = must(
      await db
        .from('mcp_calls')
        .select(CALL_COLUMNS)
        .gte('called_at', from.toISOString())
        .lt('called_at', to.toISOString())
        .order('called_at', { ascending: true })
        .order('id', { ascending: true })
        .range(start, start + PAGE - 1),
      'mcp calls',
    ) as CallDbRow[]
    rows.push(...page.map(toCallRow))
    if (page.length < PAGE) return rows
  }
}

/**
 * Where each saved plan went: opened, claimed into a case that is not a probe, and whether that
 * case signed in (`customer_signed_in`) and chose a product (`product_chosen`).
 */
async function planOutcomes(db: Db, planIds: readonly string[]): Promise<Map<string, PlanOutcome>> {
  const plans: {
    id: string
    opened_at: string | null
    claimed_at: string | null
    case_id: string | null
  }[] = []
  for (const ids of chunks([...new Set(planIds)])) {
    plans.push(
      ...must(
        await db.from('saved_plans').select('id, opened_at, claimed_at, case_id').in('id', ids),
        'saved plans',
      ),
    )
  }
  const caseIds = [
    ...new Set(plans.flatMap((plan) => (plan.case_id === null ? [] : [plan.case_id]))),
  ]
  const probes = new Set<string>()
  const happened = new Map<string, Set<string>>()
  for (const ids of chunks(caseIds)) {
    const [cases, events] = await Promise.all([
      db.from('cases').select('id').in('id', ids).eq('kind', 'test'),
      db
        .from('events')
        .select('case_id, type')
        .in('case_id', ids)
        .in('type', ['customer_signed_in', 'product_chosen']),
    ])
    for (const row of must(cases, 'cases')) probes.add(row.id)
    for (const row of must(events, 'events')) {
      const types = happened.get(row.case_id) ?? new Set<string>()
      types.add(row.type)
      happened.set(row.case_id, types)
    }
  }
  const outcomes = new Map<string, PlanOutcome>()
  for (const plan of plans) {
    const caseId = plan.case_id
    const claimed = plan.claimed_at !== null && caseId !== null && !probes.has(caseId)
    const types = caseId === null ? undefined : happened.get(caseId)
    outcomes.set(plan.id, {
      opened: plan.opened_at !== null || plan.claimed_at !== null,
      claimed,
      signedIn: claimed && types?.has('customer_signed_in') === true,
      chosen: claimed && types?.has('product_chosen') === true,
    })
  }
  return outcomes
}

async function recentCalls(
  db: Db,
  from: Date,
  to: Date,
  after: { calledAt: string; id: string } | null,
): Promise<{ recent: AiUsageCall[]; nextCursor: string | null }> {
  let query = db
    .from('mcp_calls')
    .select('id, called_at, host, name, kind, outcome, ms, card, asked, gate_missing')
    .gte('called_at', from.toISOString())
    .lt('called_at', to.toISOString())
  if (after !== null) {
    query = query.or(
      `called_at.lt."${after.calledAt}",and(called_at.eq."${after.calledAt}",id.lt.${after.id})`,
    )
  }
  const rows = must(
    await query
      .order('called_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(AI_USAGE_PAGE + 1),
    'recent mcp calls',
  )
  const recent = rows.slice(0, AI_USAGE_PAGE).map((row) =>
    aiUsageCallSchema.parse({
      id: row.id,
      calledAt: row.called_at,
      host: row.host,
      name: row.name,
      kind: row.kind,
      outcome: row.outcome,
      ms: row.ms,
      card: row.card,
      asked: row.asked ?? {},
      gateMissing: row.gate_missing,
    }),
  )
  const last = recent.at(-1)
  return {
    recent,
    nextCursor: rows.length > AI_USAGE_PAGE && last !== undefined ? cursorOf(last) : null,
  }
}

async function aiUsage(db: Db, period: Period, cursor?: string): Promise<AiUsage | null> {
  const after = cursor === undefined ? null : parseCursor(cursor)
  if (cursor !== undefined && after === null) return null

  const days = PERIOD_DAYS[period]
  const to = new Date()
  // `all` starts at the first call there has ever been.
  const first =
    days === null
      ? await db
          .from('mcp_calls')
          .select('called_at')
          .order('called_at', { ascending: true })
          .limit(1)
          .maybeSingle()
      : null
  if (first !== null && first.error !== null) {
    throw new Error(`Failed to load the first mcp call: ${first.error.message}`)
  }
  const from =
    days === null
      ? new Date(first?.data?.called_at ?? to.toISOString())
      : new Date(to.getTime() - days * DAY_MS)
  const previousFrom = days === null ? null : new Date(from.getTime() - days * DAY_MS)

  const [rows, priorRows, page] = await Promise.all([
    callsBetween(db, from, to),
    previousFrom === null ? Promise.resolve(null) : callsBetween(db, previousFrom, from),
    recentCalls(db, from, to, after),
  ])
  const plans = await planOutcomes(
    db,
    [...rows, ...(priorRows ?? [])].flatMap((row) =>
      row.savedPlanId === null ? [] : [row.savedPlanId],
    ),
  )

  return {
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    totals: countCalls(rows, plans),
    previous: priorRows === null ? null : countCalls(priorRows, plans),
    funnel: funnelByHost(rows, plans),
    series: callSeries(rows, from, to),
    tools: toolTable(rows),
    gateMissing: gateMissingTally(rows),
    userAgents: otherUserAgents(rows),
    ...page,
  }
}

export function supabaseAdminAiUsageStore(db: Db): AdminAiUsageStore {
  return { aiUsage: (period, cursor) => aiUsage(db, period, cursor) }
}
