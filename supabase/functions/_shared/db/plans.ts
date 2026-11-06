import { mustWrite } from './case-repository.ts'
import type { Db, Insert } from './case-repository.ts'
import type { Json } from './database.types.ts'
import type { LoadedCase } from './loaded-case.ts'
import type { Product } from '../domain/journey.ts'
import type { ApplicationState } from '../domain/state-machine.ts'
import {
  checkinDue,
  describeProjection,
  planProgress,
  reached,
  reachesSavingsTarget,
} from '../domain/plans/engine.ts'
import type {
  Checkin,
  Milestone,
  Plan,
  PlanContext,
  PlanDraft,
  PlanGoal,
  PlanProgress,
} from '../domain/plans/types.ts'
import type { FactKey } from '../domain/facts.ts'
import { caseFactReader, emptyFactReader } from './fact-reader.ts'

/**
 * Reading and writing plans.
 *
 * Only decisions cross this boundary in either direction. Progress and projections are
 * computed from the case on the way out and never persisted, so the plan on screen and the
 * balance it describes cannot drift apart.
 */

export type LoadedPlan = { readonly plan: Plan; readonly progress: PlanProgress }

export function planContextFor(loaded: LoadedCase, today = new Date()): PlanContext {
  /**
   * The newest value, not the first one in the array.
   *
   * `find` returns whatever Postgres happened to return first, which is usually the oldest
   * row — so a corrected balance was ignored in favour of the figure it replaced, and the
   * console reported reading back €46,000 immediately after setting €60,000. Superseding
   * should make this moot, but a reader that depends on another write having gone through is
   * a reader that is wrong whenever it has not. The requirement engine has always picked the
   * newest; this now does the same.
   */
  const read = (key: string): number | null => {
    const matching = loaded.facts
      .filter((candidate) => String(candidate.key) === key && candidate.supersededBy === null)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))

    const value = matching[0]?.value
    return typeof value === 'number' ? value : null
  }

  return {
    savingsBalance: read('assets.savingsBalance') ?? read('assets.depositAmount'),
    monthlySaving: read('goals.monthlySaving'),
    // `facts` milestones ask whether the case can answer something, so they read through the
    // same reader the requirement and needs engines use rather than a second way of reading.
    facts: caseFactReader(loaded) ?? emptyFactReader,
    today: today.toISOString().slice(0, 10),
  }
}

