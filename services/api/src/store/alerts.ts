import type { Database } from '@shared/db/database.types.ts'
import {
  alertData,
  alertFromRow,
  createReminder,
  deleteReminder,
  loadCaseAlerts,
  loadOpenReminders,
  markAlertsSeen,
  reminderFromRow,
} from '@shared/db/alerts.ts'
import { marketPlanSchema, upgradeStoredPlan } from '@shared/contracts/market-plan.ts'
import type { PlanAlert, Reminder } from '@shared/contracts/alerts.ts'
import { marketRatesSchema } from '@shared/market/schema.ts'
import {
  type AlertDraft,
  type ClaimedPlanRef,
  type ProductChange,
  type ReminderRef,
  headlineRate,
} from '@shared/domain/market/alerts.ts'
import type { Db } from './client.ts'

/**
 * Plan alerts and reminders (`plan_alerts`, `reminders`, `alert_runs`). The run reads market
 * changes since the last run and the claimed plans; the case routes read and write one case's
 * rows through the shared helpers the turn uses too.
 */
export type AlertStore = {
  /** Where the last run stopped; null before the first run. */
  lastThroughAt(): Promise<string | null>
  /** When the earliest claimed plan was built: the first run looks back to it. */
  earliestClaimedAt(): Promise<string | null>
  /** Versions superseded in (since, until]: a successor, or none (withdrawn). */
  changesBetween(sinceIso: string, untilIso: string): Promise<ProductChange[]>
  claimedPlans(): Promise<ClaimedPlanRef[]>
  openReminders(): Promise<ReminderRef[]>
  /** `${reminderId}:${stage}` for every reminder alert already raised for these reminders. */
  sentStages(reminderIds: readonly string[]): Promise<ReadonlySet<string>>
  /** Inserts each draft unless already raised; returns the ones inserted now. */
  insertAlerts(
    drafts: readonly AlertDraft[],
  ): Promise<{ readonly caseId: string; readonly alert: PlanAlert }[]>
  markSent(alertId: string, at: string): Promise<void>
  recordRun(throughAt: string): Promise<void>

  listForCase(caseId: string): Promise<{ alerts: PlanAlert[]; reminders: Reminder[] }>
  markSeen(caseId: string, ids: readonly string[]): Promise<void>
  createReminder(input: {
    caseId: string
    kind: Reminder['kind']
    label: string
    dueOn: string
    productId?: string | undefined
    createdBy: string | null
  }): Promise<Reminder>
  deleteReminder(caseId: string, id: string): Promise<boolean>
}

const PAGE = 1000
const UNIQUE_VIOLATION = '23505'

type MarketRow = Pick<
  Database['public']['Tables']['market_products']['Row'],
  | 'id'
  | 'provider'
  | 'source'
  | 'product_id'
  | 'rates'
  | 'source_url'
  | 'effective_from'
  | 'first_seen_at'
  | 'checked_at'
  | 'superseded_at'
>
const MARKET_ALERT_COLUMNS =
  'id, provider, source, product_id, rates, source_url, effective_from, first_seen_at, checked_at, superseded_at'

const rateOf = (rates: unknown): number | null => {
  const parsed = marketRatesSchema.safeParse(rates)
  return parsed.success ? headlineRate(parsed.data) : null
}
const iso = (value: string): string => new Date(value).toISOString()
const sourceOf = (value: string): 'bank' | 'ccpc' => (value === 'ccpc' ? 'ccpc' : 'bank')
const keyOf = (row: { provider: string; source: string; product_id: string }) =>
  `${row.provider}|${row.source}|${row.product_id}`

/**
 * Pairs each version superseded in the window with its successor: the same product's row first
 * seen at or after the moment it was superseded (the refresh sets both to the same instant). No
 * successor means the refresh retired it.
 */
