import type { CasePlan, EditPlanBody, PlanEditable } from '../../contracts/case-plan.ts'
import type { PlanProgress } from '../../contracts/holdings.ts'
import {
  type MarketPlan,
  type PlanEdit,
  type PlanEditField,
  type PlanGoal,
  PLAN_EDIT_FIELDS,
} from '../../contracts/market-plan.ts'
import { buildPlanRequestSchema, type BuildPlanRequest } from '../../contracts/market-tools.ts'
import { arrivalOpening } from './arrival.ts'
import { monthName, monthsBetween } from './home-arithmetic.ts'
import { buildPlan } from './plan.ts'
import type { AsOf, Market } from './types.ts'

/**
 * A plan edited in the app's profile (2026-11-12, the first-home experience, "6. The saving
 * months": "An edit lands in the chat").
 *
 * The plan is rebuilt with `buildPlan` from its own situation and goals with the edits applied,
 * on the inputs it was built on (`inputs`: filters, sort, choices), so the comparison re-runs on
 * the new figures and the arrival, hook question included, is worked out again. What the edit
 * does is stated as facts in the customer's figures: what changed, and which options now fit
 * or no longer fit. Never "better", never a pick (the lines Saoi holds).
 *
 * Pure: the route loads the market and the plan, and writes what this returns.
 */

const euro = (value: number): string => `€${Math.round(value).toLocaleString('en-IE')}`