export async function loadPlans(
  client: Db,
  caseId: string,
  loaded: LoadedCase,
): Promise<readonly LoadedPlan[]> {
  const planRows = await client
    .from('plans')
    .select('id, goal, title, status, target_amount, target_date, last_confirmed_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true })

  // A failed query and an empty table look identical through `data ?? []`, which is how a
  // broken read presents as "this customer has no plans" rather than as an error.
  if (planRows.error) throw new Error(`plans: ${planRows.error.message}`)

  const plans = (planRows.data ?? []) as {
    id: string
    goal: string
    title: string
    status: string
    target_amount: number | null
    target_date: string | null
    last_confirmed_at: string | null
  }[]

  if (plans.length === 0) return []

  const ids = plans.map((plan) => plan.id)

  const [milestoneRows, checkinRows] = await Promise.all([
    client
      .from('plan_milestones')
      .select(
        'id, plan_id, kind, label, sort, target_amount, target_date, target_product, target_state, target_facts, state, achieved_at',
      )
      .in('plan_id', ids)
      .order('sort', { ascending: true }),
    client
      .from('plan_checkins')
      .select('id, plan_id, purpose, agenda, trigger_kind, due_at, trigger_event, state')
      .in('plan_id', ids),
  ])

  if (milestoneRows.error) throw new Error(`plan_milestones: ${milestoneRows.error.message}`)
  if (checkinRows.error) throw new Error(`plan_checkins: ${checkinRows.error.message}`)

  const context = planContextFor(loaded)

  return plans.map((row) => {
    const milestones: Milestone[] = ((milestoneRows.data ?? []) as Record<string, unknown>[])
      .filter((milestone) => milestone['plan_id'] === row.id)
      .map((milestone) => ({
        id: String(milestone['id']),
        kind: milestone['kind'] as Milestone['kind'],
        label: String(milestone['label']),
        sort: Number(milestone['sort'] ?? 0),
        targetAmount:
          milestone['target_amount'] === null ? null : Number(milestone['target_amount']),
        targetDate: (milestone['target_date'] as string | null) ?? null,
        targetProduct: (milestone['target_product'] as Product | null) ?? null,
        targetState: (milestone['target_state'] as ApplicationState | null) ?? null,
        targetFacts: (milestone['target_facts'] as readonly FactKey[] | null) ?? null,
        state: milestone['state'] as Milestone['state'],
        achievedAt: (milestone['achieved_at'] as string | null) ?? null,
      }))

    const checkins: Checkin[] = ((checkinRows.data ?? []) as Record<string, unknown>[])
      .filter((checkin) => checkin['plan_id'] === row.id)
      .map((checkin) => ({
        id: String(checkin['id']),
        purpose: String(checkin['purpose']),
        agenda: Array.isArray(checkin['agenda']) ? (checkin['agenda'] as string[]) : [],
        triggerKind: checkin['trigger_kind'] as 'date' | 'event',
        dueAt: (checkin['due_at'] as string | null) ?? null,
        triggerEvent: (checkin['trigger_event'] as string | null) ?? null,
        state: checkin['state'] as Checkin['state'],
      }))

    const plan: Plan = {
      id: row.id,
      goal: row.goal as PlanGoal,
      title: row.title,
      status: row.status as Plan['status'],
      targetAmount: row.target_amount === null ? null : Number(row.target_amount),
      targetDate: row.target_date,
      milestones,
      checkins,
      applications: loaded.applications.map((application) => ({
        product: application.product,
        state: application.state,
      })),
      lastConfirmedAt: row.last_confirmed_at,
    }

    return { plan, progress: planProgress(plan, context) }
  })
}

/**
 * Catch the plan up with what has actually happened.
 *
 * Milestone state is stored because "when did they reach it" is a fact about the past, but
 * whether the condition holds is computed — so this is the one place the two meet. Returns
 * what changed, so the caller can write events for the things a customer would recognise.
 */
export async function reconcilePlans(
  client: Db,
  caseId: string,
  loaded: LoadedCase,
): Promise<readonly { planId: string; milestone: Milestone; reachedTarget: boolean }[]> {
  const plans = await loadPlans(client, caseId, loaded)

  const context = planContextFor(loaded)
  const achieved: { planId: string; milestone: Milestone; reachedTarget: boolean }[] = []

  for (const { plan } of plans) {
    if (plan.status !== 'active') continue

    for (const milestone of plan.milestones) {
      if (milestone.state === 'achieved' || milestone.state === 'no_longer_relevant') continue
      if (!reached(milestone, context, [...plan.applications])) continue

      mustWrite(
        await client
          .from('plan_milestones')
          .update({ state: 'achieved', achieved_at: new Date().toISOString() })
          .eq('id', milestone.id),
        'the plan_milestones record',
      )

      achieved.push({
        planId: plan.id,
        milestone,
        reachedTarget: reachesSavingsTarget(plan, milestone),
      })
    }
  }

  return achieved
}

/**
 * Bring any check-in whose moment has arrived into `due`.
 *
 * Separate from noticing it is due, because becoming due is a thing that happened and wants
 * recording, whereas being due is a state anything can evaluate. Returns what changed so the
 * caller can write the event that brings the customer back.
 */
export async function raiseDueCheckins(
  client: Db,
  caseId: string,
  loaded: LoadedCase,
  firedEvents: readonly string[] = [],
): Promise<readonly { plan: Plan; checkin: Checkin }[]> {
  const plans = await loadPlans(client, caseId, loaded)
  const due = dueCheckins(plans, loaded, firedEvents).filter(
    ({ checkin }) => checkin.state === 'scheduled',
  )

  for (const { checkin } of due) {
    mustWrite(
      await client.from('plan_checkins').update({ state: 'due' }).eq('id', checkin.id),
      'the check-in',
    )
  }

  return due
}

/** Check-ins whose moment has arrived, so Saoirse has a reason to speak rather than an excuse. */
export function dueCheckins(
  plans: readonly LoadedPlan[],
  loaded: LoadedCase,
  firedEvents: readonly string[] = [],
): readonly { plan: Plan; checkin: Checkin }[] {
  const context = planContextFor(loaded)

  return plans
    .filter(({ plan }) => plan.status === 'active')
    .flatMap(({ plan }) =>
      plan.checkins
        .filter((checkin) => checkinDue(checkin, context, firedEvents))
        .map((checkin) => ({ plan, checkin })),
    )
}

/**
 * Writes a proposal. `draft` until the customer says yes — §10 is explicit that Saoirse must not
 * silently create a persistent plan, so proposing and accepting are separate events.
 */
export async function proposePlan(
  client: Db,
  caseId: string,
  draft: PlanDraft,
): Promise<string | null> {
  const created = await client
    .from('plans')
    .insert({
      case_id: caseId,
      goal: draft.goal,
      title: draft.title,
      status: 'draft',
      target_amount: draft.targetAmount,
      target_date: draft.targetDate,
    } satisfies Insert<'plans'>)
    .select('id')
    .single()

  const planId = (created.data as { id?: string } | null)?.id
  if (planId === undefined) return null

  if (draft.milestones.length > 0) {
    const written = await client.from('plan_milestones').insert(
      draft.milestones.map((milestone, index) => ({
        plan_id: planId,
        kind: milestone.kind,
        label: milestone.label,
        sort: index,
        target_amount: milestone.targetAmount,
        target_date: milestone.targetDate,
        target_product: milestone.targetProduct,
        target_state: milestone.targetState,
        target_facts: (milestone.targetFacts ?? null) as unknown as Json,
      })),
    )

    // A plan whose milestones failed to write is a plan with no route at all, and an unread
    // `.error` here is exactly how a no-op once reported success. Fail the proposal instead.
    if (written.error) throw new Error(`plan_milestones: ${written.error.message}`)
  }

  if (draft.checkins.length > 0) {
    const written = await client.from('plan_checkins').insert(
      draft.checkins.map((checkin) => ({
        plan_id: planId,
        purpose: checkin.purpose,
        agenda: checkin.agenda as unknown as Json,
        trigger_kind: checkin.triggerKind,
        due_at: checkin.dueAt,
        trigger_event: checkin.triggerEvent,
      })),
    )

    if (written.error) throw new Error(`plan_checkins: ${written.error.message}`)
  }

  return planId
}

/** What the model is told about the plan, in words it can use without doing arithmetic. */
export function describePlan({ plan, progress }: LoadedPlan): readonly string[] {
  const lines = [`${plan.title} — ${plan.status}`]

  const projection = describeProjection(progress)
  if (projection !== null) lines.push(projection)

  if (progress.nextMilestone !== null) {
    lines.push(`Next milestone: ${progress.nextMilestone.label}.`)
  }

  const done = plan.milestones.filter((milestone) => milestone.state === 'achieved')
  if (done.length > 0) {
    lines.push(`Already reached: ${done.map((milestone) => milestone.label).join(', ')}.`)
  }

  if (progress.nextCheckin !== null) {
    const when =
      progress.nextCheckin.dueAt === null
        ? `when ${progress.nextCheckin.triggerEvent ?? 'something changes'}`
        : progress.nextCheckin.dueAt.slice(0, 10)
    lines.push(`Next check-in: ${progress.nextCheckin.purpose}, ${when}.`)
  }

  return lines
}