export function pairChanges(
  superseded: readonly MarketRow[],
  later: readonly MarketRow[],
): ProductChange[] {
  const byKey = new Map<string, MarketRow[]>()
  for (const row of later) byKey.set(keyOf(row), [...(byKey.get(keyOf(row)) ?? []), row])
  return superseded.flatMap((previous) => {
    if (previous.superseded_at === null) return []
    const at = Date.parse(previous.superseded_at)
    const next = (byKey.get(keyOf(previous)) ?? [])
      .filter((row) => row.id !== previous.id && Date.parse(row.first_seen_at) >= at)
      .sort((a, b) => Date.parse(a.first_seen_at) - Date.parse(b.first_seen_at))[0]
    return [
      {
        provider: previous.provider,
        source: sourceOf(previous.source),
        productId: previous.product_id,
        previousVersionId: previous.id,
        currentVersionId: next?.id ?? null,
        previousRate: rateOf(previous.rates),
        currentRate: next === undefined ? null : rateOf(next.rates),
        effectiveFrom: next?.effective_from ?? null,
        changedAt: iso(previous.superseded_at),
        sourceUrl: (next ?? previous).source_url,
        checkedAt: iso((next ?? previous).checked_at),
        withdrawn: next === undefined,
      },
    ]
  })
}

