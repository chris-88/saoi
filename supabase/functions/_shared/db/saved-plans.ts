import { z } from 'zod'
import type { Card } from '../contracts/cards.ts'
import {
  marketPlanSchema,
  upgradeStoredPlan,
  type MarketPlan,
  type PlanEdit,
  type PlanProduct,
  type PlanRoute,
} from '../contracts/market-plan.ts'
import { factCatalogue, type FactKey } from '../domain/facts.ts'
import { arrivalOpening } from '../domain/market/arrival.ts'
import { editableOf } from '../domain/market/plan-edit.ts'
import type { Db } from './case-repository.ts'

/**
 * A plan made in the customer's own AI, once it is in a conversation (`market-plan.ts`).
 *
 * Three things are built from the stored plan, all here and all from the plan's own figures:
 * the card the customer sees (Invariant 2), the lines the digest gives the model, and the
 * facts the plan's situation states plainly enough to be recorded. Nothing is computed that
 * the plan did not already say.
 */

export const SAVED_PLAN_CARD = 'saved_plan' as const

export type ClaimedPlan = {
  readonly id: string
  readonly plan: MarketPlan
}

const euro = (amount: number): string => `€${Math.round(amount).toLocaleString('en-IE')}`

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** "2028-06" or "2028-06-30" as "June 2028". */
export function monthOf(value: string): string {
  const [year, month] = value.split('-')
  const name = MONTHS[Number(month) - 1]
  return name === undefined || year === undefined ? value : `${name} ${year}`
}

/** An ISO timestamp as "9 Nov 2026", in Dublin. */
export function dayOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Dublin',
  })
}

const ROLE_LABELS: Record<PlanProduct['role'], string> = {
  regular_saver: 'Monthly saving',
  lump_sum: 'Lump sum',
  emergency_fund: 'Emergency fund',
  mortgage: 'Mortgage',
  refinance: 'Refinance',
  current_account: 'Current account',
  other: 'Part of the plan',
}

const BORROWING: ReadonlySet<PlanProduct['category']> = new Set(['mortgage', 'loan', 'credit_card'])

function amountsOf(product: PlanProduct): string[] {
  const borrowing = BORROWING.has(product.category)
  return [
    ...(product.monthlyAmount === undefined
      ? []
      : [`${euro(product.monthlyAmount)} a month${borrowing ? ' repaid' : ''}`]),
    ...(product.amount === undefined
      ? []
      : [`${euro(product.amount)} ${borrowing ? 'borrowed' : 'once'}`]),
  ]
}

function rateOf(product: PlanProduct): string | null {
  if (product.ratePct === undefined) return null
  return `${product.ratePct.toFixed(2)}% ${BORROWING.has(product.category) ? 'APR' : 'AER'}`
}

function projectedOf(product: PlanProduct): string | null {
  const projection = product.projected
  if (projection === undefined) return null
  const parts = [
    ...(projection.balance === undefined
      ? []
      : [`${euro(projection.balance)} after ${String(projection.horizonMonths)} months`]),
    ...(projection.netInterest === undefined
      ? []
      : [`${euro(projection.netInterest)} interest after DIRT`]),
    ...(projection.monthlyRepayment === undefined
      ? []
      : [`${euro(projection.monthlyRepayment)} a month`]),
    ...(projection.totalCost === undefined
      ? []
      : [
          `${euro(projection.totalCost)} total cost over ${String(projection.horizonMonths)} months`,
        ]),
    ...(projection.goalReachedOn === undefined
      ? []
      : [`goal reached by ${monthOf(projection.goalReachedOn)}`]),
  ]
  return parts.length === 0 ? null : parts.join(', ')
}

function provenanceOf(product: PlanProduct): string {
  const where = product.source === 'ccpc' ? 'CCPC' : `${product.providerName}’s own site`
  return `${where}, checked ${dayOf(product.checkedAt)}`
}

const DEBT_ACTIONS: Record<MarketPlan['debts'][number]['action'], string> = {
  // Options with their figures, not instructions: the customer decides.
  pay_off_first: 'cleared from the lump sum in this plan',
  overpay: 'part paid from the lump sum in this plan',
  keep_paying: 'kept as it is in this plan',
  refinance: 'refinancing compared in this plan',
}

