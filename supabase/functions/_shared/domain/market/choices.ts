import type { MarketProductsCard, ProductComparisonCard } from '../../contracts/cards.ts'
import type { CasePlanChoices } from '../../contracts/case-plan.ts'
import {
  PLAN_CHOICE_SLOTS,
  type MarketPlan,
  type PlanChoice,
  type PlanChoiceSlot,
  type StoredPlanChoice,
} from '../../contracts/market-plan.ts'
import { headlineRate as recordRate } from './alerts.ts'
import { resolve, rowFacts } from './compare.ts'
import { displayName, euro } from './figures.ts'
import { monthName, shortMonth } from './home-arithmetic.ts'
import { pct } from './product.ts'
import {
  type CaseFigures,
  isRegularSaver,
  productsCard,
  type ProductsCategory,
  type ShowProductsRequest,
} from './products-card.ts'
import { ratePeriod } from './rate-period.ts'
import { addMonths } from './simulate.ts'
import type { AsOf, Market } from './types.ts'

/**
 * What the customer chose for each part of the plan (Chris, 2026-11-13: "the goal is to get the
 * customer to pick products from the product lists we're presenting, so that we have a goal in
 * mind of what they're going to do"). Three parts, `PLAN_CHOICE_SLOTS`: the sum held, the
 * monthly saving and the mortgage.
 *
 * A choice is the customer's. It is committed from a card through the plan's choice route
 * (Invariant 1); the model has no tool that makes one. The route sends only the row id: every
 * word stored is rebuilt here from the market on the products card's rules (`productsCard`, the
 * cards the case has been shown first), or for a mortgage from the plan's own comparison options.
 *
 * Every line here is a fact or a question to the customer: nothing is called better, best or
 * right for them (`adviceWordsIn` holds each). Pure.
 */

/** How each part reads in a sentence. */
export const SLOT_WORDS: Readonly<Record<PlanChoiceSlot, string>> = {
  lump_sum: 'lump sum',
  monthly_saving: 'monthly saving',
  mortgage: 'mortgage',
}

const whole = (value: number): string => euro(Math.round(value))

// ---- Mortgage options' row ids ------------------------------------------------------------------

type ComparisonOption = NonNullable<MarketPlan['comparison']>['options'][number]

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

/**
 * A mortgage option's row id: the lender's market product id the comparison carried (plans from
 * 2026-11-13, the id a mortgage products card's row has too), else one made from the lender, the
 * product and the kind, stable for the same option in an older plan.
 */
export function mortgageOptionRowId(option: ComparisonOption): string {
  if (option.rowId !== undefined) return option.rowId
  return `mortgage:${slug(option.lender)}.${slug(option.productName)}.${slug(option.kind)}`.slice(
    0,
    160,
  )
}

// ---- Reading choices ------------------------------------------------------------------------------

/** What the customer sees of a stored choice: no reminder id, no market rows watched. */
export function publicChoice(choice: StoredPlanChoice): PlanChoice {
  return {
    slot: choice.slot,
    rowId: choice.rowId,
    lead: choice.lead,
    ...(choice.providerId === undefined ? {} : { providerId: choice.providerId }),
    kind: choice.kind,
    value: choice.value,
    figure: choice.figure,
    chosenAt: choice.chosenAt,
    ...(choice.endsOn === undefined ? {} : { endsOn: choice.endsOn }),
  }
}

/** The plan's choices, each part null when open. */
export function choicesOf(plan: MarketPlan): CasePlanChoices {
  const stored = plan.choices ?? {}
  const of = (slot: PlanChoiceSlot): PlanChoice | null => {
    const choice = stored[slot]
    return choice === undefined ? null : publicChoice(choice)
  }
  return {
    lump_sum: of('lump_sum'),
    monthly_saving: of('monthly_saving'),
    mortgage: of('mortgage'),
  }
}

const heldIn = (plan: MarketPlan): number =>
  plan.situation.savings.reduce((sum, account) => sum + account.balance, 0)

/**
 * The parts this plan has: a lump sum when it holds savings, a monthly saving when it has one,
 * a mortgage when it compares lenders. A part already chosen always counts.
 */
export function slotsOf(plan: MarketPlan): PlanChoiceSlot[] {
  const has: Readonly<Record<PlanChoiceSlot, boolean>> = {
    lump_sum: heldIn(plan) > 0,
    monthly_saving: (plan.situation.monthlySaving ?? 0) > 0,
    mortgage: (plan.comparison?.options.length ?? 0) > 0,
  }
  return PLAN_CHOICE_SLOTS.filter((slot) => has[slot] || plan.choices?.[slot] !== undefined)
}

