import type { Database } from './database.types.ts'
import { type Db, writeEvent } from './case-repository.ts'
import { createReminder, deleteReminder } from './alerts.ts'
import {
  HOLDING_KINDS,
  HOLDING_SOURCES,
  type Holding,
  type UpdateHoldingBody,
} from '../contracts/holdings.ts'
import type { MarketPlan } from '../contracts/market-plan.ts'
import { holdingsFromPlan, reminderForHolding } from '../domain/market/holdings.ts'

/**
 * A case's holdings (`holdings`), read and written on the service role. Shared by the API's
 * holdings routes and the Saoirse turn (`record_holding`, the digest). Every write keeps the
 * holding's reminder in step: a `fixed_until` date has one, a changed date replaces it (so
 * every stage is sent for the new date), and clearing the date or deleting the holding deletes it.
 */

type HoldingRow = Database['public']['Tables']['holdings']['Row']
type Actor = 'customer' | 'model'

const iso = (value: string): string => new Date(value).toISOString()
const numberOrNull = (value: number | null): number | null =>
  value === null ? null : Number(value)
const isKind = (value: string): value is Holding['kind'] =>
  (HOLDING_KINDS as readonly string[]).includes(value)
const isSource = (value: string): value is Holding['source'] =>
  (HOLDING_SOURCES as readonly string[]).includes(value)

