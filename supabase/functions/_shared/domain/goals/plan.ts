import type { CheckinDraft, MilestoneDraft, PlanDraft } from '../plans/types.ts'
import { blueprintFor } from './catalogue.ts'
import type { GoalBlueprint, GoalId } from './types.ts'

/**
 * A goal blueprint becomes a plan the customer could agree to.
 *
 * Before this, every plan got the same four milestones and the same check-in regardless of its
 * goal — a first-home deposit ladder and a mortgage readiness review, hard-coded in the tool
 * handler. Someone saving for a wedding got told their next step was a mortgage application.
 *
 * Nothing here writes anything. A draft is a proposal, and it stays `draft` until the customer
 * says yes (§6, Invariant 1).
 */

export type PlanProposal = {
  readonly goal: GoalId
  /** What to call it. Defaults to the blueprint's name, which is already in the customer's terms. */
  readonly title?: string
  /** What they agreed to reach. Null when the goal is not about an amount. */
  readonly targetAmount: number | null
  /** YYYY-MM-DD. Null when they have not named one. */
  readonly targetDate: string | null
  readonly today: string
}

export function planDraftFor(proposal: PlanProposal): PlanDraft | null {
  const blueprint = blueprintFor(proposal.goal)
  if (blueprint === undefined) {
    // `other` has no blueprint on purpose, so a plan for it is the title and the target alone.
    return proposal.goal === 'other'
      ? {
          goal: proposal.goal,
          title: proposal.title ?? 'Your plan',
          targetAmount: proposal.targetAmount,
          targetDate: proposal.targetDate,
          milestones: [],
          checkins: [],
        }
      : null
  }

  return {
    goal: blueprint.id,
    title: proposal.title ?? blueprint.name,
    targetAmount: proposal.targetAmount,
    targetDate: proposal.targetDate,
    milestones: milestonesFor(blueprint, proposal),
    checkins: checkinsFor(blueprint, proposal),
  }
}

/**
 * The blueprint's milestones with the customer's figures in them.
 *
 * A milestone the plan cannot evaluate is dropped rather than carried as something nobody can
 * ever tick: a money threshold with no target to be a share of, or a date marker with no date,
 * would sit on the plan forever looking like outstanding work. Milestones whose binding is
 * genuinely the customer's to confirm are kept, because those are real progress — selecting a
 * property is not something the bank gets to decide.
 */
export function milestonesFor(
  blueprint: GoalBlueprint,
  proposal: Pick<PlanProposal, 'targetAmount' | 'targetDate'>,
): readonly MilestoneDraft[] {
  const drafts: MilestoneDraft[] = []

  for (const milestone of blueprint.milestones) {
    const base = {
      label: milestone.label,
      targetAmount: null,
      targetDate: null,
      targetProduct: null,
      targetState: null,
      targetFacts: null,
    } as const

    if (milestone.binding === null) {
      drafts.push({ ...base, kind: 'customer' })
      continue
    }

    switch (milestone.binding.kind) {
      case 'numeric': {
        if (proposal.targetAmount === null || proposal.targetAmount <= 0) continue
        const amount = Math.round(proposal.targetAmount * milestone.binding.fraction)
        drafts.push({
          ...base,
          kind: 'numeric',
          // The figure belongs in the label: "halfway there" means nothing beside a balance.
          label: `${milestone.label} — €${amount.toLocaleString('en-IE')}`,
          targetAmount: amount,
        })
        continue
      }
      case 'date': {
        if (proposal.targetDate === null) continue
        drafts.push({ ...base, kind: 'date', targetDate: proposal.targetDate })
        continue
      }
      case 'application': {
        drafts.push({
          ...base,
          kind: 'application',
          targetProduct: milestone.binding.product,
          targetState: milestone.binding.state,
        })
        continue
      }
      case 'facts': {
        drafts.push({ ...base, kind: 'facts', targetFacts: milestone.binding.keys })
        continue
      }
    }
  }

  return drafts
}

/**
 * The blueprint's default check-ins, dated from today.
 *
 * Defaults only (§15). The customer owns their plan, so these are a starting point to be
 * changed or dropped — not a schedule the bank imposes to keep engagement up.
 */
export function checkinsFor(
  blueprint: GoalBlueprint,
  proposal: Pick<PlanProposal, 'today'>,
): readonly CheckinDraft[] {
  return blueprint.checkins.map((checkin): CheckinDraft => {
    if (checkin.kind === 'event') {
      return {
        purpose: checkin.purpose,
        agenda: checkin.agenda,
        triggerKind: 'event',
        dueAt: null,
        triggerEvent: checkin.event,
      }
    }

    return {
      purpose: checkin.purpose,
      agenda: checkin.agenda,
      triggerKind: 'date',
      dueAt: addMonths(proposal.today, checkin.everyMonths),
      triggerEvent: null,
    }
  })
}

/**
 * Months on from a YYYY-MM-DD date.
 *
 * Clamped to the end of the shorter month, so the 31st of January plus one month is the 28th of
 * February rather than the 3rd of March — a check-in that quietly slides forward is a check-in
 * that happens on the wrong day.
 */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return date

  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))

  return target.toISOString().slice(0, 10)
}