function debtLines(plan: MarketPlan): string[] {
  return plan.debts.map((step) => {
    const debt = plan.situation.debts.find((candidate) => candidate.id === step.debtId)
    const name = debt?.label ?? step.debtId
    const costs =
      step.costIfKept !== undefined && step.costWithStep !== undefined
        ? ` Costs ${euro(step.costIfKept)} as it is, ${euro(step.costWithStep)} this way.`
        : ''
    return `${name}: ${DEBT_ACTIONS[step.action]}. ${step.why}${costs}`
  })
}

function goalTarget(goal: MarketPlan['goals'][number]): string | null {
  const amount = goal.targetAmount === undefined ? null : euro(goal.targetAmount)
  const when = goal.targetDate === undefined ? null : `by ${monthOf(goal.targetDate)}`
  if (amount === null && when === null) return null
  return [amount, when].filter((part) => part !== null).join(' ')
}

/** The card, from the stored plan. Every word on it is the plan's (Invariant 2). */
export function savedPlanCard(claimed: ClaimedPlan): Card {
  const { plan } = claimed
  return {
    type: SAVED_PLAN_CARD,
    planId: claimed.id,
    title: plan.title,
    summary: plan.situation.summary,
    goals: plan.goals.map((goal) => ({ label: goal.label, target: goalTarget(goal) })),
    products: plan.combination.products.map((product) => ({
      name: product.productName,
      providerName: product.providerName,
      role: ROLE_LABELS[product.role],
      amounts: amountsOf(product),
      rate: rateOf(product),
      projected: projectedOf(product),
      provenance: provenanceOf(product),
      unknowns: [...product.unknowns],
      checks: [...product.checks],
      url: product.url ?? null,
    })),
    debts: debtLines(plan),
    basis: plan.ranking.basis,
    assumptions: [...plan.assumptions],
    attributions: [
      ...new Set(
        plan.combination.products
          .map((product) => product.attribution)
          .filter((line): line is string => line !== undefined),
      ),
    ].slice(0, 4),
    figures: figuresLine(plan),
    ...(plan.comparison === undefined ? {} : { comparison: comparisonCard(plan.comparison) }),
    routes: routesOf(plan),
    ...(plan.arrival === undefined ? {} : { arrival: plan.arrival }),
    createdAt: plan.createdAt,
    dataCheckedAt: plan.dataCheckedAt,
  }
}

/**
 * The conversation's first message, written by the claim (2026-11-12, "3. Arrival"): the plan
 * card, then Saoirse's first line as its text. One row, so a reload reads [card, question] and
 * the model's history starts with the question it asked; the card goes first on screen
 * (`buildHistory` leads with it).
 */
export function arrivalMessage(claimed: ClaimedPlan): { content: string; cards: Card[] } {
  return { content: planOpening(claimed.plan), cards: [savedPlanCard(claimed)] }
}

/**
 * Whether these messages hold the plan's arrival message: Saoirse's, with the plan card, saying
 * the opening line word for word. Reads the loaded transcript (card types only).
 */
export function arrivedWith(
  claimed: ClaimedPlan,
  messages: readonly {
    readonly role: string
    readonly content: string
    readonly cards: readonly string[]
  }[],
): boolean {
  const opening = planOpening(claimed.plan)
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      message.cards.includes(SAVED_PLAN_CARD) &&
      message.content === opening,
  )
}

/**
 * Saoirse's first line when the plan is opened, verbatim: the hook question and what it moves,
 * or the short line that invites them to carry on. The preview returns it and the claim writes
 * it as the conversation's first message, with the card. A plan rebuilt by an edit keeps the
 * line it opened with (`openedWith`), so the transcript still reads as the arrival.
 */
export function planOpening(plan: MarketPlan): string {
  return plan.openedWith ?? arrivalOpening(plan.arrival)
}

const euroWhole = (value: number): string =>
  `€${Math.round(value).toLocaleString('en-IE', { maximumFractionDigits: 0 })}`

