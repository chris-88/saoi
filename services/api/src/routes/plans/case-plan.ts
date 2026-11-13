import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import {
  casePlanSchema,
  casePlanEditSchema,
  casePlanEditedSchema,
} from '@shared/contracts/case-plan.ts'
import { planProgress } from '@shared/domain/market/holdings.ts'
import { applyPlanEdit, casePlanOf, remindersToMove } from '@shared/domain/market/plan-edit.ts'
import type { Market } from '@shared/domain/market/types.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { requireCaseAccess } from '../../middleware/requireCaseAccess.ts'
import type { AlertStore } from '../../store/alerts.ts'
import type { HoldingStore } from '../../store/holdings.ts'
import type { PlanStore } from '../../store/plans.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { caseParams } from '../cases/params.ts'
import { dublinDate } from '../market/index.ts'

/**
 * The plan in the app's profile (2026-11-12, the first-home experience, "6. The saving months"):
 * read it, and change a figure in place. An edit rebuilds the claimed plan with the comparison
 * engine on the new figures, moves the reminders that came from its dates, and writes
 * `plan_edited` with `reading`, which the next return turn opens the conversation with. Primary
 * customer only. Balances stay on the holdings routes.
 */

export type CasePlanRouteOptions = {
  readonly plans: Pick<PlanStore, 'claimedPlan' | 'saveEdit'>
  /** Progress, and which reminders a holding keeps (those are not the plan's). */
  readonly holdings: Pick<HoldingStore, 'list'>
  readonly reminders: Pick<AlertStore, 'listForCase' | 'createReminder' | 'deleteReminder'>
  /** The whole market, as the comparison API reads it. */
  readonly market: () => Promise<Market>
  readonly now?: () => number
}

const NO_PLAN = 'This conversation has no plan.'

const getRoute = createRoute({
  method: 'get',
  path: '/api/cases/{caseId}/plan',
  tags: ['plans'],
  summary: 'The claimed plan, as the profile shows it',
  description:
    'The newest plan claimed into the case: the figures the profile can change in place, where ' +
    'it stands (the keys month, the cash needed, saved now and the progress line over the ' +
    'holdings), and its first three options in the customer’s order. Facts, never a pick. ' +
    'Primary customer only.',
  security,
  middleware: [requireCaseAccess] as const,
  request: { params: caseParams },
  responses: {
    200: {
      description: 'The plan.',
      content: { 'application/json': { schema: casePlanSchema.openapi('CasePlan') } },
    },
    ...authenticatedErrors,
    404: errorResponse('No such case for this caller, or it has no claimed plan.'),
  },
})

const patchRoute = createRoute({
  method: 'patch',
  path: '/api/cases/{caseId}/plan',
  tags: ['plans'],
  summary: 'Change a figure in the plan',
  description:
    'Changes one or more of the editable figures (a month not in the past; a price and a ' +
    'monthly saving above 0) and rebuilds the plan on them: the comparison re-runs on the new ' +
    'figures and the arrival, hook question included, is worked out again, on the filters and ' +
    'sort the plan was built with. Date reminders that came from the plan’s dates move with ' +
    'them. Writes `plan_edited`; the next return turn opens with `reading`, what changed and ' +
    'which options now fit. A body that changes nothing returns the plan as it is.',
  security,
  middleware: [requireCaseAccess] as const,
  request: {
    params: caseParams,
    body: {
      required: true,
      content: { 'application/json': { schema: casePlanEditSchema.openapi('CasePlanEdit') } },
    },
  },
  responses: {
    200: {
      description: 'The rebuilt plan, and what the change does.',
      content: {
        'application/json': { schema: casePlanEditedSchema.openapi('CasePlanEdited') },
      },
    },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid: a month passed, a figure not above 0, no figure.'),
    404: errorResponse('No such case for this caller, or it has no claimed plan.'),
  },
})