/** The goal the profile's date belongs to: the leading house deposit, else the leading goal. */
export function editGoal(plan: MarketPlan): PlanGoal | null {
  const ranked = plan.goals
    .map((goal, index) => ({ goal, index }))
    .sort(
      (a, b) =>
        Number(b.goal.kind === 'house_deposit') - Number(a.goal.kind === 'house_deposit') ||
        (a.goal.priority ?? Number.MAX_SAFE_INTEGER) -
          (b.goal.priority ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index,
    )
  return ranked[0]?.goal ?? null
}

const isHome = (plan: MarketPlan): boolean =>
  plan.goals.some((goal) => goal.kind === 'house_deposit')

/** What the arrival's chips say was given ("New build"), not assumed ("Second-hand, assumed"). */
function fromChips(plan: MarketPlan): Pick<PlanEditable, 'propertyKind' | 'firstTimeBuyer'> {
  const chips = plan.arrival?.assumptions ?? []
  const has = (text: string) => chips.includes(text)
  return {
    propertyKind: has('New build')
      ? 'new_build'
      : has('Self-build')
        ? 'self_build'
        : has('Second-hand')
          ? 'second_hand'
          : null,
    firstTimeBuyer: has('First-time buyer') ? true : has('Bought before') ? false : null,
  }
}

/**
 * The figures the profile can change, read from the stored plan: its own inputs where it kept
 * them (plans built from 2026-11-12), else the arrival's chips and the comparison's price.
 */
export function editableOf(plan: MarketPlan): PlanEditable {
  const inputs = plan.inputs
  const chips = fromChips(plan)
  const home = isHome(plan)
  return {
    targetDate: editGoal(plan)?.targetDate?.slice(0, 7) ?? null,
    homePrice: home ? (inputs?.homePrice ?? plan.comparison?.priceEur ?? null) : null,
    monthlySaving: plan.situation.monthlySaving ?? null,
    propertyKind: home ? (inputs?.propertyKind ?? chips.propertyKind) : null,
    firstTimeBuyer: inputs?.firstTimeBuyer ?? (home ? chips.firstTimeBuyer : null),
    buyingTogether: inputs?.buyingTogether ?? null,
  }
}

/** The month the card names for the keys: the arrival's, else the comparison's. */
const keysOf = (plan: MarketPlan): string | null =>
  plan.arrival?.keysOn?.slice(0, 7) ?? plan.comparison?.keysOn?.slice(0, 7) ?? null

/** The cash needed at the keys: the comparison's, else the arrival's. */
const neededOf = (plan: MarketPlan): number | null =>
  plan.comparison?.neededAtKeysEur ?? plan.arrival?.progress?.neededEur ?? null

/**
 * The `saoi_build_plan` request the plan amounts to with `edits` applied: its situation and
 * goals as stored, the extras it kept (`inputs`), and the price the profile shows held, so a
 * change to the date or the saving does not move the price under them.
 */
export function rebuildRequest(plan: MarketPlan, edits: EditPlanBody): BuildPlanRequest {
  const inputs = plan.inputs ?? {}
  const shown = editableOf(plan)
  const goal = editGoal(plan)
  const home = isHome(plan)
  const firstTimeBuyer = edits.firstTimeBuyer ?? shown.firstTimeBuyer
  const homePrice = edits.homePrice ?? shown.homePrice
  const propertyKind = edits.propertyKind ?? shown.propertyKind
  const buyingTogether = edits.buyingTogether ?? shown.buyingTogether
  const monthlySaving = edits.monthlySaving ?? plan.situation.monthlySaving
  const preferences =
    inputs.homePreferences ??
    (plan.comparison === undefined ? undefined : { sortBy: plan.comparison.sortBy })
  const emergencyBufferMonths = inputs.emergencyBufferMonths

  const request = {
    situation: {
      summary: plan.situation.summary,
      ...(plan.situation.income === undefined ? {} : { income: plan.situation.income }),
      ...(plan.situation.outgoings === undefined ? {} : { outgoings: plan.situation.outgoings }),
      ...(monthlySaving === undefined ? {} : { monthlySaving }),
      savings: plan.situation.savings.map((item, index) => ({
        ...item,
        ...(inputs.savings?.[index] ?? {}),
      })),
      debts: plan.situation.debts.map((debt) => {
        const choice = inputs.debtPlans?.find((entry) => entry.debtId === debt.id)?.plan
        return choice === undefined ? debt : { ...debt, plan: choice }
      }),
      ...(firstTimeBuyer === null ? {} : { firstTimeBuyer }),
    },
    goals: plan.goals.map((candidate) =>
      candidate === goal && edits.targetDate !== undefined
        ? { ...candidate, targetDate: edits.targetDate }
        : candidate,
    ),
    ...(home && homePrice !== null ? { homePrice } : {}),
    ...(home && propertyKind !== null ? { propertyKind } : {}),
    ...(buyingTogether === null ? {} : { buyingTogether }),
    ...(inputs.taxPaidLastFourYearsEur === undefined
      ? {}
      : { taxPaidLastFourYearsEur: inputs.taxPaidLastFourYearsEur }),
    ...(inputs.county === undefined ? {} : { county: inputs.county }),
    ...(inputs.monthlyRentEur === undefined ? {} : { monthlyRentEur: inputs.monthlyRentEur }),
    ...(preferences === undefined ? {} : { homePreferences: preferences }),
    ...(inputs.emergencyBufferEur === undefined
      ? {}
      : { emergencyBufferEur: inputs.emergencyBufferEur }),
    ...(emergencyBufferMonths === undefined ? {} : { emergencyBufferMonths }),
    ...(inputs.keepAccessible === undefined ? {} : { keepAccessible: inputs.keepAccessible }),
    ...(inputs.goalDateCertain === undefined ? {} : { goalDateCertain: inputs.goalDateCertain }),
    ...(inputs.minLockGainEur === undefined ? {} : { minLockGainEur: inputs.minLockGainEur }),
    ...(inputs.minLockGainPctPerYear === undefined
      ? {}
      : { minLockGainPctPerYear: inputs.minLockGainPctPerYear }),
    ...(inputs.maxAccounts === undefined ? {} : { maxAccounts: inputs.maxAccounts }),
  }
  // The request schema decides what a value may be, as it does for the MCP's own call.
  return buildPlanRequestSchema.parse(request)
}

// ---- Which options fit ----------------------------------------------------------------------

const NUMBER_WORDS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
]
const numberWord = (n: number): string => NUMBER_WORDS[n - 1] ?? String(n)

/** "six-month deposits", "one-year deposits", "18-month deposits". */
export const termWords = (months: number): string =>
  months % 12 === 0 ? `${numberWord(months / 12)}-year` : `${numberWord(months)}-month`

