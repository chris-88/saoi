import { createHolding, loadHoldings, updateHolding } from '@shared/db/holdings.ts'
import { loadClaimedPlans } from '@shared/db/saved-plans.ts'
import { holdingLine, planProgress } from '@shared/domain/market/holdings.ts'
import type { ToolModule } from './_shared.ts'

/** Today in Europe/Dublin, YYYY-MM-DD: the day a stated balance is noted on. */
const dublinToday = (now: Date = new Date()): string =>
  now.toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' })

/**
 * An account or a debt the customer stated with its balance, recorded as they said it, like
 * `record_facts`: a new holding, or (with `holdingId` from the digest) a change to one held.
 * A fixed-until date keeps the matching reminder. The result carries the progress line against
 * the claimed plan, a fact for Saoirse to state without praise. No card.
 */
export const recordHoldingTool: ToolModule<'record_holding'> = {
  name: 'record_holding',
  async run(input, ctx) {
    const today = dublinToday()
    const context = {
      caseId: ctx.turn.caseId,
      participantId: ctx.primary,
      actor: 'model' as const,
      today,
    }
    const optional = {
      ...(input.ratePct === undefined ? {} : { ratePct: input.ratePct }),
      ...(input.monthlyAmountEur === undefined ? {} : { monthlyAmountEur: input.monthlyAmountEur }),
      ...(input.fixedUntil === undefined ? {} : { fixedUntil: input.fixedUntil }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.productId === undefined ? {} : { productId: input.productId }),
    }
    try {
      const holding =
        input.holdingId === undefined
          ? await createHolding(ctx.admin, context, {
              kind: input.kind,
              label: input.label,
              balance: input.balance,
              notedOn: today,
              ...optional,
            })
          : await updateHolding(ctx.admin, context, input.holdingId, {
              kind: input.kind,
              label: input.label,
              balance: input.balance,
              ...optional,
            })
      if (holding === null) {
        return {
          result:
            'No holding with that id on this case. Use an id from "What they hold", or leave ' +
            'holdingId out to add a new one.',
          refused: true,
        }
      }

      const [held, claimed] = await Promise.all([
        loadHoldings(ctx.admin, ctx.turn.caseId),
        loadClaimedPlans(ctx.admin, ctx.turn.caseId),
      ])
      const plan = claimed.at(-1)
      const progress = plan === undefined ? null : planProgress(plan.plan, held, today)
      const reminder =
        holding.reminderId !== null
          ? ' A reminder is kept for the date: Saoi sends it 90, 60, 30 and 7 days before and on the day.'
          : holding.fixedUntil !== null
            ? ' The date has passed, so no reminder is kept.'
            : ''
      return {
        result:
          `${input.holdingId === undefined ? 'Recorded' : 'Changed'}: ${holdingLine(holding)}.${reminder}` +
          (progress === null ? '' : ` Progress against the plan: ${progress.line}`) +
          ' Say what was recorded and the progress in a line or two, as facts: no praise, no ' +
          'encouragement, nothing about what to do next.',
      }
    } catch {
      return { result: 'That could not be recorded just now.', refused: true }
    }
  },
}