/** "€25k": short euro for the one-line figures. */
const shortEur = (value: number): string =>
  value >= 1_000_000
    ? `€${String(Math.round(value / 100_000) / 10)}m`
    : value >= 1_000
      ? `€${String(Math.round(value / 100) / 10)}k`
      : `€${String(Math.round(value))}`

/** Their figures in one line: "€25k saved · €800/mo · €90k · €350k". */
export function figuresLine(plan: MarketPlan): string {
  const saved = plan.situation.savings.reduce((sum, item) => sum + item.balance, 0)
  return [
    saved > 0 ? `${shortEur(saved)} saved` : null,
    plan.situation.monthlySaving === undefined
      ? null
      : `${euroWhole(plan.situation.monthlySaving)}/mo`,
    plan.situation.income?.annualGross === undefined
      ? null
      : shortEur(plan.situation.income.annualGross),
    plan.comparison === undefined ? null : shortEur(plan.comparison.priceEur),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
}

/** Every route to a home the plan carries, in its order; empty for a plan without them. */
export function routesOf(plan: MarketPlan): PlanRoute[] {
  return plan.comparison === undefined ? [] : plan.comparison.routes.map((route) => ({ ...route }))
}

/**
 * The routes for the digest: three lines in their order, then how many more, as the
 * presentation gives them (`routeLines` in `domain/market/routes.ts`). Never a pick.
 */
function routeDigestLines(routes: readonly PlanRoute[]): string[] {
  if (routes.length === 0) return []
  const shown = routes.slice(0, 3)
  const more = routes.length - shown.length
  return [
    `Routes to a home: ${String(routes.length)}, in the order they saw them, each a fact with its status; none is best, fastest or recommended, and the customer chooses. The card shows them under the comparison.`,
    ...shown.map((route) => `Route: ${route.line}`),
    ...(more > 0 ? [`More routes: ${String(more)}`] : []),
  ]
}

/** The comparison's first three options, as the card and the app's welcome show them. */
export function comparisonCard(
  comparison: NonNullable<MarketPlan['comparison']>,
): NonNullable<Extract<Card, { type: typeof SAVED_PLAN_CARD }>['comparison']> {
  return {
    headline: comparison.headline,
    sortedBy: comparison.sortedBy,
    sortBy: comparison.sortBy,
    filters: [...comparison.filters],
    total: comparison.options.length,
    options: comparison.options.slice(0, 3).map((option) => ({
      lender: option.lender,
      kind: option.kind,
      rate: `${String(Math.round(option.ratePct * 100) / 100)}%`,
      monthly: `${euroWhole(option.monthlyEur)}/mo`,
      fiveYear: `${euroWhole(option.fiveYearCostEur)} over 5 years`,
      keys: option.keysOn === null ? null : monthOf(option.keysOn),
      confirmed: option.confirmed,
      lead:
        comparison.sortBy === 'monthly_repayment'
          ? `${euroWhole(option.monthlyEur)}/mo`
          : comparison.sortBy === 'keys_date'
            ? option.keysOn === null
              ? 'not reached'
              : monthOf(option.keysOn)
            : `${euroWhole(option.fiveYearCostEur)} / 5 yrs`,
    })),
  }
}

/**
 * What the model is told about the plan, for the digest.
 *
 * The products in the plan's own order, so "what is next" is the first of them and the model
 * does not have to choose. Figures are the plan's; the model is told the card shows them.
 */
export function savedPlanDigestLines(
  claimed: ClaimedPlan,
  /** True when the transcript holds the arrival message: the card, then Saoirse's first line. */
  arrived = false,
): string[] {
  const { plan } = claimed
  const first = plan.combination.products[0]
  const firstDebt = debtLines(plan)[0]
  return [
    `Title: ${plan.title}`,
    `Made: ${dayOf(plan.createdAt)}, in their own AI assistant, with Saoi's market data (checked ${dayOf(plan.dataCheckedAt)}).`,
    ...editLines(plan),
    `Their situation, as they described it: ${plan.situation.summary}`,
    ...heldFiguresLines(plan),
    `Goals: ${plan.goals
      .map((goal) => {
        const target = goalTarget(goal)
        return target === null ? goal.label : `${goal.label} (${target})`
      })
      .join('; ')}`,
    ...plan.combination.products.map((product, index) => {
      const amounts = amountsOf(product)
      return (
        `Step ${String(index + 1)}: ${ROLE_LABELS[product.role]}, ${product.productName} with ${product.providerName}` +
        (amounts.length === 0 ? '' : `, ${amounts.join(' and ')}`) +
        (product.checks.length === 0 ? '' : `. Check first: ${product.checks.join('; ')}`)
      )
    }),
    ...debtLines(plan).map((line) => `Debt: ${line}`),
    `Ranked by: ${plan.ranking.basis}`,
    ...(plan.comparison === undefined
      ? []
      : [
          `Home comparison: ${String(plan.comparison.options.length)} mortgage options for a ${euroWhole(plan.comparison.priceEur)} home, ${plan.comparison.sortedBy}${plan.comparison.filters.length === 0 ? '' : ` ${plan.comparison.filters.join(' ')}`}`,
          // Every option, so a follow-up about any of them is answered from the comparison.
          'The card shows the first three; the rest come out when they ask.',
          ...plan.comparison.options.map(
            (option, index) =>
              `Option ${String(index + 1)} in their order: ${option.lender}, ${option.kind} (${option.productName}) at ${String(option.ratePct)}%, ${euroWhole(option.monthlyEur)} a month, ${euroWhole(option.fiveYearCostEur)} over 5 years, keys ${option.keysOn === null ? 'not reached' : monthOf(option.keysOn)}${option.confirmed ? '' : ' (incentives not confirmed on the lender’s site)'}${option.conditions.length === 0 ? '' : `. Conditions: ${option.conditions.join(' ')}`}`,
          ),
          ...routeDigestLines(plan.comparison.routes),
        ]),
    ...(arrived
      ? [
          `Already shown when they opened it in the app: this card, then your first line, word for word: "${planOpening(plan)}" Do not show the card again, welcome them or repeat that line.`,
        ]
      : []),
    // A comparison, not a plan to follow: the next step is theirs to choose (2026-11-10).
    `Next: offer them a choice, never a pick: talk through the options, change a figure or a filter, or how the figures were worked out.${first === undefined && firstDebt !== undefined ? ` The debt step in it: ${firstDebt}` : ''} Saoi cannot open any product for them; they apply with a provider directly.`,
  ]
}

/**
 * The figures the plan holds, in one line, so they are never asked for again (2026-11-13: asked
 * "yes a plan", Saoirse asked the price, the income and who was buying, all in the claimed
 * plan). The plan as it stands, edits included (`editableOf`); a home plan with buying together
 * not stated was worked out for one buyer, and says so. Where each changes goes with it.
 */
export function heldFiguresLines(plan: MarketPlan): string[] {
  const { situation } = plan
  const home = editableOf(plan)
  const isHome = home.homePrice !== null || home.propertyKind !== null
  const held = situation.savings.reduce((sum, account) => sum + account.balance, 0)
  const income = situation.income
  const figures = [
    ...(home.homePrice === null ? [] : [`home price ${euro(home.homePrice)}`]),
    ...(income?.annualGross === undefined
      ? []
      : [`income ${euro(income.annualGross)} a year before tax`]),
    ...(income?.netMonthly === undefined
      ? []
      : [`take-home pay ${euro(income.netMonthly)} a month`]),
    ...(home.firstTimeBuyer === null
      ? []
      : [home.firstTimeBuyer ? 'first-time buyer' : 'has bought before']),
    ...(home.buyingTogether === true
      ? ['buying together']
      : home.buyingTogether === false
        ? ['buying alone']
        : isHome
          ? ['buying alone (the plan was worked out for one buyer)']
          : []),
    ...(situation.monthlySaving === undefined
      ? []
      : [`saving ${euro(situation.monthlySaving)} a month`]),
    ...(situation.savings.length === 0 ? [] : [`${euro(held)} held when it was made`]),
  ]
  if (figures.length === 0) return []
  return [
    `Their figures, held with the plan (never ask for any of these again): ${figures.join('; ')}. ` +
      'A figure of the plan changes in the app, under Your plan (the date, the price, the ' +
      'monthly saving, the kind of home, first-time buyer, buying together); what they hold, ' +
      'with record_holding.',
  ]
}

const EDIT_LABELS: Record<PlanEdit['field'], string> = {
  targetDate: 'the date',
  homePrice: 'the price',
  monthlySaving: 'the monthly saving',
  propertyKind: 'the kind of home',
  firstTimeBuyer: 'first-time buyer',
  buyingTogether: 'buying together',
}
const KIND_LABELS: Record<string, string> = {
  new_build: 'new build',
  second_hand: 'second-hand',
  self_build: 'self-build',
}

function editValue(field: PlanEdit['field'], value: PlanEdit['from']): string {
  if (value === null) return 'not given'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return euro(value)
  if (field === 'targetDate') return monthOf(value)
  return KIND_LABELS[value] ?? value
}

/**
 * The changes made in the app's profile (2026-11-12, "6. The saving months"), for the digest:
 * the plan's lines below them are the plan rebuilt on them, and the situation line is still as
 * they first described it.
 */
function editLines(plan: MarketPlan): string[] {
  const edits = plan.edits ?? []
  if (edits.length === 0) return []
  return [
    `Changed by them in the app since: ${edits
      .map(
        (edit) =>
          `${EDIT_LABELS[edit.field]} from ${editValue(edit.field, edit.from)} to ${editValue(edit.field, edit.to)} (${dayOf(edit.at)})`,
      )
      .join(
        '; ',
      )}. Every figure below is the plan rebuilt on these; where the situation line says otherwise, these win.`,
  ]
}

/** A fact the plan states plainly, ready to record against the case. */
export type PlanFact = {
  readonly key: FactKey
  readonly subject: 'primary' | 'household'
  readonly value: unknown
}

const SAVING_GOALS: ReadonlySet<MarketPlan['goals'][number]['kind']> = new Set([
  'house_deposit',
  'emergency_fund',
  'save_for_purchase',
  'grow_savings',
])

/**
 * The plan's situation as facts, where a figure maps onto a catalogue key without
 * interpretation.
 *
 * Mapped: take-home pay, gross income (as `income.annualGrossStated`, never
 * `income.annualBasic`: that is basic salary and a gross figure may include a bonus), rent,
 * other outgoings, what they can save a month, savings held (the sum of what they listed),
 * credit card balances (summed), loan repayments (summed, only when every loan states one), the
 * leading goal as the objective, its target and its date, and for a home the price, first-time
 * buyer and buying alone or together (`editableOf`: the plan's own inputs, else the arrival's
 * chips and the comparison's price; 2026-11-13, when Saoirse asked a customer for the price and
 * the income his claimed plan held). Buying together is recorded only when the plan states it.
 * Not mapped: anything the catalogue's own schema refuses. Every one is recorded as
 * `customer_stated`: the customer said it, to their AI.
 */
export function factsFromPlan(plan: MarketPlan): PlanFact[] {
  const { situation } = plan
  const candidates: PlanFact[] = []
  const add = (key: FactKey, subject: PlanFact['subject'], value: unknown) => {
    if (value === undefined || value === null) return
    candidates.push({ key, subject, value })
  }
  const whole = (amount: number | null | undefined) =>
    amount === undefined || amount === null ? undefined : Math.round(amount)
  const home = editableOf(plan)

  add('income.netMonthly', 'primary', whole(situation.income?.netMonthly))
  add('income.annualGrossStated', 'primary', whole(situation.income?.annualGross))
  add('housing.purchasePrice', 'household', whole(home.homePrice))
  add('housing.firstTimeBuyer', 'household', home.firstTimeBuyer)
  add(
    'household.buyingWith',
    'household',
    home.buyingTogether === null ? undefined : home.buyingTogether ? 'partner' : 'alone',
  )
  add('expenditure.monthlyRent', 'household', whole(situation.outgoings?.rentMonthly))
  add('expenditure.monthlyOther', 'household', whole(situation.outgoings?.otherMonthly))
  add('goals.monthlySaving', 'household', whole(situation.monthlySaving))

  if (situation.savings.length > 0) {
    add(
      'assets.savingsBalance',
      'household',
      Math.round(situation.savings.reduce((sum, account) => sum + account.balance, 0)),
    )
  }

  const cards = situation.debts.filter((debt) => debt.kind === 'credit_card')
  if (cards.length > 0) {
    add(
      'liabilities.creditCardBalance',
      'primary',
      Math.round(cards.reduce((sum, debt) => sum + debt.balance, 0)),
    )
  }

  const loans = situation.debts.filter(
    (debt) => debt.kind === 'personal_loan' || debt.kind === 'car_finance',
  )
  if (loans.length > 0 && loans.every((debt) => debt.monthlyRepayment !== undefined)) {
    add(
      'liabilities.monthlyLoanRepayments',
      'primary',
      Math.round(loans.reduce((sum, debt) => sum + (debt.monthlyRepayment ?? 0), 0)),
    )
  }

  const leading = [...plan.goals].sort(
    (a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER),
  )[0]
  if (leading !== undefined) {
    add('goals.primaryObjective', 'household', leading.label)
    if (SAVING_GOALS.has(leading.kind)) {
      add('goals.savingsTarget', 'household', whole(leading.targetAmount))
    }
    add('goals.targetDate', 'household', leading.targetDate)
  }

  // The catalogue decides what a value may be; a figure it refuses is left out, not coerced.
  return candidates.filter((fact) => factCatalogue[fact.key].schema.safeParse(fact.value).success)
}

/** The fact each figure the profile edits is recorded as; the kind of home has none. */
const EDIT_FACTS: Readonly<Record<PlanEdit['field'], FactKey | null>> = {
  targetDate: 'goals.targetDate',
  homePrice: 'housing.purchasePrice',
  monthlySaving: 'goals.monthlySaving',
  propertyKind: null,
  firstTimeBuyer: 'housing.firstTimeBuyer',
  buyingTogether: 'household.buyingWith',
}

/**
 * The facts an edit in the profile changes (2026-11-13): the rebuilt plan's `factsFromPlan`
 * for the edited fields only, so the case's facts follow the plan and what they said in the
 * conversation about anything else stands. Pure.
 */
export function factsFromEdit(plan: MarketPlan, fields: readonly PlanEdit['field'][]): PlanFact[] {
  const keys = new Set(fields.flatMap((field) => EDIT_FACTS[field] ?? []))
  return factsFromPlan(plan).filter((fact) => keys.has(fact.key))
}

const claimedRow = z.object({ id: z.string(), document: z.unknown() })

/**
 * The plans claimed into a case, oldest first. A stored document that no longer parses is
 * left out rather than failing the turn.
 */
export async function loadClaimedPlans(db: Db, caseId: string): Promise<ClaimedPlan[]> {
  const result = await db
    .from('saved_plans')
    .select('id, document')
    .eq('case_id', caseId)
    .order('claimed_at', { ascending: true })
  if (result.error) {
    console.error(`claimed plans could not be read: ${result.error.message}`)
    return []
  }
  return z
    .array(claimedRow)
    .parse(result.data ?? [])
    .flatMap((row) => {
      const plan = marketPlanSchema.safeParse(upgradeStoredPlan(row.document))
      return plan.success ? [{ id: row.id, plan: plan.data }] : []
    })
}

/** A persisted plan card, which is the only card payload this file reads back. */
const persistedPlanCard = z.object({ type: z.literal(SAVED_PLAN_CARD), planId: z.string() })

/** The plan ids of every plan card these persisted messages carry. */
export function shownPlans(rows: readonly { readonly cards: unknown }[]): ReadonlySet<string> {
  const shown = new Set<string>()
  for (const row of rows) {
    const cards = z.array(z.unknown()).safeParse(row.cards)
    if (!cards.success) continue
    for (const card of cards.data) {
      const parsed = persistedPlanCard.safeParse(card)
      if (parsed.success) shown.add(parsed.data.planId)
    }
  }
  return shown
}
