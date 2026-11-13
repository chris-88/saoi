import { arrange } from '@shared/domain/savings/arrange.ts'
import { situationFrom } from '@shared/domain/savings/situation.ts'
import { type savingsOptionsFrom } from '@shared/tenants/demo/savings-options.ts'
import { caseFactReader } from '@shared/db/fact-reader.ts'
import { stageFor, type Stage } from '@shared/domain/conversation/stages.ts'
import { CONVERSATION } from '@shared/llm/conversation.ts'
import type { ToolName } from '@shared/llm/tools.ts'
import { type describeGoals } from '@shared/db/goals.ts'
import { type LoadedCase } from '@shared/db/loaded-case.ts'

/**
 * The tools that read or start Demo Bank's catalogue: its products, its rate table, its quote
 * engine, its savings arrangement and money moved into an account here. Withheld from a market
 * conversation (a claimed plan or holdings), where the catalogue is the market and Demo Bank is
 * not in the prompt (2026-11-13: Saoirse called Bank of Ireland's 18-month rate "Demo Bank's own
 * deposit range" to a customer comparing the market).
 */
export const DEMO_CATALOGUE_TOOLS: readonly ToolName[] = [
  'show_product_options',
  'show_comparison',
  'show_quote',
  'show_mortgage_rates',
  'show_arrangement',
  'show_transfer',
]

/** Offered in every stage of a market conversation: the card, and the lookup it answers from. */
export const MARKET_TOOLS: readonly ToolName[] = ['show_products', 'lookup_products']

/**
 * Which tools a turn is offered, from the stage it is in.
 *
 * Enforcement rather than advice, and the reason this feature is not another paragraph of
 * prompt. Telling a model "no products yet" works most of the time; withholding
 * `show_product_options` works every time. A conversation that is still finding out what
 * somebody wants cannot produce a product card, because there is no tool to produce one with.
 *
 * The form tools are further gated on there actually being a form. A tool the model can see is
 * a tool it will eventually try, and on a case with no form-backed application every call
 * would be refused by the server and spend a whole round doing it.
 */
export function toolsForTurn(
  stage: Stage,
  hasForm: boolean,
  /**
   * The case has the customer's figures for the market (a claimed plan, or holdings).
   *
   * `show_products` and `lookup_products` are offered on that, in whatever stage: the stages
   * are the Demo Bank arc, and a customer who brought a plan from their own AI asks about
   * products from the first reply on. Without either they are withheld, as a card would have
   * nothing to run on, and the Demo Bank catalogue's tools are withheld with them.
   */
  hasFigures = false,
): readonly ToolName[] {
  const staged = CONVERSATION[stage].tools
  const allowed: readonly ToolName[] = hasFigures
    ? [...staged.filter((tool) => !DEMO_CATALOGUE_TOOLS.includes(tool)), ...MARKET_TOOLS]
    : staged
  if (hasForm) return allowed

  return allowed.filter(
    (tool) =>
      tool !== 'record_form_answers' &&
      tool !== 'show_form_declarations' &&
      tool !== 'show_form_upload',
  )
}

type Goals = ReturnType<typeof describeGoals>

/**
 * The stage this turn is in, with the arrangement it was worked out from.
 *
 * Pure: the same case gives the same answer, and nothing is stored.
 */
export function computeStage(inputs: {
  readonly loaded: LoadedCase
  readonly goals: Goals
  readonly keptPlans: readonly unknown[]
  readonly savingsOptions: ReturnType<typeof savingsOptionsFrom>
  readonly today?: Date
}) {
  const { loaded, goals, keptPlans, savingsOptions } = inputs
  const today = inputs.today ?? new Date()

  /*
   * Where this conversation has got to, worked out from the case.
   *
   * Read every turn and never stored, so a customer who corrects something moves the
   * conversation back by itself rather than carrying on from a position the case no longer
   * supports. What it governs is in `conversation.ts`: what to do in this stage, what belongs
   * to a later one, and which tools the turn is offered at all.
   */
  const approachFact = loaded.facts.find(
    (fact) => fact.key === 'goals.approach' && fact.supersededBy === null,
  )
  const approach =
    approachFact?.value === 'plan' || approachFact?.value === 'product' ? approachFact.value : null

  /*
   * How their money should be arranged, from the facts held (§40).
   *
   * Computed every turn and never stored, like the stage: a corrected balance or a changed
   * target date changes the arrangement by itself. Null means there is nothing to arrange,
   * either because the figures are not held yet or because only one account fits, and one
   * account is a recommendation rather than an arrangement.
   *
   * Whether it has been shown is read off the persisted cards, which is what lets the stage
   * show it exactly once and then move on.
   */
  const factReader = caseFactReader(loaded)
  const arrangement =
    factReader === null
      ? null
      : arrange(situationFrom(factReader, today.toISOString().slice(0, 10)), savingsOptions)
  const arrangementShown = loaded.messages.some((message) => message.cards.includes('arrangement'))

  const stage = stageFor({
    customerTurns: loaded.messages.filter((message) => message.role === 'customer').length,
    goalGaps:
      goals.candidates.find((candidate) => candidate.tier === 'primary')?.missing.length ?? 99,
    approach,
    planAccepted: keptPlans.length > 0,
    // Not until it has nothing left to ask. An arrangement with an open question is not shown.
    arrangement: arrangement !== null && arrangement.needs.length === 0,
    arrangementShown,
    applications: loaded.applications.length,
  })

  return { stage, arrangement, approach }
}