/** "six months", "one year", "two years": a term in a phrase. */
const termPhrase = (months: number): string =>
  months % 12 === 0
    ? `${numberWord(months / 12)} year${months === 12 ? '' : 's'}`
    : `${numberWord(months)} months`

/** "the six-month deposits" or, past three, "deposits from 18 months to five years". */
function termsNamed(terms: readonly number[]): string {
  const sorted = [...terms].sort((a, b) => a - b)
  if (sorted.length > 3) {
    return `deposits from ${termPhrase(sorted[0] ?? 0)} to ${termPhrase(sorted.at(-1) ?? 0)}`
  }
  return `${joinAnd(sorted.map(termWords))} deposits`
}

/**
 * The fixed terms the market offers for a sum placed once, shortest first: what can end by a
 * date. The same ladders `show_products`' `fits_date` reads.
 */
function marketTerms(market: Market): number[] {
  const terms = new Set<number>()
  for (const product of market.products) {
    const deposit = product.terms
    if (deposit.kind !== 'deposit' || deposit.access !== 'fixed_term') continue
    if (deposit.takesLumpSum === false) continue
    for (const rung of deposit.ladder) terms.add(rung.months)
  }
  return [...terms].sort((a, b) => a - b)
}

/** The terms that end by the goal's date (all of them with no date; none when nothing locks). */
function termsFitting(plan: MarketPlan, terms: readonly number[], asOf: AsOf): number[] {
  if (plan.inputs?.keepAccessible === true || plan.inputs?.goalDateCertain === false) return []
  const date = editGoal(plan)?.targetDate
  if (date === undefined) return [...terms]
  const months = monthsBetween(asOf, date.slice(0, 7))
  return terms.filter((term) => term <= months)
}

/** "AIB 3-year fixed": a lender's option in the home comparison. */
const optionsOf = (plan: MarketPlan): string[] => [
  ...new Set((plan.comparison?.options ?? []).map((option) => `${option.lender} ${option.kind}`)),
]

// ---- The edit ---------------------------------------------------------------------------------

export type PlanChange = {
  readonly field: PlanEditField
  readonly from: PlanEditable[PlanEditField]
  readonly to: NonNullable<PlanEditable[PlanEditField]>
}

export type PlanEditEffects = {
  readonly keysOn: { readonly from: string | null; readonly to: string | null }
  readonly neededAtKeysEur: { readonly from: number | null; readonly to: number | null }
  /** Held towards the goal at its date, after DIRT, before and after (`position`). */
  readonly savedByGoalDate: {
    readonly from: { readonly at: string; readonly eur: number } | null
    readonly to: { readonly at: string; readonly eur: number } | null
  }
  /**
   * What fits now and did not: fixed-term deposits that end by the goal's date ("one-year
   * deposits"), and lender options in the home comparison ("AIB 3-year fixed").
   */
  readonly nowFit: readonly string[]
  /** What fitted and no longer does: a term past the new date, an option out of the comparison. */
  readonly noLongerFit: readonly string[]
}

export type PlanEditResult = {
  readonly plan: MarketPlan
  readonly changes: readonly PlanChange[]
  readonly effects: PlanEditEffects
  readonly reading: string
}

const MAX_EDITS = 20

/**
 * Applies `edits` to the plan: null when every value is what the plan already holds. The rebuilt
 * plan keeps its title's goal, `createdAt` (progress runs from when it was made) and the line the
 * conversation opened with, and records the edit.
 */
