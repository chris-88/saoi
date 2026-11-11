import type { Database, Json } from './database.types.ts'
import { type Db, mustWrite, writeEvent } from './case-repository.ts'
import { ALERT_KINDS, type PlanAlert, REMINDER_KINDS, type Reminder } from '../contracts/alerts.ts'

/**
 * A case's alerts and reminders (`plan_alerts`, `reminders`), read and written on the service
 * role. Shared by the API's alert routes and the Saoirse turn, which states unseen alerts first
 * and sets reminders through `set_reminder`.
 */

type AlertRow = Database['public']['Tables']['plan_alerts']['Row']
type ReminderRow = Database['public']['Tables']['reminders']['Row']

const iso = (value: string): string => new Date(value).toISOString()
const isAlertKind = (value: string): value is PlanAlert['kind'] =>
  (ALERT_KINDS as readonly string[]).includes(value)
const isReminderKind = (value: string): value is Reminder['kind'] =>
  (REMINDER_KINDS as readonly string[]).includes(value)

export function alertFromRow(row: AlertRow): PlanAlert | null {
  if (!isAlertKind(row.kind)) return null
  const data =
    row.data !== null && typeof row.data === 'object' && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : {}
  return {
    id: row.id,
    kind: row.kind,
    productId: row.product_id,
    reminderId: row.reminder_id,
    stage: row.stage,
    title: row.title,
    body: row.body,
    data,
    createdAt: iso(row.created_at),
    sentAt: row.sent_at === null ? null : iso(row.sent_at),
    seenAt: row.seen_at === null ? null : iso(row.seen_at),
  }
}

export function reminderFromRow(row: ReminderRow): Reminder | null {
  if (!isReminderKind(row.kind)) return null
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    dueOn: row.due_on,
    productId: row.product_id,
    createdAt: iso(row.created_at),
  }
}

/** The case's alerts, newest first; only the unseen ones when asked. */
export async function loadCaseAlerts(
  db: Db,
  caseId: string,
  options: { readonly unseenOnly?: boolean; readonly limit?: number } = {},
): Promise<PlanAlert[]> {
  let query = db.from('plan_alerts').select('*').eq('case_id', caseId)
  if (options.unseenOnly === true) query = query.is('seen_at', null)
  const result = await query.order('created_at', { ascending: false }).limit(options.limit ?? 100)
  if (result.error) throw new Error(`Could not read the alerts: ${result.error.message}`)
  return (result.data ?? []).flatMap((row) => {
    const alert = alertFromRow(row)
    return alert === null ? [] : [alert]
  })
}

/** The case's reminders that are not deleted, soonest first. */
export async function loadOpenReminders(db: Db, caseId: string): Promise<Reminder[]> {
  const result = await db
    .from('reminders')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('due_on', { ascending: true })
  if (result.error) throw new Error(`Could not read the reminders: ${result.error.message}`)
  return (result.data ?? []).flatMap((row) => {
    const reminder = reminderFromRow(row)
    return reminder === null ? [] : [reminder]
  })
}

/** Marks these alerts seen, once: an alert already seen keeps its first time. */
export async function markAlertsSeen(
  db: Db,
  caseId: string,
  ids: readonly string[],
  at: string = new Date().toISOString(),
): Promise<void> {
  if (ids.length === 0) return
  mustWrite(
    await db
      .from('plan_alerts')
      .update({ seen_at: at })
      .eq('case_id', caseId)
      .in('id', [...ids])
      .is('seen_at', null),
    'the alerts seen',
  )
}

export async function createReminder(
  db: Db,
  input: {
    readonly caseId: string
    readonly kind: Reminder['kind']
    readonly label: string
    readonly dueOn: string
    readonly productId?: string | undefined
    readonly createdBy: string | null
    readonly actor: 'customer' | 'model'
  },
): Promise<Reminder> {
  const result = await db
    .from('reminders')
    .insert({
      case_id: input.caseId,
      kind: input.kind,
      label: input.label,
      due_on: input.dueOn,
      product_id: input.productId ?? null,
      created_by: input.createdBy,
    })
    .select('*')
    .single()
  if (result.error) throw new Error(`Could not save the reminder: ${result.error.message}`)
  const reminder = reminderFromRow(result.data)
  if (reminder === null) throw new Error('Could not save the reminder: unknown kind')
  await writeEvent(db, {
    caseId: input.caseId,
    type: 'reminder_set',
    actor: input.actor,
    payload: { reminderId: reminder.id, kind: reminder.kind, dueOn: reminder.dueOn },
  })
  return reminder
}

/** Deletes a reminder on this case (kept as deleted, so a sent stage is never sent again). */
export async function deleteReminder(db: Db, caseId: string, id: string): Promise<boolean> {
  const result = await db
    .from('reminders')
    .update({ deleted_at: new Date().toISOString() })
    .eq('case_id', caseId)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  if (result.error) throw new Error(`Could not delete the reminder: ${result.error.message}`)
  const deleted = (result.data ?? []).length > 0
  if (deleted) {
    await writeEvent(db, {
      caseId,
      type: 'reminder_deleted',
      actor: 'customer',
      payload: { reminderId: id },
    })
  }
  return deleted
}

/** The data column, as written. */
export const alertData = (data: Readonly<Record<string, unknown>>): Json => data as Json
