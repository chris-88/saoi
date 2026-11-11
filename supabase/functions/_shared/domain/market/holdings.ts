import type { REMINDER_KINDS } from '../../contracts/alerts.ts'
import {
  type Holding,
  type HoldingKind,
  type PlanProgress,
  isAssetKind,
} from '../../contracts/holdings.ts'
import type { MarketPlan, PlanGoal } from '../../contracts/market-plan.ts'
import { monthName, monthsBetween, reachedBeforeInterest } from './home-arithmetic.ts'
import { shortDate } from './alerts.ts'
import { addMonths } from './simulate.ts'

/**
 * Holdings (design `2026-11-11-saoi-holdings-design`), pure: the first holdings a claimed plan
 * gives a case, where the holdings leave the plan, and the reminder a holding's own date needs.
 * Every line is a fact with its figures: nothing praises, nothing asks anything of the customer.
 */

/** A holding before it is stored. */
export type HoldingDraft = Pick<
  Holding,
  | 'kind'
  | 'label'
  | 'provider'
  | 'productId'
  | 'balance'
  | 'ratePct'
  | 'monthlyAmountEur'
  | 'fixedUntil'
  | 'notedOn'
  | 'source'
>

/** What progress reads from a holding. */
export type HoldingFigures = Pick<Holding, 'kind' | 'balance' | 'monthlyAmountEur'>

const PLAN_DEBT_TO_HOLDING: Readonly<
  Record<MarketPlan['situation']['debts'][number]['kind'], HoldingKind>
> = {
  credit_card: 'credit_card',
  personal_loan: 'personal_loan',
  car_finance: 'car_finance',
  overdraft: 'overdraft',
  mortgage: 'mortgage',
  other: 'other_debt',
}

/** A savings line the customer described as a fixed-term deposit. */
const FIXED_TERM = /\b(fixed[- ]?term|term deposit|fixed deposit)\b/i
/** A savings line the customer described as a current account (money not in savings). */
const CURRENT_ACCOUNT = /\bcurrent account\b/i

const round2 = (amount: number): number => Math.round(amount * 100) / 100

/**
 * The plan's situation as the case's first holdings: each savings line (a `deposit` when its
 * label says fixed term, `current` when it says current account, else `savings`) and each debt (kind mapped; `other` is `other_debt`),
 * noted on `notedOn` (the plan's date) with `source: 'plan'`.
 */
export function holdingsFromPlan(plan: MarketPlan, notedOn: string): HoldingDraft[] {
  const savings = plan.situation.savings.map((account): HoldingDraft => ({
    kind: FIXED_TERM.test(account.label)
      ? 'deposit'
      : CURRENT_ACCOUNT.test(account.label)
        ? 'current'
        : 'savings',
    label: account.label,
    provider: account.provider ?? null,
    productId: null,
    balance: round2(account.balance),
    ratePct: account.aerPct ?? null,
    monthlyAmountEur: null,
    fixedUntil: null,
    notedOn,
    source: 'plan',
  }))
  const debts = plan.situation.debts.map((debt): HoldingDraft => ({
    kind: PLAN_DEBT_TO_HOLDING[debt.kind],
    label: debt.label,
    provider: null,
    productId: null,
    balance: round2(debt.balance),
    ratePct: debt.ratePct ?? null,
    monthlyAmountEur: debt.monthlyRepayment === undefined ? null : round2(debt.monthlyRepayment),
    fixedUntil: null,
    notedOn,
    source: 'plan',
  }))
  return [...savings, ...debts]
}

const euro = (amount: number): string => `€${Math.round(amount).toLocaleString('en-IE')}`
const sum = (amounts: readonly number[]): number => round2(amounts.reduce((a, b) => a + b, 0))