export function applyPlanEdit(
  market: Market,
  plan: MarketPlan,
  edits: EditPlanBody,
  asOf: AsOf,
  at: string,
): PlanEditResult | null {
  const before = editableOf(plan)
  const changes: PlanChange[] = PLAN_EDIT_FIELDS.flatMap((field): PlanChange[] => {
    const to = edits[field]
    return to === undefined || to === before[field] ? [] : [{ field, from: before[field], to }]
  })
  if (changes.length === 0) return null

  const built = buildPlan(market, rebuildRequest(plan, edits), asOf, plan.createdAt).plan
  const recorded: PlanEdit[] = changes.map((change) => ({
    at,
    field: change.field,
    from: change.from,
    to: change.to,
  }))
  const rebuilt: MarketPlan = {
    ...built,
    openedWith: plan.openedWith ?? arrivalOpening(plan.arrival),
    edits: [...(plan.edits ?? []), ...recorded].slice(-MAX_EDITS),
  }

  // Which options came in and went out: fixed terms by the goal's date, lenders by the comparison.
  const terms = marketTerms(market)
  const fitBefore = termsFitting(plan, terms, asOf)
  const fitAfter = termsFitting(rebuilt, terms, asOf)
  const termsGone = fitBefore.filter((term) => !fitAfter.includes(term))
  const termsNew = fitAfter.filter((term) => !fitBefore.includes(term))
  const optionsBefore = optionsOf(plan)
  const optionsAfter = optionsOf(rebuilt)
  const optionsGone = optionsBefore.filter((name) => !optionsAfter.includes(name))
  const optionsNew = optionsAfter.filter((name) => !optionsBefore.includes(name))
  const named = (list: readonly number[]) => list.map((term) => `${termWords(term)} deposits`)

  const position = (target: MarketPlan) =>
    target.position === undefined
      ? null
      : { at: target.position.at, eur: Math.round(target.position.towardsGoal) }
  const effects: PlanEditEffects = {
    keysOn: { from: keysOf(plan), to: keysOf(rebuilt) },
    neededAtKeysEur: { from: neededOf(plan), to: neededOf(rebuilt) },
    savedByGoalDate: { from: position(plan), to: position(rebuilt) },
    nowFit: [...named(termsNew), ...optionsNew],
    noLongerFit: [...named(termsGone), ...optionsGone],
  }
  return {
    plan: rebuilt,
    changes,
    effects,
    reading: readingOf({
      changes,
      effects,
      home: isHome(plan),
      terms: { gone: termsGone, new: termsNew, stillFit: fitAfter },
      options: {
        gone: optionsGone,
        new: optionsNew,
        none: plan.comparison !== undefined && rebuilt.comparison === undefined,
      },
    }),
  }
}

// ---- The reading --------------------------------------------------------------------------------

const KIND_WORDS = {
  new_build: 'a new build',
  second_hand: 'a second-hand home',
  self_build: 'a self-build',
} as const

const raiseOrLower = (from: unknown, to: number): string =>
  typeof from === 'number' ? (to > from ? 'Raising' : 'Lowering') : 'Setting'

function changePhrase(change: PlanChange, home: boolean): string {
  const { from, to } = change
  switch (change.field) {
    case 'targetDate': {
      const what = home ? 'the keys' : 'the goal'
      return from === null
        ? `Setting the date for ${what} to ${monthName(String(to))}`
        : `Moving ${what} to ${monthName(String(to))}`
    }
    case 'monthlySaving':
      return `${raiseOrLower(from, Number(to))} the monthly saving to ${euro(Number(to))}`
    case 'homePrice':
      return `${raiseOrLower(from, Number(to))} the price to ${euro(Number(to))}`
    case 'propertyKind':
      return `Making it ${to === 'new_build' || to === 'second_hand' || to === 'self_build' ? KIND_WORDS[to] : String(to)}`
    case 'firstTimeBuyer':
      return to === true
        ? 'Counting you as a first-time buyer'
        : 'Counting you as having bought before'
    case 'buyingTogether':
      return to === true ? 'Buying together' : 'Buying on your own'
  }
}

const lowerFirst = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`

/** "a", "a and b", "a, b and c". */
function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`
}

/** At most three names, then how many more. */
function listed(names: readonly string[]): string {
  const shown = names.slice(0, 3)
  const more = names.length - shown.length
  return joinAnd(more > 0 ? [...shown, `${String(more)} more`] : shown)
}

/**
 * One or two sentences of fact in their figures, in the spec's shape: "Moving the keys to March
 * 2028 means €6,000 less saved by then at this pace; the six-month deposits no longer fit, and
 * instant-access accounts do." Then, when the mortgage comparison changed, which lender options
 * left it and which came in.
 */