/** The first part of the plan still open, in the order lump sum, monthly saving, mortgage. */
export function nextOpenSlot(plan: MarketPlan): PlanChoiceSlot | null {
  return slotsOf(plan).find((slot) => plan.choices?.[slot] === undefined) ?? null
}

/** Every part the plan has is chosen (and it has at least one). */
export function allChosen(plan: MarketPlan): boolean {
  return slotsOf(plan).length > 0 && nextOpenSlot(plan) === null
}

/**
 * The question that decides an open part, in their figures, naming no product: the customer
 * chooses from the cards. "Which account is the one for your €32,000?"
 */
export function slotQuestion(slot: PlanChoiceSlot, plan: MarketPlan): string {
  switch (slot) {
    case 'lump_sum': {
      const held = heldIn(plan)
      return held > 0
        ? `Which account is the one for your ${whole(held)}?`
        : 'Which account is the one for the sum you hold?'
    }
    case 'monthly_saving': {
      const monthly = plan.situation.monthlySaving ?? 0
      return monthly > 0
        ? `Which account is the one for your ${whole(monthly)} a month?`
        : 'Which account is the one for the monthly saving?'
    }
    case 'mortgage': {
      const price = plan.comparison?.priceEur
      return price === undefined
        ? 'Which mortgage option is the one for you?'
        : `Which mortgage is the one for your ${whole(price)} home?`
    }
  }
}

/** "1 January 2027". */
const longDay = (day: string): string =>
  `${String(Number(day.slice(8, 10)))} ${monthName(day.slice(0, 7))}`