export function casePlanRoutes(options: CasePlanRouteOptions) {
  const now = options.now ?? Date.now
  const routes = new OpenAPIHono<AppEnv>()

  routes.openapi(getRoute, async (c) => {
    const { caseId } = c.req.valid('param')
    const claimed = await options.plans.claimedPlan(caseId)
    if (claimed === null) throw new ApiError('not_found', NO_PLAN)
    const holdings = await options.holdings.list(caseId)
    const progress = planProgress(claimed.plan, holdings, dublinDate(now()))
    return c.json(casePlanOf(claimed, progress), 200)
  })

  routes.openapi(patchRoute, async (c) => {
    const { caseId } = c.req.valid('param')
    const body = c.req.valid('json')
    const at = now()
    const today = dublinDate(at)
    if (body.targetDate !== undefined && body.targetDate < today.slice(0, 7)) {
      throw new ApiError('bad_request', 'That month has passed: give this month or a later one.')
    }

    const claimed = await options.plans.claimedPlan(caseId)
    if (claimed === null) throw new ApiError('not_found', NO_PLAN)
    const home = claimed.plan.goals.some((goal) => goal.kind === 'house_deposit')
    if (!home && (body.homePrice !== undefined || body.propertyKind !== undefined)) {
      throw new ApiError('bad_request', 'This plan is not for a home, so it has no price or kind.')
    }

    const market = await options.market()
    let result: ReturnType<typeof applyPlanEdit>
    try {
      result = applyPlanEdit(market, claimed.plan, body, today, new Date(at).toISOString())
    } catch (error) {
      throw new ApiError('internal', 'This plan could not be rebuilt.', { cause: error })
    }

    const holdings = await options.holdings.list(caseId)
    if (result === null) {
      return c.json(
        {
          ...casePlanOf(claimed, planProgress(claimed.plan, holdings, today)),
          reading: 'Nothing changed: the plan already has these figures.',
        },
        200,
      )
    }

    // The reminders that came from the plan's dates move with them (a new reminder, so every
    // stage is sent for the new date); a holding's own reminders stay with the holding.
    const { reminders } = await options.reminders.listForCase(caseId)
    const goalDate = result.changes.find((change) => change.field === 'targetDate')
    const moves = remindersToMove({
      reminders,
      heldBy: new Set(
        holdings.flatMap((holding) => (holding.reminderId === null ? [] : [holding.reminderId])),
      ),
      moves: [
        ...(goalDate === undefined
          ? []
          : [
              {
                from: goalDate.from === null ? null : String(goalDate.from),
                to: String(goalDate.to),
              },
            ]),
        result.effects.keysOn,
      ],
      today,
    })
    const moved: { from: string; to: string; dueOn: { from: string; to: string } }[] = []
    const participantId = c.get('caseAccess').participantId ?? null
    for (const reminder of moves) {
      await options.reminders.deleteReminder(caseId, reminder.id)
      const created = await options.reminders.createReminder({
        caseId,
        kind: reminder.kind,
        label: reminder.label,
        dueOn: reminder.to,
        productId: reminder.productId ?? undefined,
        createdBy: participantId,
      })
      moved.push({
        from: reminder.id,
        to: created.id,
        dueOn: { from: reminder.from, to: reminder.to },
      })
    }

    await options.plans.saveEdit({
      planId: claimed.id,
      caseId,
      plan: result.plan,
      event: {
        planId: claimed.id,
        changes: result.changes,
        effects: result.effects,
        reading: result.reading,
        reminders: moved,
        previous: claimed.plan,
      },
      fields: result.changes.map((change) => change.field),
      participantId,
    })
    c.get('log').info('plan edited', {
      requestId: c.get('requestId'),
      fields: result.changes.map((change) => change.field),
    })

    const rebuilt = { id: claimed.id, plan: result.plan }
    return c.json(
      {
        ...casePlanOf(rebuilt, planProgress(result.plan, holdings, today)),
        reading: result.reading,
      },
      200,
    )
  })

  return routes
}