function readingOf(input: {
  readonly changes: readonly PlanChange[]
  readonly effects: PlanEditEffects
  readonly home: boolean
  readonly terms: {
    readonly gone: readonly number[]
    readonly new: readonly number[]
    readonly stillFit: readonly number[]
  }
  readonly options: {
    readonly gone: readonly string[]
    readonly new: readonly string[]
    /** The comparison had options and has none now. */
    readonly none: boolean
  }
}): string {
  const { changes, effects, home } = input
  const fields = new Set(changes.map((change) => change.field))
  const phrases = changes.map((change, index) => {
    const phrase = changePhrase(change, home)
    return index === 0 ? phrase : lowerFirst(phrase)
  })

  const parts: string[] = []
  const saved = effects.savedByGoalDate
  if ((fields.has('targetDate') || fields.has('monthlySaving')) && saved.from && saved.to) {
    const difference = saved.to.eur - saved.from.eur
    if (Math.abs(difference) >= 1) {
      const when = fields.has('targetDate') ? 'by then' : `by ${monthName(saved.to.at)}`
      const pace = fields.has('monthlySaving') ? '' : ' at this pace'
      parts.push(
        `${euro(Math.abs(difference))} ${difference > 0 ? 'more' : 'less'} saved ${when}${pace}`,
      )
    }
  }
  const needed = effects.neededAtKeysEur
  if (needed.from !== null && needed.to !== null && Math.abs(needed.to - needed.from) >= 1) {
    const difference = needed.to - needed.from
    parts.push(
      `${euro(Math.abs(difference))} ${difference > 0 ? 'more' : 'less'} needed at the keys (${euro(needed.to)} in all)`,
    )
  }
  const keys = effects.keysOn
  if (keys.from !== keys.to && !input.options.none) {
    parts.push(
      keys.to === null
        ? 'the money needed is not reached at this pace'
        : keys.from === null
          ? `the money needed is held by ${monthName(keys.to)}`
          : `the keys month moves from ${monthName(keys.from)} to ${monthName(keys.to)}`,
    )
  }

  if (input.options.none) parts.push('no mortgage option in the comparison fits these figures')

  const { gone, new: arrived, stillFit } = input.terms
  const longest = stillFit.at(-1)
  const fits =
    gone.length > 0
      ? `the ${termsNamed(gone)} no longer fit, and ${
          longest === undefined
            ? 'instant-access accounts do'
            : `deposits of up to ${termPhrase(longest)} still do`
        }`
      : arrived.length > 0
        ? `${termsNamed(arrived)} now fit`
        : null

  const subject = joinAnd(phrases)
  const first =
    parts.length > 0
      ? `${subject} means ${joinAnd(parts)}${fits === null ? '' : `; ${fits}`}.`
      : effects.keysOn.to !== null && effects.neededAtKeysEur.to !== null
        ? `${subject} leaves the keys month at ${monthName(effects.keysOn.to)} and the money needed at the keys at ${euro(effects.neededAtKeysEur.to)}${fits === null ? '' : `; ${fits}`}.`
        : `${subject} leaves the figures as they were${fits === null ? '' : `; ${fits}`}.`

  const options = input.options
  const verb = (names: readonly string[], one: string, many: string) =>
    names.length === 1 ? one : many
  const second = options.none
    ? null
    : options.gone.length > 0
      ? `In the mortgage comparison, ${listed(options.gone)} no longer ${verb(options.gone, 'fits', 'fit')}${
          options.new.length > 0
            ? `, and ${listed(options.new)} ${verb(options.new, 'does', 'do')}`
            : ''
        }.`
      : options.new.length > 0
        ? `In the mortgage comparison, ${listed(options.new)} now ${verb(options.new, 'fits', 'fit')}.`
        : null

  return second === null ? first : `${first} ${second}`
}

// ---- The profile's view -----------------------------------------------------------------------

const euroWhole = (value: number): string => `€${Math.round(value).toLocaleString('en-IE')}`