const listWords = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`

/**
 * What the plan does once every part is chosen, from what is stored: the reminders kept for the
 * ends of the rates and terms chosen, the alerts on their rates, and what a return says. Said
 * once, after the last choice; nothing is asked after it.
 */
export function allChosenLine(plan: MarketPlan): string {
  const chosen = PLAN_CHOICE_SLOTS.flatMap((slot) => {
    const choice = plan.choices?.[slot]
    return choice === undefined ? [] : [choice]
  })
  const ends = chosen.flatMap((choice) =>
    choice.endsOn === undefined ? [] : [`${choice.lead} on ${longDay(choice.endsOn)}`],
  )
  return (
    `Every part of the plan is chosen: ${listWords(
      chosen.map((choice) => `${choice.lead} for the ${SLOT_WORDS[choice.slot]}`),
    )}. The plan now follows them: ` +
    (ends.length === 0
      ? 'none of them has a rate or term end to be reminded of; '
      : `a reminder 90, 60, 30 and 7 days before ${listWords(ends.map((end) => `the end of ${end}`))}, and on the day; `) +
    'an alert when a rate on any of them changes or one is no longer offered; and, when you come back, what changed since.'
  )
}

/** One choice in the digest: "bunq Savings Account (€815 by Jul 2028)". */
const choiceWords = (choice: StoredPlanChoice): string =>
  choice.slot === 'mortgage'
    ? `${choice.lead}, ${choice.kind} (${choice.value}, ${choice.figure})`
    : `${choice.lead} (${choice.figure})`

/**
 * The digest's lines for the choices: each part chosen or open, then the next open part's
 * deciding question, or that every part is chosen and what the plan now does was said once.
 */
export function choicesDigestLines(plan: MarketPlan): string[] {
  const slots = slotsOf(plan)
  if (slots.length === 0) return []
  const line = `Choices, theirs, made on the cards (never made for them): ${slots
    .map((slot) => {
      const choice = plan.choices?.[slot]
      return `${SLOT_WORDS[slot]}: ${choice === undefined ? 'open' : choiceWords(choice)}`
    })
    .join('; ')}.`
  const next = nextOpenSlot(plan)
  if (next !== null) {
    return [
      line,
      `Next open part: the ${SLOT_WORDS[next]}. Its deciding question, in their figures: "${slotQuestion(next, plan)}"`,
    ]
  }
  return [
    line,
    `Every part is chosen. What the plan now does was told them once, when the last was chosen: "${allChosenLine(plan)}" Do not say it again unless asked, and put no product question to them.`,
  ]
}

// ---- Rebuilding a row by id -----------------------------------------------------------------------

/** A choice as the route stores it, before the time and the reminder are added. */
export type ChoiceDraft = Omit<StoredPlanChoice, 'chosenAt' | 'reminderId' | 'endsOn'>

export type ChoiceReminder = {
  readonly kind: 'fixed_rate_ends' | 'deposit_matures' | 'other'
  readonly label: string
  /** YYYY-MM-DD. */
  readonly dueOn: string
  readonly productId: string | null
}

export type ChoiceResult =
  | {
      readonly kind: 'choice'
      readonly choice: ChoiceDraft
      /** The rate's or term's end, and the reminder kept for it; null when it has none. */
      readonly end: { readonly on: string; readonly reminder: ChoiceReminder } | null
    }
  | {
      readonly kind: 'refused'
      /** `unknown_row`: no card the case could show holds it. `wrong_slot`: it is not that kind. */
      readonly code: 'unknown_row' | 'wrong_slot'
      readonly reason: string
    }

type CardRow = MarketProductsCard['rows'][number]

const isMortgageRequest = (request: ShowProductsRequest): boolean =>
  request.arrangement === 'mortgage_by_sort' || request.category === 'mortgages'

/**
 * The cards to look a row up on, in order: those the case was shown (newest first), then the
 * arrangements `show_products` builds by default. For the monthly saving the cards about the
 * monthly saving come first, for the lump sum the others: a row's figure differs between them.
 */
function savingsRequests(
  slot: 'lump_sum' | 'monthly_saving',
  shown: readonly ShowProductsRequest[],
  dated: boolean,
): ShowProductsRequest[] {
  const arrangements = dated
    ? (['fits_date', 'by_access', 'held_vs_market'] as const)
    : (['by_access', 'held_vs_market'] as const)
  const categories: (ProductsCategory | undefined)[] = [undefined, 'savings', 'deposits']
  const defaults: ShowProductsRequest[] = arrangements.flatMap((arrangement) =>
    categories.flatMap((category): ShowProductsRequest[] => [
      { arrangement, category },
      ...(arrangement === 'held_vs_market'
        ? []
        : [{ arrangement, category, focus: 'monthly' as const }]),
    ]),
  )
  const all = [...shown.filter((request) => !isMortgageRequest(request)), ...defaults]
  const wantMonthly = slot === 'monthly_saving'
  return [
    ...all.filter((request) => (request.focus === 'monthly') === wantMonthly),
    ...all.filter((request) => (request.focus === 'monthly') !== wantMonthly),
  ]
}

function mortgageRequests(shown: readonly ShowProductsRequest[]): ShowProductsRequest[] {
  return [
    ...shown.filter(isMortgageRequest),
    ...(['five_year_cost', 'monthly_repayment', 'keys_date'] as const).map(
      (sortBy): ShowProductsRequest => ({ arrangement: 'mortgage_by_sort', sortBy }),
    ),
  ]
}

function rowOnCards(
  market: Market,
  figures: CaseFigures,
  requests: readonly ShowProductsRequest[],
  rowId: string,
  asOf: AsOf,
): CardRow | null {
  for (const request of requests) {
    const result = productsCard(market, figures, request, asOf)
    if (result.kind !== 'card') continue
    const row = result.card.rows.find((item) => item.id === rowId)
    if (row !== undefined) return row
  }
  return null
}

/** The current market rows behind a view (or the one rung named), for the alerts run. */
function watchesOf(market: Market, viewId: string, rowId: string): StoredPlanChoice['watches'] {
  const current = (market.recordsOf.get(viewId) ?? []).filter(
    (record) => record.supersededAt === null,
  )
  const exact = current.filter(
    (record) => `${record.product.provider}:${record.product.productId}` === rowId,
  )
  return (exact.length > 0 ? exact : current).slice(0, 12).map((record) => {
    const rate = recordRate(record.product.rates)
    return {
      provider: record.product.provider,
      source: record.product.source,
      productId: record.product.productId,
      ...(rate === null ? {} : { ratePct: rate }),
    }
  })
}

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

/** The same day of the month `months` on, kept within that month. */
function dayAfter(asOf: AsOf, months: number): string {
  const month = addMonths(asOf, months)
  const [year, monthNumber] = month.split('-').map(Number)
  const last = new Date(Date.UTC(year ?? 1970, monthNumber ?? 1, 0)).getUTCDate()
  const day = Math.min(Number(asOf.slice(8, 10)) || 1, last)
  return `${month}-${String(day).padStart(2, '0')}`
}

/** "18-month fixed" → 18, "2-year fixed" → 24, else null. */
function fixedMonthsOf(kind: string): number | null {
  const months = /^(\d+)-month fixed/.exec(kind)
  if (months !== null) return Number(months[1])
  const years = /^(\d+)-year fixed/.exec(kind)
  return years === null ? null : Number(years[1]) * 12
}

function savingsEnd(
  market: Market,
  rowId: string,
  lead: string,
  kind: string,
  asOf: AsOf,
  balance: number,
): { on: string; reminder: ChoiceReminder } | null {
  const found = resolve(market, rowId)
  if (found === null || found.product.terms.kind !== 'deposit') return null
  const terms = found.product.terms
  const productId = found.product.id
  if (terms.access === 'fixed_term') {
    const months = found.rungMonths ?? fixedMonthsOf(kind)
    if (months === null) return null
    const on = dayAfter(asOf, months)
    return {
      on,
      reminder: {
        kind: 'deposit_matures',
        label: `${clip(lead, 100)}: matures`,
        dueOn: on,
        productId,
      },
    }
  }
  // Ten years is far enough to find a stated end; a rate with none is not reminded of.
  const period = ratePeriod(terms, asOf, 120, balance)
  if (period === null) return null
  const on =
    period.kind === 'bonus'
      ? `${addMonths(asOf, period.months + 1)}-01`
      : dayAfter(asOf, period.months)
  return {
    on,
    reminder: {
      kind: 'other',
      label: `${clip(lead, 90)}: ${period.kind === 'bonus' ? 'bonus' : 'introductory'} rate ends`,
      dueOn: on,
      productId,
    },
  }
}

function mortgageEnd(
  lead: string,
  kind: string,
  keysOn: string | null,
  productId: string | null,
): { on: string; reminder: ChoiceReminder } | null {
  const years = /^(\d+)-year fixed/.exec(kind)
  if (years === null || keysOn === null) return null
  const on = `${addMonths(`${keysOn.slice(0, 7)}-01`, Number(years[1]) * 12)}-01`
  return {
    on,
    reminder: {
      kind: 'fixed_rate_ends',
      label: `${clip(lead, 80)}: fixed rate ends, from keys ${shortMonth(keysOn.slice(0, 7))}`,
      dueOn: on,
      productId,
    },
  }
}

/**
 * A row chosen for a part of the plan, rebuilt from the market by its id: for a savings part,
 * the row as a products card the case can build shows it (those it was shown first), else
 * worked out on the comparison's rules; for the mortgage, the plan's own comparison option,
 * else a mortgage card's row. Refused when nothing holds the id, or when it is not that kind of
 * product: a mortgage for a savings part, a fixed term for the monthly saving, an account that
 * takes no lump sum for the lump sum.
 */
export function resolveChoice(input: {
  readonly market: Market
  readonly figures: CaseFigures
  readonly plan: MarketPlan
  readonly slot: PlanChoiceSlot
  readonly rowId: string
  readonly asOf: AsOf
  /** The products cards the case was shown, newest first (`products_shown`). */
  readonly shown?: readonly ShowProductsRequest[]
}): ChoiceResult {
  const { market, figures, plan, slot, rowId, asOf } = input
  const shown = input.shown ?? []
  const unknown = {
    kind: 'refused',
    code: 'unknown_row',
    reason:
      'That product is not on any card shown in this conversation or in the plan’s comparison.',
  } as const

  const options = plan.comparison?.options ?? []
  const option = options.find((item) => mortgageOptionRowId(item) === rowId)
  const found = rowId.startsWith('held:') ? null : resolve(market, rowId)
  const isMortgage = option !== undefined || found?.product.category === 'mortgage'
  // Refusals are shown inline in the app's Choose sheet: a fact naming the product and their figure.
  const name =
    found !== null
      ? displayName(found.product)
      : option !== undefined
        ? `${option.lender} ${option.kind}`
        : 'That account'
  const held = figures.held.reduce((sum, account) => sum + account.balance, 0)
  const monthly = figures.monthlySavingEur ?? 0
  const theSum = held > 0 ? `the ${whole(held)}` : 'the sum held'
  const theMonthly = monthly > 0 ? `the ${whole(monthly)} a month` : 'the monthly saving'
  const refuse = (reason: string): ChoiceResult => ({ kind: 'refused', code: 'wrong_slot', reason })

  if (slot === 'mortgage') {
    if (!isMortgage) {
      if (found === null && !rowId.startsWith('held:')) return unknown
      return refuse(
        found === null
          ? 'Your own account is a savings account, not a mortgage, so it cannot be the mortgage.'
          : found.product.terms.kind === 'deposit'
            ? `${name} is a savings account, not a mortgage, so it cannot be the mortgage.`
            : `${name} is not a mortgage, so it cannot be the mortgage.`,
      )
    }
    const keysOn = plan.comparison?.keysOn ?? null
    if (option !== undefined) {
      const lead = option.productName.toLowerCase().startsWith(option.lender.toLowerCase())
        ? option.productName
        : `${option.lender} ${option.productName}`
      const kind = `${option.kind} at ${pct(option.ratePct)}`
      return {
        kind: 'choice',
        choice: {
          slot,
          rowId,
          lead,
          ...(found === null ? {} : { providerId: found.product.provider }),
          kind,
          value: `${whole(option.monthlyEur)}/mo`,
          figure: `${whole(option.fiveYearCostEur)} over 5 years`,
          ...(found === null ? {} : { watches: watchesOf(market, found.product.id, rowId) }),
        },
        end: mortgageEnd(lead, option.kind, option.keysOn ?? keysOn, found?.product.id ?? null),
      }
    }
    const row = rowOnCards(market, figures, mortgageRequests(shown), rowId, asOf)
    if (row === null || found === null) return unknown
    return {
      kind: 'choice',
      choice: {
        slot,
        rowId,
        lead: row.lead,
        ...(row.providerId === undefined ? {} : { providerId: row.providerId }),
        kind: row.kind,
        value: row.value,
        figure: row.figure,
        watches: watchesOf(market, found.product.id, rowId),
      },
      end: mortgageEnd(row.lead, row.kind, keysOn, found.product.id),
    }
  }

  // The lump sum or the monthly saving.
  const target = slot === 'lump_sum' ? `hold ${theSum}` : `take ${theMonthly}`
  if (isMortgage) return refuse(`${name} is a mortgage, so it cannot ${target}.`)
  if (found !== null) {
    const terms = found.product.terms
    if (terms.kind !== 'deposit') {
      return refuse(`${name} is not a savings or deposit account, so it cannot ${target}.`)
    }
    // A regular saver is judged on the monthly saving alone, as the cards set it apart.
    if (slot === 'lump_sum' && (terms.takesLumpSum === false || isRegularSaver(found.product))) {
      return refuse(`${name} takes monthly payments only, so it cannot hold ${theSum}.`)
    }
    if (
      slot === 'monthly_saving' &&
      (terms.access === 'fixed_term' || terms.takesMonthly === false)
    ) {
      return refuse(`${name} takes a lump sum only, so it cannot take ${theMonthly}.`)
    }
  }

  const dated = figures.keysMonth !== null && figures.keysMonth > asOf.slice(0, 7)
  const row = rowOnCards(market, figures, savingsRequests(slot, shown, dated), rowId, asOf)
  const balance =
    slot === 'lump_sum'
      ? figures.held.reduce((sum, account) => sum + account.balance, 0)
      : (figures.monthlySavingEur ?? 0)
  if (row !== null) {
    return {
      kind: 'choice',
      choice: {
        slot,
        rowId,
        lead: row.lead,
        ...(row.providerId === undefined ? {} : { providerId: row.providerId }),
        kind: row.kind,
        value: row.value,
        figure: row.figure,
        ...(found === null ? {} : { watches: watchesOf(market, found.product.id, rowId) }),
      },
      end: found === null ? null : savingsEnd(market, rowId, row.lead, row.kind, asOf, balance),
    }
  }
  if (found === null) return unknown
  const facts = rowFacts(market, figures, rowId, asOf)
  if (facts === null) return unknown
  return {
    kind: 'choice',
    choice: {
      slot,
      rowId,
      lead: facts.lead,
      providerId: facts.providerId,
      kind: facts.kind,
      value: facts.value,
      figure: facts.figure,
      watches: watchesOf(market, found.product.id, rowId),
    },
    end: savingsEnd(market, rowId, facts.lead, facts.kind, asOf, balance),
  }
}

// ---- Marking the cards ------------------------------------------------------------------------------

/** The part a row id is chosen for, the first in slot order; undefined when none. */
export function chosenSlotOf(
  choices: MarketPlan['choices'] | undefined,
  rowId: string,
): PlanChoiceSlot | undefined {
  return PLAN_CHOICE_SLOTS.find((slot) => choices?.[slot]?.rowId === rowId)
}

/** A products card with each row that is a current choice marked `chosen`. */
export function markChosenRows(
  card: MarketProductsCard,
  choices: MarketPlan['choices'] | undefined,
): MarketProductsCard {
  if (choices === undefined) return card
  return {
    ...card,
    rows: card.rows.map((row) => {
      const slot = chosenSlotOf(choices, row.id)
      return slot === undefined ? row : { ...row, chosen: slot }
    }),
  }
}

/** A comparison card with each column that is a current choice marked `chosen`. */
export function markChosenColumns(
  card: ProductComparisonCard,
  choices: MarketPlan['choices'] | undefined,
): ProductComparisonCard {
  if (choices === undefined) return card
  return {
    ...card,
    columns: card.columns.map((column) => {
      const slot = chosenSlotOf(choices, column.rowId)
      return slot === undefined ? column : { ...column, chosen: slot }
    }),
  }
}
