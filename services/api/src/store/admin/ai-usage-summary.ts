import {
  AI_USAGE_STEPS,
  type AiUsage,
  type AiUsageCall,
  type AiUsageCounts,
} from '@shared/contracts/admin.ts'
import { MCP_HOSTS, type McpHost } from '@shared/contracts/telemetry.ts'

/**
 * The arithmetic behind the AI usage screen, kept apart from the queries so it can be tested
 * on rows. Each call in the window is followed through the link funnel: the card it showed,
 * the plan its result held, the link opened, the plan claimed into a case, that case signed
 * in and a product chosen on it.
 */

/** One `mcp_calls` row, as the summary reads it. */
export type CallRow = {
  readonly id: string
  readonly calledAt: string
  readonly host: McpHost
  readonly name: string
  readonly outcome: 'ok' | 'error' | 'gated'
  readonly ms: number
  readonly card: boolean
  readonly sessionKey: string | null
  readonly userAgent: string | null
  readonly gateMissing: readonly string[]
  readonly planSaved: boolean
  readonly linkOpenedAt: string | null
  readonly savedPlanId: string | null
}

/** Where the plan behind a call went: opened, claimed into a case, and what the case did. */
export type PlanOutcome = {
  readonly opened: boolean
  readonly claimed: boolean
  readonly signedIn: boolean
  readonly chosen: boolean
}

const HOST_ORDER: ReadonlyMap<McpHost, number> = new Map(MCP_HOSTS.map((host, i) => [host, i]))

/** The funnel steps one call reached. A plan claimed into a probe case is not in `plans`. */
function stepsOf(row: CallRow, plans: ReadonlyMap<string, PlanOutcome>): AiUsageCounts {
  const plan = row.savedPlanId === null ? undefined : plans.get(row.savedPlanId)
  const opened = row.linkOpenedAt !== null || plan?.opened === true
  return {
    calls: 1,
    sessions: 0,
    cardsShown: row.card ? 1 : 0,
    plansSaved: row.planSaved || row.savedPlanId !== null ? 1 : 0,
    linksOpened: opened ? 1 : 0,
    claimed: plan?.claimed === true ? 1 : 0,
    signedIn: plan?.claimed === true && plan.signedIn ? 1 : 0,
    chosen: plan?.claimed === true && plan.chosen ? 1 : 0,
  }
}

const ZERO: AiUsageCounts = {
  calls: 0,
  sessions: 0,
  cardsShown: 0,
  plansSaved: 0,
  linksOpened: 0,
  claimed: 0,
  signedIn: 0,
  chosen: 0,
}

const add = (a: AiUsageCounts, b: AiUsageCounts): AiUsageCounts => ({
  calls: a.calls + b.calls,
  sessions: a.sessions + b.sessions,
  cardsShown: a.cardsShown + b.cardsShown,
  plansSaved: a.plansSaved + b.plansSaved,
  linksOpened: a.linksOpened + b.linksOpened,
  claimed: a.claimed + b.claimed,
  signedIn: a.signedIn + b.signedIn,
  chosen: a.chosen + b.chosen,
})

/** The headline counts over a set of calls. */
export function countCalls(
  rows: readonly CallRow[],
  plans: ReadonlyMap<string, PlanOutcome>,
): AiUsageCounts {
  const sessions = new Set(rows.flatMap((row) => (row.sessionKey === null ? [] : [row.sessionKey])))
  return {
    ...rows.reduce((sum, row) => add(sum, stepsOf(row, plans)), ZERO),
    sessions: sessions.size,
  }
}

/** The funnel per assistant, in the host map's order, for every assistant that called. */
export function funnelByHost(
  rows: readonly CallRow[],
  plans: ReadonlyMap<string, PlanOutcome>,
): AiUsage['funnel'] {
  const byHost = new Map<McpHost, AiUsageCounts>()
  for (const row of rows) {
    byHost.set(row.host, add(byHost.get(row.host) ?? ZERO, stepsOf(row, plans)))
  }
  return [...byHost.entries()]
    .sort(([a], [b]) => (HOST_ORDER.get(a) ?? 0) - (HOST_ORDER.get(b) ?? 0))
    .map(([host, counts]) => ({
      host,
      steps: AI_USAGE_STEPS.map(({ step, label }) => ({ step, label, count: counts[step] })),
    }))
}

const DAY_MS = 86_400_000

/** Calls a day (UTC) per assistant, every day from `from` to `to` for each assistant that called. */
export function callSeries(rows: readonly CallRow[], from: Date, to: Date): AiUsage['series'] {
  const counts = new Map<string, number>()
  const hosts = new Set<McpHost>()
  for (const row of rows) {
    hosts.add(row.host)
    const key = `${row.calledAt.slice(0, 10)}|${row.host}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const days: string[] = []
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  for (let at = start; at < to.getTime(); at += DAY_MS) {
    days.push(new Date(at).toISOString().slice(0, 10))
  }
  const ordered = [...hosts].sort((a, b) => (HOST_ORDER.get(a) ?? 0) - (HOST_ORDER.get(b) ?? 0))
  return days.flatMap((day) =>
    ordered.map((host) => ({ day, host, calls: counts.get(`${day}|${host}`) ?? 0 })),
  )
}

/** The middle value; the mean of the two middle values for an even count. Null for none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const upper = sorted[mid] ?? 0
  return sorted.length % 2 === 1 ? upper : Math.round(((sorted[mid - 1] ?? 0) + upper) / 2)
}

/** Per tool, prompt or resource: calls, errors, gated and the median time, most called first. */
export function toolTable(rows: readonly CallRow[]): AiUsage['tools'] {
  const byName = new Map<string, CallRow[]>()
  for (const row of rows) byName.set(row.name, [...(byName.get(row.name) ?? []), row])
  return [...byName.entries()]
    .map(([name, calls]) => ({
      name,
      calls: calls.length,
      errors: calls.filter((row) => row.outcome === 'error').length,
      gated: calls.filter((row) => row.outcome === 'gated').length,
      medianMs: median(calls.map((row) => row.ms)),
    }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
}

const tally = <T extends string>(values: readonly T[]): [T, number][] => {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** The figures the gate held the card back for, most often first. */
export function gateMissingTally(rows: readonly CallRow[]): AiUsage['gateMissing'] {
  return tally(rows.flatMap((row) => row.gateMissing)).map(([figure, count]) => ({
    figure,
    count,
  }))
}

/** The raw user agents behind `other`, most often first; at most twenty. */
export function otherUserAgents(rows: readonly CallRow[]): AiUsage['userAgents'] {
  return tally(
    rows.filter((row) => row.host === 'other').map((row) => row.userAgent ?? '(none sent)'),
  )
    .slice(0, 20)
    .map(([userAgent, count]) => ({ userAgent, count }))
}

/** The cursor for the page after this call: its time and id, newest first. */
export const cursorOf = (call: Pick<AiUsageCall, 'calledAt' | 'id'>): string =>
  Buffer.from(`${call.calledAt}|${call.id}`).toString('base64url')

/** The time and id in a cursor, or null when it is not one this route gave out. */
export function parseCursor(cursor: string): { calledAt: string; id: string } | null {
  const [calledAt, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  if (calledAt === undefined || id === undefined || rest.length > 0) return null
  if (Number.isNaN(Date.parse(calledAt))) return null
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  return { calledAt, id }
}
