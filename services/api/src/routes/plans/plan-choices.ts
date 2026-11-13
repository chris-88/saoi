import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { dueOnProblem } from '@shared/contracts/alerts.ts'
import { casePlanChoiceBodySchema, casePlanChoiceSlotSchema } from '@shared/contracts/case-plan.ts'
import type { MarketPlan, PlanChoiceSlot, StoredPlanChoice } from '@shared/contracts/market-plan.ts'
import {
  allChosen,
  allChosenLine,
  nextOpenSlot,
  resolveChoice,
  slotQuestion,
} from '@shared/domain/market/choices.ts'
import { planProgress } from '@shared/domain/market/holdings.ts'
import { casePlanOf } from '@shared/domain/market/plan-edit.ts'
import { caseFigures } from '@shared/domain/market/products-card.ts'
import { PRODUCT_CHOICE_REMOVED_EVENT, PRODUCT_CHOSEN_EVENT } from '@shared/domain/narration.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { requireCaseAccess } from '../../middleware/requireCaseAccess.ts'
import type { ClaimedPlan } from '@shared/db/saved-plans.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { caseParams } from '../cases/params.ts'
import { dublinDate } from '../market/index.ts'
import type { ChoiceInputs } from '../../store/plans.ts'
import { CasePlanResponse, type CasePlanRouteOptions } from './case-plan.ts'

/**
 * The customer's choices for the plan (Chris, 2026-11-13: "the goal is to get the customer to
 * pick products from the product lists we're presenting"): a product chosen on a card for the
 * lump sum, the monthly saving or the mortgage, and taken off again. The model proposes, the UI
 * commits (Invariant 1): the model has no tool that makes a choice; the customer's tap calls
 * this route. Only the row id is sent: the row's lead, kind, value and figure are rebuilt from
 * the market on the products card's rules (a mortgage from the plan's own comparison options),
 * never taken from the client.
 *
 * Each commit writes `product_chosen` and each removal `product_choice_removed`, both
 * narratable, so the next return turn says it in a line and asks the next open part's question
 * (`next`, worked out here from the stored plan), or, once every part is chosen, what the plan
 * now does (`allChosenLine`), once. A chosen rate or term with an end keeps a reminder dated to
 * it (`reminderForHolding`'s pattern); replacing or removing the choice removes it.
 */

const NO_PLAN = 'This conversation has no plan.'

const NO_INPUTS: ChoiceInputs = { facts: {}, shown: [] }

const slotParams = caseParams.extend({
  slot: casePlanChoiceSlotSchema.openapi({ param: { name: 'slot', in: 'path' } }),
})

const postRoute = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/plan/choices',
  tags: ['plans'],
  summary: 'Choose a product for a part of the plan',
  description:
    'The customer chose a product on a card for one part of the claimed plan: the sum held ' +
    '(`lump_sum`), the monthly saving (`monthly_saving`) or the mortgage (`mortgage`). Only the ' +
    'row id is sent; its key facts are rebuilt from the market (a products row, a comparison ' +
    'column, or for the mortgage one of the plan’s comparison options). Replaces any earlier ' +
    'choice for that part. A rate or term with an end keeps a reminder dated to it. Writes ' +
    '`product_chosen`; the next return turn says it and asks the next open part’s question. ' +
    'Choosing the row already chosen changes nothing.',
  security,
  middleware: [requireCaseAccess] as const,
  request: {
    params: caseParams,
    body: {
      required: true,
      content: {
        'application/json': { schema: casePlanChoiceBodySchema.openapi('CasePlanChoice') },
      },
    },
  },
  responses: {
    200: {
      description: 'The plan, with its choices.',
      content: { 'application/json': { schema: CasePlanResponse } },
    },
    ...authenticatedErrors,
    400: errorResponse(
      'The body is not valid (an unknown part, a malformed row id), or the product is not the ' +
        'kind that part takes: a mortgage for a savings part, a fixed term for the monthly saving.',
    ),
    404: errorResponse(
      'No such case for this caller, it has no claimed plan, or the row is on no card it can show.',
    ),
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/api/cases/{caseId}/plan/choices/{slot}',
  tags: ['plans'],
  summary: 'Take a choice off the plan',
  description:
    'Opens that part of the plan again and removes the reminder kept for the choice. Writes ' +
    '`product_choice_removed`. A part that is already open changes nothing.',
  security,
  middleware: [requireCaseAccess] as const,
  request: { params: slotParams },
  responses: {
    200: {
      description: 'The plan, with its choices.',
      content: { 'application/json': { schema: CasePlanResponse } },
    },
    ...authenticatedErrors,
    400: errorResponse('Not one of the parts of a plan.'),
    404: errorResponse('No such case for this caller, or it has no claimed plan.'),
  },
})

/** The next open part and its question, for the return turn; null when none is open. */
const nextOf = (plan: MarketPlan): { slot: PlanChoiceSlot; question: string } | null => {
  const slot = nextOpenSlot(plan)
  return slot === null ? null : { slot, question: slotQuestion(slot, plan) }
}