/** The plan's first three options in the customer's order: lenders for a home, else products. */
export function watchedOf(plan: MarketPlan): CasePlan['watched'] {
  const comparison = plan.comparison
  if (comparison !== undefined && comparison.options.length > 0) {
    return comparison.options.slice(0, 3).map((option) => ({
      lead: option.lender,
      kind: option.kind,
      value: `${String(Math.round(option.ratePct * 100) / 100)}%`,
      figure:
        comparison.sortBy === 'monthly_repayment'
          ? `${euroWhole(option.monthlyEur)}/mo`
          : comparison.sortBy === 'keys_date'
            ? option.keysOn === null
              ? 'not reached'
              : monthName(option.keysOn.slice(0, 7))
            : `${euroWhole(option.fiveYearCostEur)} over 5 years`,
    }))
  }
  return plan.combination.products.slice(0, 3).map((product) => ({
    lead: product.providerName,
    kind: product.productName,
    value: product.ratePct === undefined ? 'rate not given' : `${product.ratePct.toFixed(2)}%`,
    figure: [
      product.amount === undefined ? null : `${euroWhole(product.amount)} once`,
      product.monthlyAmount === undefined ? null : `${euroWhole(product.monthlyAmount)} a month`,
    ]
      .filter((part): part is string => part !== null)
      .join(' + '),
  }))
}

/** The profile's view of a claimed plan, with progress over the holdings. */
export function casePlanOf(
  claimed: { readonly id: string; readonly plan: MarketPlan },
  progress: PlanProgress | null,
): CasePlan {
  const { plan } = claimed
  return {
    planId: claimed.id,
    title: plan.title,
    editable: editableOf(plan),
    summary: {
      keysOn: keysOf(plan),
      neededAtKeysEur: neededOf(plan),
      savedEur:
        progress?.goal === 'house_deposit'
          ? progress.savedNowEur
          : plan.situation.savings.reduce((sum, item) => sum + item.balance, 0),
      progressLine: progress?.line ?? null,
    },
    watched: watchedOf(plan),
    updatedAt: plan.edits?.at(-1)?.at ?? plan.createdAt,
  }
}

// ---- Reminders --------------------------------------------------------------------------------

export type ReminderToMove = {
  readonly id: string
  readonly kind: 'fixed_rate_ends' | 'deposit_matures' | 'other'
  readonly label: string
  readonly productId: string | null
  readonly from: string
  readonly to: string
}

/** The same day in another month, kept within it: the 31st of March to the 30th of April. */
function sameDayIn(day: string, month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const last = new Date(Date.UTC(year ?? 1970, monthNumber ?? 1, 0)).getUTCDate()
  const date = Math.min(Number(day.slice(8, 10)), last)
  return `${month}-${String(date).padStart(2, '0')}`
}

/**
 * The reminders that came from the plan's dates and move with them: a date reminder (`other`,
 * not kept by a holding, which has its own date) in the month the goal date or the keys month
 * was, moved to the same day of the month it is now. A move into the past is left alone.
 */
export function remindersToMove(input: {
  readonly reminders: readonly {
    readonly id: string
    readonly kind: ReminderToMove['kind']
    readonly label: string
    readonly dueOn: string
    readonly productId: string | null
  }[]
  /** Reminders a holding keeps: theirs, not the plan's. */
  readonly heldBy: ReadonlySet<string>
  readonly moves: readonly { readonly from: string | null; readonly to: string | null }[]
  readonly today: string
}): ReminderToMove[] {
  const moves = input.moves.flatMap((move) =>
    move.from === null || move.to === null || move.from === move.to
      ? []
      : [{ from: move.from.slice(0, 7), to: move.to.slice(0, 7) }],
  )
  return input.reminders.flatMap((reminder): ReminderToMove[] => {
    if (reminder.kind !== 'other' || input.heldBy.has(reminder.id)) return []
    const move = moves.find((candidate) => candidate.from === reminder.dueOn.slice(0, 7))
    if (move === undefined) return []
    const to = sameDayIn(reminder.dueOn, move.to)
    if (to < input.today) return []
    return [
      {
        id: reminder.id,
        kind: reminder.kind,
        label: reminder.label,
        productId: reminder.productId,
        from: reminder.dueOn,
        to,
      },
    ]
  })
}
