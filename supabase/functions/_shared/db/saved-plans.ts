import { z } from 'zod'
import type { Card } from '../contracts/cards.ts'
import { marketPlanSchema, type MarketPlan, type PlanProduct } from '../contracts/market-plan.ts'
import { factCatalogue, type FactKey } from '../domain/facts.ts'
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
  pay_off_first: 'pay off first',
  overpay: 'overpay',
  keep_paying: 'keep paying as now',
  refinance: 'refinance',
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
    products: plan.recommendation.products.map((product) => ({
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
        plan.recommendation.products
          .map((product) => product.attribution)
          .filter((line): line is string => line !== undefined),
      ),
    ].slice(0, 4),
    createdAt: plan.createdAt,
    dataCheckedAt: plan.dataCheckedAt,
  }
}

/**
 * What the model is told about the plan, for the digest.
 *
 * The products in the plan's own order, so "what is next" is the first of them and the model
 * does not have to choose. Figures are the plan's; the model is told the card shows them.
 */
export function savedPlanDigestLines(claimed: ClaimedPlan): string[] {
  const { plan } = claimed
  const first = plan.recommendation.products[0]
  const firstDebt = debtLines(plan)[0]
  return [
    `Title: ${plan.title}`,
    `Made: ${dayOf(plan.createdAt)}, in their own AI assistant, with Saoi's market data (checked ${dayOf(plan.dataCheckedAt)}).`,
    `Their situation, as they described it: ${plan.situation.summary}`,
    `Goals: ${plan.goals
      .map((goal) => {
        const target = goalTarget(goal)
        return target === null ? goal.label : `${goal.label} (${target})`
      })
      .join('; ')}`,
    ...plan.recommendation.products.map((product, index) => {
      const amounts = amountsOf(product)
      return (
        `Step ${String(index + 1)}: ${ROLE_LABELS[product.role]}, ${product.productName} with ${product.providerName}` +
        (amounts.length === 0 ? '' : `, ${amounts.join(' and ')}`) +
        (product.checks.length === 0 ? '' : `. Check first: ${product.checks.join('; ')}`)
      )
    }),
    ...debtLines(plan).map((line) => `Debt: ${line}`),
    `Ranked by: ${plan.ranking.basis}`,
    `Next: ${
      first !== undefined
        ? `${ROLE_LABELS[first.role].toLowerCase()} with ${first.providerName} (${first.productName}). Saoi cannot open it for them; they apply with ${first.providerName} directly.`
        : firstDebt !== undefined
          ? firstDebt
          : 'ask which part of the plan they want to start with.'
    }`,
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
 * Mapped: take-home pay, rent, other outgoings, what they can save a month, savings held (the
 * sum of what they listed), credit card balances (summed), loan repayments (summed, only when
 * every loan states one), and the leading goal as the objective, its target and its date.
 * Not mapped: gross income, because `income.annualBasic` is basic salary and a gross figure
 * may include a bonus; and anything the catalogue's own schema refuses. Every one is recorded
 * as `customer_stated`: the customer said it, to their AI.
 */
export function factsFromPlan(plan: MarketPlan): PlanFact[] {
  const { situation } = plan
  const candidates: PlanFact[] = []
  const add = (key: FactKey, subject: PlanFact['subject'], value: unknown) => {
    if (value === undefined) return
    candidates.push({ key, subject, value })
  }
  const whole = (amount: number | undefined) =>
    amount === undefined ? undefined : Math.round(amount)

  add('income.netMonthly', 'primary', whole(situation.income?.netMonthly))
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
      const plan = marketPlanSchema.safeParse(row.document)
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
