import type { AlertsRunResponse } from '@shared/contracts/alerts.ts'
import { dueReminders, rateChangeAlerts, reminderAlert } from '@shared/domain/market/alerts.ts'
import type { Market } from '@shared/domain/market/types.ts'
import type { Logger } from '../../log.ts'
import type { AlertStore } from '../../store/alerts.ts'

/** Sends one push to every live subscription on the case; how many browsers it reached. */
export type AlertPush = (input: {
  caseId: string
  title: string
  body: string
}) => Promise<{ delivered: number }>

export type AlertRunDeps = {
  readonly store: AlertStore
  /** Today's market for the reminder lines; null leaves them without one. */
  readonly market: () => Promise<Market>
  /** Unset when push is not configured: alerts are kept for the next visit. */
  readonly push?: AlertPush | undefined
  readonly log: Logger
}

/**
 * One alerts run: market changes since the last run against every claimed plan, then the
 * reminders due today. Each new alert gets one push where the case has a live subscription; a
 * push that fails never fails the run, and `sent_at` is set only when a browser took it. The
 * run is recorded last, so a run that fails part way is read again from the same point next
 * time, and the unique indexes stop anything being raised twice.
 */
export async function runAlerts(
  deps: AlertRunDeps,
  at: { readonly nowIso: string; readonly today: string },
): Promise<AlertsRunResponse> {
  const { store, log } = deps
  const since = (await store.lastThroughAt()) ?? (await store.earliestClaimedAt())
  const throughAt = at.nowIso

  const [changes, plans] =
    since === null
      ? [[], []]
      : await Promise.all([store.changesBetween(since, throughAt), store.claimedPlans()])
  const rateDrafts = rateChangeAlerts(plans, changes)

  const reminders = await store.openReminders()
  const sent = await store.sentStages(reminders.map((reminder) => reminder.id))
  const due = dueReminders(reminders, at.today, (id, stage) => sent.has(`${id}:${String(stage)}`))
  const market =
    due.length === 0
      ? null
      : await deps.market().catch((error: unknown) => {
          log.warn('alerts run without market data', {
            error: error instanceof Error ? error.message : 'unknown',
          })
          return null
        })
  const reminderDrafts = due.map(({ reminder, stage, daysLeft }) =>
    reminderAlert(reminder, stage, daysLeft, market),
  )

  const raised = await store.insertAlerts([...rateDrafts, ...reminderDrafts])

  let pushed = 0
  let pushFailed = 0
  for (const { caseId, alert } of raised) {
    if (deps.push === undefined) {
      pushFailed += 1
      continue
    }
    try {
      const { delivered } = await deps.push({ caseId, title: alert.title, body: alert.body })
      if (delivered > 0) {
        await store.markSent(alert.id, new Date().toISOString())
        pushed += 1
      } else {
        pushFailed += 1
      }
    } catch (error) {
      pushFailed += 1
      log.warn('alert push failed', {
        alertId: alert.id,
        error: error instanceof Error ? error.message : 'unknown',
      })
    }
  }

  await store.recordRun(throughAt)
  return {
    throughAt,
    changes: changes.length,
    plans: plans.length,
    rateAlerts: raised.filter(({ alert }) => alert.kind !== 'reminder').length,
    reminderAlerts: raised.filter(({ alert }) => alert.kind === 'reminder').length,
    pushed,
    pushFailed,
  }
}