const withChoice = (
  plan: MarketPlan,
  slot: PlanChoiceSlot,
  choice: StoredPlanChoice | null,
): MarketPlan => {
  const choices = { ...(plan.choices ?? {}) }
  if (choice === null) delete choices[slot]
  else choices[slot] = choice
  return { ...plan, choices }
}

export function planChoiceRoutes(options: CasePlanRouteOptions) {
  const now = options.now ?? Date.now
  const routes = new OpenAPIHono<AppEnv>()

  const view = async (caseId: string, claimed: ClaimedPlan) => {
    const holdings = await options.holdings.list(caseId)
    return casePlanOf(claimed, planProgress(claimed.plan, holdings, dublinDate(now())))
  }

  const removeReminder = async (caseId: string, choice: StoredPlanChoice | undefined) => {
    if (choice?.reminderId === undefined) return
    await options.reminders.deleteReminder(caseId, choice.reminderId)
  }

  routes.openapi(postRoute, async (c) => {
    const { caseId } = c.req.valid('param')
    const { slot, rowId } = c.req.valid('json')
    const claimed = await options.plans.claimedPlan(caseId)
    if (claimed === null) throw new ApiError('not_found', NO_PLAN)

    const previous = claimed.plan.choices?.[slot]
    if (previous?.rowId === rowId) return c.json(await view(caseId, claimed), 200)

    const at = now()
    const today = dublinDate(at)
    const [market, holdings, inputs] = await Promise.all([
      options.market(),
      options.holdings.list(caseId),
      options.plans.choiceInputs?.(caseId) ?? Promise.resolve(NO_INPUTS),
    ])
    const figures = caseFigures({
      plan: claimed.plan,
      holdings,
      fact: (key) => inputs.facts[key],
    })
    const result = resolveChoice({
      market,
      figures,
      plan: claimed.plan,
      slot,
      rowId,
      asOf: today,
      shown: inputs.shown,
    })
    if (result.kind === 'refused') {
      throw new ApiError(result.code === 'unknown_row' ? 'not_found' : 'bad_request', result.reason)
    }

    // The reminder for the end of the rate or term, replacing the one kept for the earlier choice.
    await removeReminder(caseId, previous)
    const participantId = c.get('caseAccess').participantId ?? null
    const end =
      result.end !== null && dueOnProblem(result.end.on, today) === null ? result.end : null
    const reminder =
      end === null
        ? null
        : await options.reminders.createReminder({
            caseId,
            kind: end.reminder.kind,
            label: end.reminder.label,
            dueOn: end.reminder.dueOn,
            productId: end.reminder.productId ?? undefined,
            createdBy: participantId,
          })

    const choice: StoredPlanChoice = {
      ...result.choice,
      chosenAt: new Date(at).toISOString(),
      ...(end === null ? {} : { endsOn: end.on }),
      ...(reminder === null ? {} : { reminderId: reminder.id }),
    }
    const plan = withChoice(claimed.plan, slot, choice)
    const completes = allChosen(plan) && !allChosen(claimed.plan)
    await options.plans.saveChoices({
      planId: claimed.id,
      caseId,
      plan,
      event: {
        type: PRODUCT_CHOSEN_EVENT,
        payload: {
          planId: claimed.id,
          slot,
          rowId,
          lead: choice.lead,
          ...(previous === undefined
            ? {}
            : { replaced: previous.rowId, replacedLead: previous.lead }),
          ...(reminder === null ? {} : { reminder: { id: reminder.id, dueOn: reminder.dueOn } }),
          next: nextOf(plan),
          ...(completes ? { allChosenLine: allChosenLine(plan) } : {}),
        },
      },
    })
    c.get('log').info('plan choice made', { requestId: c.get('requestId'), slot })
    return c.json(await view(caseId, { id: claimed.id, plan }), 200)
  })

  routes.openapi(deleteRoute, async (c) => {
    const { caseId, slot } = c.req.valid('param')
    const claimed = await options.plans.claimedPlan(caseId)
    if (claimed === null) throw new ApiError('not_found', NO_PLAN)
    const previous = claimed.plan.choices?.[slot]
    if (previous === undefined) return c.json(await view(caseId, claimed), 200)

    await removeReminder(caseId, previous)
    const plan = withChoice(claimed.plan, slot, null)
    await options.plans.saveChoices({
      planId: claimed.id,
      caseId,
      plan,
      event: {
        type: PRODUCT_CHOICE_REMOVED_EVENT,
        payload: {
          planId: claimed.id,
          slot,
          rowId: previous.rowId,
          lead: previous.lead,
          next: nextOf(plan),
        },
      },
    })
    c.get('log').info('plan choice removed', { requestId: c.get('requestId'), slot })
    return c.json(await view(caseId, { id: claimed.id, plan }), 200)
  })

  return routes
}
