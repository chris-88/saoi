import type { Card } from '@shared/contracts/cards.ts'
import { planContextFor, proposePlan } from '@shared/db/plans.ts'
import { blueprintFor } from '@shared/domain/goals/catalogue.ts'
import { wouldContend } from '@shared/domain/goals/engine.ts'
import { planDraftFor } from '@shared/domain/goals/plan.ts'
import { depositGap } from '@shared/domain/needs/catalogue.ts'
import type { ToolModule } from './_shared.ts'
import { money } from './_shared.ts'

/**
 * §10 — propose, never impose.
 *
 * The model picks the goal and the words; every figure comes from the plan
 * engine. A projected date is something the customer will act on, so it is not
 * the model's to invent (§40).
 */
export const proposePlanTool: ToolModule<'propose_plan'> = {
  name: 'propose_plan',
  async run(input, ctx) {
    const { admin, turn, loaded, goalContext, needContext } = ctx

    const input_ = input

    const context = planContextFor(loaded)
    const gap = needContext === null ? null : depositGap(needContext)

    /**
     * A goal does not have to be about money.
     *
     * This used to refuse any plan without a target, which meant "get ready for the
     * baby" or "organise the bills" could not be planned at all — both of which are
     * exactly what a concierge is for. A goal whose blueprint has money milestones
     * still needs a figure; one whose milestones are facts and applications does not.
     */
    const blueprint = blueprintFor(input_.goal)
    const needsFigure =
      blueprint?.milestones.some((candidate) => candidate.binding?.kind === 'numeric') ?? false
    /*
     * The deposit gap stands in for a target only on a goal that saves towards one.
     * It used to fill in for every goal, so a mortgage switch on an €850,000 house
     * got an €85,000 "deposit" nobody had mentioned, and keeping the plan wrote it
     * down as a fact (case eb37e9b5).
     */
    const target = input_.targetAmount ?? (needsFigure ? (gap?.target ?? null) : null)

    if (target === null && needsFigure) {
      return {
        result:
          'There is nothing measurable to plan towards yet. Find out what they are aiming for first.',
        refused: true,
      }
    }

    /*
     * A target they have already passed is not a plan.
     *
     * Somebody with €60,000 against a €320,000 house was offered a plan to save
     * €32,000 — ten per cent of the price, which is what `depositGap` assumes when
     * nobody has said otherwise — and the card rendered "€60,000 of €32,000, 100%"
     * on a goal two years away. The figure was not wrong so much as beside the
     * point: they had said they wanted to save more, and nobody had asked what for.
     */
    if (target !== null && gap !== null && target <= gap.saved) {
      return {
        result:
          `They already have ${money(gap.saved)} towards this, which is more than the ` +
          `${money(target)} in that plan — so there is nothing to save towards and the ` +
          'card would show it finished. Ask what they are actually aiming for before ' +
          'planning towards a figure. A bigger deposit means less borrowing and a ' +
          'better rate, so "more than the minimum" is a real answer worth pinning down.',
        refused: true,
      }
    }

    /*
     * Whether this plan can actually be watched.
     *
     * A savings goal is watched by looking at the balance, and the bank can only see
     * accounts it holds — `plan_watches` is deliberately only written once a savings
     * account exists. That has always been true and nothing ever said it, so Saoirse
     * promised to come back to somebody who banked elsewhere.
     */
    const watchesAnAmount = target !== null
    const holdsSavings = loaded.applications.some((a) => a.product === 'savings')

    const existing = await admin
      .from('plans')
      .select('id, goal')
      .eq('case_id', turn.caseId)
      .in('status', ['draft', 'active'])

    if (existing.error) throw new Error(`plans: ${existing.error.message}`)
    const open = (existing.data ?? []) as { id: string; goal: string }[]

    if (open.some((plan) => plan.goal === input_.goal)) {
      return {
        result:
          'They already have a plan for this goal. Talk about that one rather than starting another.',
        refused: true,
      }
    }

    /**
     * §10 — the same money cannot be promised twice.
     *
     * Asked before the plan is written, so the clash is not announced in the same
     * breath as confirming the plan that caused it. The engine raises it; what the
     * customer's savings are actually for is their call, not the bank's.
     */
    if (goalContext !== null && wouldContend(goalContext, input_.goal, target)) {
      return {
        result:
          'That would have two plans counting on the same savings. Say so plainly, ' +
          'and ask which one the money is for before proposing anything.',
        refused: true,
      }
    }

    const rawDate = input_.targetDate ?? null
    const draft = planDraftFor({
      goal: input_.goal,
      title: input_.title,
      targetAmount: target,
      // A month without a day is not a date the engine can measure against.
      targetDate: rawDate === null || rawDate.length === 7 ? null : rawDate,
      today: context.today,
    })

    if (draft === null) {
      return { result: 'That is not a goal I can plan for.', refused: true }
    }

    const planId = await proposePlan(admin, turn.caseId, draft)
    if (planId === null) {
      return { result: 'That plan could not be saved just now.', refused: true }
    }

    const months =
      target !== null && context.monthlySaving !== null && context.monthlySaving > 0
        ? Math.ceil(Math.max(0, target - (context.savingsBalance ?? 0)) / context.monthlySaving)
        : null

    const first = draft.checkins[0] ?? null

    const card: Card = {
      type: 'plan_proposal',
      planId,
      title: draft.title,
      targetAmount: target,
      currentAmount: context.savingsBalance,
      projectedDate: null,
      monthsRemaining: months,
      milestones: draft.milestones.map((milestone) => ({
        label: milestone.label,
        achieved: false,
      })),
      checkin:
        first === null
          ? null
          : {
              purpose: first.purpose,
              when:
                first.triggerKind === 'event'
                  ? 'when you reach the target'
                  : (first.dueAt ?? 'later'),
              agenda: [...first.agenda],
            },
      confirmLabel: 'Keep this plan',
    }

    return {
      result:
        'Plan proposed. It is a draft and belongs to nobody until they tap it. ' +
        'Explain what it does for them in a sentence; do not list the milestones ' +
        'back.' +
        (watchesAnAmount && !holdsSavings
          ? ' This one waits on an amount, and they have no savings account here, ' +
            'so nothing can see the balance and nobody will be able to come back to ' +
            'them. Say so plainly — the plan still stands, it just cannot be watched ' +
            'unless the saving happens here. Do not oversell it.'
          : ''),
      card,
    }
  },
}