export function supabaseAlertStore(db: Db): AlertStore {
  const pages = async <T>(
    load: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
    what: string,
  ): Promise<T[]> => {
    const rows: T[] = []
    for (let from = 0; ; from += PAGE) {
      const page = await load(from, from + PAGE - 1)
      if (page.error) throw new Error(`Could not read ${what}: ${page.error.message}`)
      rows.push(...(page.data ?? []))
      if ((page.data ?? []).length < PAGE) break
    }
    return rows
  }

  return {
    async lastThroughAt() {
      const result = await db
        .from('alert_runs')
        .select('through_at')
        .order('through_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (result.error) throw new Error(`Could not read the last run: ${result.error.message}`)
      return result.data === null ? null : iso(result.data.through_at)
    },

    async earliestClaimedAt() {
      const result = await db
        .from('saved_plans')
        .select('created_at')
        .not('case_id', 'is', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (result.error) throw new Error(`Could not read the plans: ${result.error.message}`)
      return result.data === null ? null : iso(result.data.created_at)
    },

    async changesBetween(sinceIso, untilIso) {
      const superseded = await pages<MarketRow>(
        (from, to) =>
          db
            .from('market_products')
            .select(MARKET_ALERT_COLUMNS)
            .gt('superseded_at', sinceIso)
            .lte('superseded_at', untilIso)
            .order('id', { ascending: true })
            .range(from, to),
        'superseded market rows',
      )
      if (superseded.length === 0) return []
      const productIds = [...new Set(superseded.map((row) => row.product_id))]
      const later: MarketRow[] = []
      for (let i = 0; i < productIds.length; i += 200) {
        later.push(
          ...(await pages<MarketRow>(
            (from, to) =>
              db
                .from('market_products')
                .select(MARKET_ALERT_COLUMNS)
                .in('product_id', productIds.slice(i, i + 200))
                .gt('first_seen_at', sinceIso)
                .order('id', { ascending: true })
                .range(from, to),
            'later market rows',
          )),
        )
      }
      return pairChanges(superseded, later)
    },

    async claimedPlans() {
      const rows = await pages<{ case_id: string | null; document: unknown; created_at: string }>(
        (from, to) =>
          db
            .from('saved_plans')
            .select('case_id, document, created_at')
            .not('case_id', 'is', null)
            .order('created_at', { ascending: true })
            .range(from, to),
        'claimed plans',
      )
      return rows.flatMap((row) => {
        if (row.case_id === null) return []
        const plan = marketPlanSchema.safeParse(upgradeStoredPlan(row.document))
        if (!plan.success) return []
        const caseId = row.case_id
        // The products the customer chose on the cards (2026-11-13) are watched too, from when
        // each was chosen: a change before then was already in what the card showed.
        const chosen = Object.values(plan.data.choices ?? {}).flatMap((choice) =>
          choice?.watches === undefined || choice.watches.length === 0
            ? []
            : [
                {
                  caseId,
                  builtAt: iso(choice.chosenAt),
                  products: choice.watches.map((watch) => ({
                    provider: watch.provider,
                    source: watch.source,
                    productId: watch.productId,
                    providerName: choice.lead,
                    productName: choice.lead,
                    ratePct: watch.ratePct,
                  })),
                },
              ],
        )
        return [
          {
            caseId,
            builtAt: iso(plan.data.createdAt),
            products: plan.data.combination.products.map((product) => ({
              provider: product.provider,
              source: product.source,
              productId: product.productId,
              providerName: product.providerName,
              productName: product.productName,
              ratePct: product.ratePct,
            })),
          },
          ...chosen,
        ]
      })
    },

    async openReminders() {
      const rows = await pages<Database['public']['Tables']['reminders']['Row']>(
        (from, to) =>
          db
            .from('reminders')
            .select('*')
            .is('deleted_at', null)
            .order('due_on', { ascending: true })
            .range(from, to),
        'reminders',
      )
      return rows.flatMap((row) => {
        const reminder = reminderFromRow(row)
        return reminder === null
          ? []
          : [
              {
                id: reminder.id,
                caseId: row.case_id,
                kind: reminder.kind,
                label: reminder.label,
                dueOn: reminder.dueOn,
              },
            ]
      })
    },

    async sentStages(reminderIds) {
      const sent = new Set<string>()
      for (let i = 0; i < reminderIds.length; i += 200) {
        const result = await db
          .from('plan_alerts')
          .select('reminder_id, stage')
          .in('reminder_id', reminderIds.slice(i, i + 200))
        if (result.error) throw new Error(`Could not read sent stages: ${result.error.message}`)
        for (const row of result.data ?? []) {
          if (row.reminder_id !== null && row.stage !== null) {
            sent.add(`${row.reminder_id}:${String(row.stage)}`)
          }
        }
      }
      return sent
    },

    async insertAlerts(drafts) {
      // One at a time: the idempotency indexes are partial, which PostgREST's ON CONFLICT
      // cannot name, so a duplicate is the unique violation and is skipped.
      const inserted: { caseId: string; alert: PlanAlert }[] = []
      for (const draft of drafts) {
        const result = await db
          .from('plan_alerts')
          .insert({
            case_id: draft.caseId,
            kind: draft.kind,
            product_id: draft.productId,
            product_version: draft.productVersion,
            reminder_id: draft.reminderId,
            stage: draft.stage,
            title: draft.title,
            body: draft.body,
            data: alertData(draft.data),
          })
          .select('*')
          .single()
        if (result.error) {
          if (result.error.code === UNIQUE_VIOLATION) continue
          throw new Error(`Could not raise the alert: ${result.error.message}`)
        }
        const alert = alertFromRow(result.data)
        if (alert !== null) inserted.push({ caseId: draft.caseId, alert })
      }
      return inserted
    },

    async markSent(alertId, at) {
      const result = await db.from('plan_alerts').update({ sent_at: at }).eq('id', alertId)
      if (result.error) throw new Error(`Could not mark the alert sent: ${result.error.message}`)
    },

    async recordRun(throughAt) {
      const result = await db.from('alert_runs').insert({ through_at: throughAt })
      if (result.error) throw new Error(`Could not record the run: ${result.error.message}`)
    },

    async listForCase(caseId) {
      const [alerts, reminders] = await Promise.all([
        loadCaseAlerts(db, caseId),
        loadOpenReminders(db, caseId),
      ])
      return { alerts, reminders }
    },

    markSeen: (caseId, ids) => markAlertsSeen(db, caseId, ids),

    createReminder: (input) => createReminder(db, { ...input, actor: 'customer' }),

    deleteReminder: (caseId, id) => deleteReminder(db, caseId, id),
  }
}