export function holdingFromRow(row: HoldingRow): Holding | null {
  if (!isKind(row.kind) || !isSource(row.source)) return null
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    provider: row.provider,
    productId: row.product_id,
    balance: Number(row.balance),
    ratePct: numberOrNull(row.rate_pct),
    monthlyAmountEur: numberOrNull(row.monthly_amount_eur),
    fixedUntil: row.fixed_until,
    notedOn: row.noted_on,
    source: row.source,
    reminderId: row.reminder_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

/** The case's holdings that are not deleted, oldest first. */
export async function loadHoldings(db: Db, caseId: string): Promise<Holding[]> {
  const result = await db
    .from('holdings')
    .select('*')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (result.error) throw new Error(`Could not read the holdings: ${result.error.message}`)
  return (result.data ?? []).flatMap((row) => {
    const holding = holdingFromRow(row)
    return holding === null ? [] : [holding]
  })
}

export type HoldingInput = {
  readonly kind: Holding['kind']
  readonly label: string
  readonly balance: number
  readonly ratePct?: number | undefined
  readonly monthlyAmountEur?: number | undefined
  readonly fixedUntil?: string | undefined
  readonly provider?: string | undefined
  readonly productId?: string | undefined
  readonly notedOn: string
}

type Context = {
  readonly caseId: string
  /** The participant acting, for the reminder's `created_by`. */
  readonly participantId: string | null
  readonly actor: Actor
  /** YYYY-MM-DD in Europe/Dublin: a date before it gets no reminder. */
  readonly today: string
}

/** Keeps the reminder `holding` needs, replacing `previous` when it no longer matches. */
async function syncReminder(
  db: Db,
  context: Context,
  holding: Pick<Holding, 'kind' | 'label' | 'fixedUntil' | 'productId'>,
  previous: { readonly reminderId: string | null; readonly matches: boolean },
): Promise<string | null> {
  const wanted = reminderForHolding(holding, context.today)
  if (previous.reminderId !== null && wanted !== null && previous.matches) {
    return previous.reminderId
  }
  if (previous.reminderId !== null) {
    await deleteReminder(db, context.caseId, previous.reminderId)
  }
  if (wanted === null) return null
  const reminder = await createReminder(db, {
    caseId: context.caseId,
    kind: wanted.kind,
    label: wanted.label,
    dueOn: wanted.dueOn,
    productId: wanted.productId ?? undefined,
    createdBy: context.participantId,
    actor: context.actor,
  })
  return reminder.id
}

async function setReminderId(
  db: Db,
  caseId: string,
  id: string,
  reminderId: string | null,
): Promise<HoldingRow> {
  const result = await db
    .from('holdings')
    .update({ reminder_id: reminderId })
    .eq('case_id', caseId)
    .eq('id', id)
    .select('*')
    .single()
  if (result.error) throw new Error(`Could not link the reminder: ${result.error.message}`)
  return result.data
}

const parsed = (row: HoldingRow): Holding => {
  const holding = holdingFromRow(row)
  if (holding === null) throw new Error('Could not read the holding: unknown kind or source')
  return holding
}

export async function createHolding(
  db: Db,
  context: Context,
  input: HoldingInput,
): Promise<Holding> {
  const result = await db
    .from('holdings')
    .insert({
      case_id: context.caseId,
      kind: input.kind,
      label: input.label,
      provider: input.provider ?? null,
      product_id: input.productId ?? null,
      balance: input.balance,
      rate_pct: input.ratePct ?? null,
      monthly_amount_eur: input.monthlyAmountEur ?? null,
      fixed_until: input.fixedUntil ?? null,
      noted_on: input.notedOn,
      source: context.actor === 'model' ? 'saoirse' : 'customer',
    })
    .select('*')
    .single()
  if (result.error) throw new Error(`Could not save the holding: ${result.error.message}`)
  let row = result.data
  const reminderId = await syncReminder(db, context, parsed(row), {
    reminderId: null,
    matches: false,
  })
  if (reminderId !== null) row = await setReminderId(db, context.caseId, row.id, reminderId)
  await writeEvent(db, {
    caseId: context.caseId,
    type: 'holding_added',
    actor: context.actor,
    payload: { holdingId: row.id, kind: row.kind },
  })
  return parsed(row)
}

/** Changes a holding on this case; null when there is no such holding (or it is deleted). */
export async function updateHolding(
  db: Db,
  context: Context,
  id: string,
  patch: UpdateHoldingBody,
): Promise<Holding | null> {
  const current = await db
    .from('holdings')
    .select('*')
    .eq('case_id', context.caseId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (current.error) throw new Error(`Could not read the holding: ${current.error.message}`)
  if (current.data === null) return null
  const before = parsed(current.data)

  const balanceChanged = patch.balance !== undefined && patch.balance !== before.balance
  const update: Database['public']['Tables']['holdings']['Update'] = {
    updated_at: new Date().toISOString(),
    ...(patch.kind === undefined ? {} : { kind: patch.kind }),
    ...(patch.label === undefined ? {} : { label: patch.label }),
    ...(patch.balance === undefined ? {} : { balance: patch.balance }),
    ...(patch.ratePct === undefined ? {} : { rate_pct: patch.ratePct }),
    ...(patch.monthlyAmountEur === undefined ? {} : { monthly_amount_eur: patch.monthlyAmountEur }),
    ...(patch.fixedUntil === undefined ? {} : { fixed_until: patch.fixedUntil }),
    ...(patch.provider === undefined ? {} : { provider: patch.provider }),
    ...(patch.productId === undefined ? {} : { product_id: patch.productId }),
    // A new balance is true today unless they said when.
    ...(patch.notedOn !== undefined
      ? { noted_on: patch.notedOn }
      : balanceChanged
        ? { noted_on: context.today }
        : {}),
  }
  const result = await db
    .from('holdings')
    .update(update)
    .eq('case_id', context.caseId)
    .eq('id', id)
    .select('*')
    .single()
  if (result.error) throw new Error(`Could not change the holding: ${result.error.message}`)
  let row = result.data
  const after = parsed(row)

  const reminderId = await syncReminder(db, context, after, {
    reminderId: before.reminderId,
    matches:
      after.kind === before.kind &&
      after.label === before.label &&
      after.fixedUntil === before.fixedUntil &&
      after.productId === before.productId,
  })
  if (reminderId !== before.reminderId) {
    row = await setReminderId(db, context.caseId, id, reminderId)
  }
  await writeEvent(db, {
    caseId: context.caseId,
    type: 'holding_changed',
    actor: context.actor,
    payload: { holdingId: id, fields: Object.keys(patch) },
  })
  return parsed(row)
}

/** Deletes a holding on this case and its reminder (kept as deleted). False when there is none. */
export async function deleteHolding(db: Db, context: Context, id: string): Promise<boolean> {
  const result = await db
    .from('holdings')
    .update({ deleted_at: new Date().toISOString() })
    .eq('case_id', context.caseId)
    .eq('id', id)
    .is('deleted_at', null)
    .select('reminder_id')
  if (result.error) throw new Error(`Could not delete the holding: ${result.error.message}`)
  const rows = result.data ?? []
  if (rows.length === 0) return false
  const reminderId = rows[0]?.reminder_id ?? null
  if (reminderId !== null) await deleteReminder(db, context.caseId, reminderId)
  await writeEvent(db, {
    caseId: context.caseId,
    type: 'holding_deleted',
    actor: context.actor,
    payload: { holdingId: id },
  })
  return true
}

/**
 * The plan's savings and debts as the case's first holdings, once: a case that has ever had a
 * holding (deleted ones included) is left as it is. Returns how many were added.
 */
export async function seedHoldingsFromPlan(
  db: Db,
  input: {
    readonly caseId: string
    readonly planId: string
    readonly plan: MarketPlan
    readonly notedOn: string
  },
): Promise<number> {
  const existing = await db
    .from('holdings')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', input.caseId)
  if (existing.error) throw new Error(`Could not read the holdings: ${existing.error.message}`)
  if ((existing.count ?? 0) > 0) return 0
  const drafts = holdingsFromPlan(input.plan, input.notedOn)
  if (drafts.length === 0) return 0
  const result = await db.from('holdings').insert(
    drafts.map((draft) => ({
      case_id: input.caseId,
      kind: draft.kind,
      label: draft.label,
      provider: draft.provider,
      product_id: draft.productId,
      balance: draft.balance,
      rate_pct: draft.ratePct,
      monthly_amount_eur: draft.monthlyAmountEur,
      fixed_until: draft.fixedUntil,
      noted_on: draft.notedOn,
      source: draft.source,
    })),
  )
  if (result.error) throw new Error(`Could not seed the holdings: ${result.error.message}`)
  await writeEvent(db, {
    caseId: input.caseId,
    type: 'holdings_seeded',
    actor: 'customer',
    payload: { planId: input.planId, count: drafts.length },
  })
  return drafts.length
}