/** The leading house-deposit or debt goal: by priority (unset last), then the plan's order. */
function trackedGoal(plan: MarketPlan): PlanGoal | null {
  const ranked = plan.goals
    .map((goal, index) => ({ goal, index }))
    .filter(({ goal }) => goal.kind === 'house_deposit' || goal.kind === 'pay_off_debt')
    .sort(
      (a, b) =>
        (a.goal.priority ?? Number.MAX_SAFE_INTEGER) -
          (b.goal.priority ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    )
  return ranked[0]?.goal ?? null
}

/**
 * Where the holdings leave the claimed plan on `today` (YYYY-MM-DD), for its leading
 * house-deposit or debt goal; null when it has neither.
 *
 * House deposit: held now (the accounts, else the plan's own savings) against the cash the plan
 * needs at the keys, the month that is held at this pace before interest (the same arithmetic
 * as the plan's keys date), and the difference from the plan's own path: its savings plus its
 * monthly saving for each month since it was made.
 *
 * Debt: owed now (the debts other than a mortgage, else the plan's) against what the plan said,
 * and the months left at the repayment, before interest.
 */
export function planProgress(
  plan: MarketPlan,
  holdings: readonly HoldingFigures[],
  today: string,
): PlanProgress | null {
  const goal = trackedGoal(plan)
  if (goal === null) return null
  const thisMonth = today.slice(0, 7)
  const planMonth = plan.createdAt.slice(0, 7)

  if (goal.kind === 'house_deposit') {
    const accounts = holdings.filter((holding) => isAssetKind(holding.kind))
    const planSaved = sum(plan.situation.savings.map((account) => account.balance))
    const savedFrom = accounts.length > 0 ? 'holdings' : 'plan'
    const savedNowEur =
      savedFrom === 'holdings' ? sum(accounts.map((holding) => holding.balance)) : planSaved
    const neededEur = plan.comparison?.neededAtKeysEur ?? goal.targetAmount ?? null
    const accountMonthly = sum(accounts.map((holding) => holding.monthlyAmountEur ?? 0))
    const monthlyEur = accountMonthly > 0 ? accountMonthly : (plan.situation.monthlySaving ?? null)
    const monthAtThisPace =
      neededEur === null
        ? null
        : reachedBeforeInterest(savedNowEur, neededEur, monthlyEur ?? 0, thisMonth)
    const planExpectedNowEur = round2(
      planSaved + (plan.situation.monthlySaving ?? 0) * monthsBetween(planMonth, thisMonth),
    )
    const differenceEur = savedFrom === 'holdings' ? round2(savedNowEur - planExpectedNowEur) : null
    return {
      goal: 'house_deposit',
      goalLabel: goal.label,
      savedNowEur,
      savedFrom,
      neededEur,
      monthlyEur,
      monthAtThisPace,
      planExpectedNowEur,
      differenceEur,
      line: depositLine({
        savedNowEur,
        savedFrom,
        neededEur,
        monthlyEur,
        monthAtThisPace,
        differenceEur,
      }),
    }
  }

  const debts = holdings.filter(
    (holding) => !isAssetKind(holding.kind) && holding.kind !== 'mortgage',
  )
  const planDebts = plan.situation.debts.filter((debt) => debt.kind !== 'mortgage')
  const owedFrom = debts.length > 0 ? 'holdings' : 'plan'
  const planOwedEur = sum(planDebts.map((debt) => debt.balance))
  const owedNowEur = owedFrom === 'holdings' ? sum(debts.map((debt) => debt.balance)) : planOwedEur
  const repaid =
    owedFrom === 'holdings'
      ? sum(debts.map((debt) => debt.monthlyAmountEur ?? 0))
      : sum(planDebts.map((debt) => debt.monthlyRepayment ?? 0))
  const monthlyEur = repaid > 0 ? repaid : null
  const monthsLeft = monthlyEur === null ? null : Math.ceil(owedNowEur / monthlyEur)
  const clearedIn = monthsLeft === null ? null : addMonths(thisMonth, monthsLeft)
  const changeEur = round2(owedNowEur - planOwedEur)
  return {
    goal: 'pay_off_debt',
    goalLabel: goal.label,
    owedNowEur,
    owedFrom,
    planOwedEur,
    changeEur,
    monthlyEur,
    monthsLeft,
    clearedIn,
    line: debtLine({ owedNowEur, owedFrom, planOwedEur, monthlyEur, monthsLeft, clearedIn }),
  }
}

function depositLine(p: {
  savedNowEur: number
  savedFrom: 'holdings' | 'plan'
  neededEur: number | null
  monthlyEur: number | null
  monthAtThisPace: string | null
  differenceEur: number | null
}): string {
  const held = p.neededEur !== null && p.savedNowEur >= p.neededEur
  const saved =
    p.neededEur === null
      ? `${euro(p.savedNowEur)} saved`
      : held
        ? `${euro(p.savedNowEur)} saved, ${euro(p.neededEur)} needed at the keys`
        : `${euro(p.savedNowEur)} of ${euro(p.neededEur)} saved`
  const opening = p.savedFrom === 'plan' ? `No accounts entered yet; the plan had ${saved}` : saved
  let pace = ''
  if (held) {
    pace = ''
  } else if (p.monthlyEur !== null && p.monthlyEur > 0 && p.monthAtThisPace !== null) {
    pace = `; at ${euro(p.monthlyEur)} a month that is ${monthName(p.monthAtThisPace)}`
  } else if (p.monthlyEur === null || p.monthlyEur === 0) {
    pace = '; no monthly saving given'
  }
  let path = ''
  if (p.differenceEur !== null) {
    const difference = Math.round(p.differenceEur)
    path =
      difference > 0
        ? `, ${euro(difference)} ahead of the plan's path`
        : difference < 0
          ? `, ${euro(-difference)} behind the plan's path`
          : ", on the plan's path"
  }
  return `${opening}${pace}${path}.`
}

function debtLine(p: {
  owedNowEur: number
  owedFrom: 'holdings' | 'plan'
  planOwedEur: number
  monthlyEur: number | null
  monthsLeft: number | null
  clearedIn: string | null
}): string {
  const owed =
    p.owedFrom === 'plan'
      ? `No debts entered yet; the plan had ${euro(p.owedNowEur)} owed`
      : p.owedNowEur === 0
        ? `Nothing owed now, ${euro(p.planOwedEur)} when the plan was made`
        : `${euro(p.owedNowEur)} owed, ${euro(p.planOwedEur)} when the plan was made`
  if (p.owedNowEur === 0) return `${owed}.`
  const pace =
    p.monthlyEur !== null && p.monthsLeft !== null && p.clearedIn !== null
      ? `; at ${euro(p.monthlyEur)} a month that is ${String(p.monthsLeft)} month${p.monthsLeft === 1 ? '' : 's'}, to ${monthName(p.clearedIn)}, before interest`
      : '; no repayment given'
  return `${owed}${pace}.`
}

export type HoldingReminder = {
  readonly kind: (typeof REMINDER_KINDS)[number]
  readonly label: string
  readonly dueOn: string
  readonly productId: string | null
}

const FIXED_RATE_KINDS: ReadonlySet<HoldingKind> = new Set([
  'mortgage',
  'personal_loan',
  'car_finance',
  'other_debt',
])

/**
 * The reminder a holding's own date needs: a fixed rate ending on a mortgage or a loan, a
 * deposit maturing, or another dated rate (a savings bonus, a card's offer). Null when it has no
 * date, or (given `today`, YYYY-MM-DD) the date has passed.
 */
export function reminderForHolding(
  holding: Pick<Holding, 'kind' | 'label' | 'fixedUntil' | 'productId'>,
  today?: string,
): HoldingReminder | null {
  if (holding.fixedUntil === null) return null
  if (today !== undefined && holding.fixedUntil < today) return null
  const kind = FIXED_RATE_KINDS.has(holding.kind)
    ? 'fixed_rate_ends'
    : holding.kind === 'deposit'
      ? 'deposit_matures'
      : 'other'
  const what =
    kind === 'fixed_rate_ends'
      ? 'fixed rate ends'
      : kind === 'deposit_matures'
        ? 'matures'
        : 'rate date'
  return {
    kind,
    label: `${holding.label}: ${what}`,
    dueOn: holding.fixedUntil,
    productId: holding.productId,
  }
}

/** One holding as a digest line: "BoI savings (savings, Bank of Ireland): €12,000 at 2%, noted 11 Nov 2026". */
export function holdingLine(
  holding: Pick<
    Holding,
    | 'kind'
    | 'label'
    | 'provider'
    | 'balance'
    | 'ratePct'
    | 'monthlyAmountEur'
    | 'fixedUntil'
    | 'notedOn'
  >,
): string {
  const asset = isAssetKind(holding.kind)
  const what = `${holding.label} (${holding.kind.replace('_', ' ')}${holding.provider === null ? '' : `, ${holding.provider}`})`
  const rate = holding.ratePct === null ? '' : ` at ${String(holding.ratePct)}%`
  const monthly =
    holding.monthlyAmountEur === null
      ? ''
      : `, ${euro(holding.monthlyAmountEur)} a month ${asset ? 'in' : 'repaid'}`
  const fixed =
    holding.fixedUntil === null
      ? ''
      : `, ${holding.kind === 'deposit' ? 'matures' : 'fixed until'} ${shortDate(holding.fixedUntil)}`
  return `${what}: ${euro(holding.balance)} ${asset ? 'held' : 'owed'}${rate}${monthly}${fixed}; noted ${shortDate(holding.notedOn)}`
}
