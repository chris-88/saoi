import type {
  BuildPlanRequest,
  BuildPlanResponse,
  HomeCalculatorRequest,
  PlanQuestion,
} from '../../contracts/market-tools.ts'
import type { PlanArrivalView } from '../../contracts/market-plan.ts'
import { homeCalculator } from './home-calculator.ts'
import { monthName, monthsBetween } from './home-arithmetic.ts'
import type { AsOf, Market } from './types.ts'

/**
 * The app's arrival (2026-11-12, the first-home experience, "2. The card" and "3. Arrival"): the
 * figures the host's calculator card showed, worded once here so the app's card matches it, and
 * the one question Saoirse opens with.
 *
 * Every figure is saoi-api's own: the home calculator's (`homeCalculator`, with its market
 * block) for the same inputs the plan was built on, and the plan's keys month. The wording
 * repeats the host card's (`homeCalculatorModel.ts` in saoi-mcp: `readyHeadline`, `factParts`,
 * `tiles`), so the two sides of the jump read as one thing. A tile names a rate and a count,
 * never a lender or a product: a named pick for a stated goal is advice.
 */

type Base = Omit<BuildPlanRequest, 'alternatives'>

/** Whole euro, as the host card shows them. */
const eur = (value: number): string =>
  `€${Math.round(value).toLocaleString('en-IE', { maximumFractionDigits: 0 })}`

const pct2 = (value: number): string => `${value.toFixed(2)}%`

const count = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Feb 2028", as the host card's tiles write a month. */
const shortMonth = (yyyyMm: string): string => {
  const name = SHORT[Number(yyyyMm.slice(5, 7)) - 1]
  return name === undefined ? yyyyMm : `${name} ${yyyyMm.slice(0, 4)}`
}

/**
 * Saoirse's first line when the plan has no question that moves a figure. A fact and an
 * invitation, no instruction (the lines Saoi holds).
 */
export const ARRIVAL_FALLBACK_OPENING =
  'Your comparison is here, with every figure as you left it. What would you like to look at first?'

/** Saoirse's first line in the app, verbatim: the hook question and what it moves, or the fallback. */
export function arrivalOpening(arrival: PlanArrivalView | undefined): string {
  const hook = arrival?.hookQuestion ?? null
  return hook === null ? ARRIVAL_FALLBACK_OPENING : `${hook.question} ${hook.why}`
}

/** The calculator request the plan's inputs amount to, as the host card would send it. */
function calculatorRequest(
  base: Base,
  home: NonNullable<BuildPlanResponse['home']>,
): HomeCalculatorRequest {
  const { situation } = base
  const goal = base.goals.find((item) => item.kind === 'house_deposit')
  const saved = situation.savings.reduce((sum, item) => sum + item.balance, 0)
  const rent = situation.outgoings?.rentMonthly ?? base.monthlyRentEur
  return {
    depositSavedEur: saved,
    ...(situation.monthlySaving === undefined ? {} : { monthlySavingEur: situation.monthlySaving }),
    ...(situation.income?.annualGross === undefined
      ? {}
      : { annualGrossIncomeEur: situation.income.annualGross }),
    targetPriceEur: base.homePrice ?? home.price,
    ...(goal?.targetDate === undefined ? {} : { targetDate: goal.targetDate.slice(0, 7) }),
    ...(situation.firstTimeBuyer === undefined ? {} : { firstTimeBuyer: situation.firstTimeBuyer }),
    ...(base.propertyKind === undefined ? {} : { propertyKind: base.propertyKind }),
    ...(base.taxPaidLastFourYearsEur === undefined
      ? {}
      : { taxPaidLastFourYearsEur: base.taxPaidLastFourYearsEur }),
    ...(base.county === undefined ? {} : { county: base.county }),
    ...(rent === undefined ? {} : { monthlyRentEur: rent }),
  }
}

/** What was taken as given and can be changed, as chip texts: first home, the kind of home, rent. */
function assumptionChips(base: Base, rent: number | undefined): string[] {
  const kind =
    base.propertyKind === undefined
      ? 'Second-hand, assumed'
      : base.propertyKind === 'second_hand'
        ? 'Second-hand'
        : base.propertyKind === 'self_build'
          ? 'Self-build'
          : 'New build'
  return [
    base.situation.firstTimeBuyer === undefined
      ? 'First-time buyer, assumed'
      : base.situation.firstTimeBuyer
        ? 'First-time buyer'
        : 'Bought before',
    kind,
    rent === undefined ? 'Rent not given' : `Rent ${eur(rent)} a month`,
  ]
}

/**
 * The arrival for a home plan, or undefined for any other plan. `hook` is the plan's
 * `nextQuestion`; a question that moves no figure (a score of nothing) is not a hook.
 */
export function arrivalFor(
  market: Market,
  base: Base,
  main: BuildPlanResponse,
  hook: PlanQuestion | null,
  asOf: AsOf,
): PlanArrivalView | undefined {
  const home = main.home
  if (home === null || home.pathways.length === 0) return undefined
  const request = calculatorRequest(base, home)
  const calculator = homeCalculator(request, asOf, market)
  const { figures } = calculator
  const firstTimeBuyer = request.firstTimeBuyer ?? true
  const limits = firstTimeBuyer ? calculator.rules.firstTimeBuyer : calculator.rules.otherBuyer

  // ---- The month, chosen as the host card chooses it --------------------------------------------
  // The plan's month counts savings interest; a conditional Help to Buy keeps the calculator's
  // own month (before interest, without it), so the headline never counts what is not known.
  const own = figures.helpToBuyConditional
  const ready = own ? figures.depositReachedOn : home.keysOn
  const target = request.targetDate
  const late =
    ready !== null && target !== undefined && ready > target ? monthsBetween(target, ready) : 0
  const notes = [
    ...(own && ready !== null ? ['Before interest'] : []),
    ...(late > 0 ? [`${String(late)} ${late === 1 ? 'month' : 'months'} after your date`] : []),
  ]

  // ---- What the money at the keys is made of ------------------------------------------------------
  const factParts =
    figures.depositNeededEur === null || figures.stampDutyEur === null
      ? []
      : [
          `${eur(figures.depositNeededEur)} deposit`,
          `+ ${eur(figures.stampDutyEur)} stamp duty`,
          `+ ${eur(figures.legalAndSurveyEur)} legal and survey`,
          ...(figures.helpToBuyEur > 0
            ? [
                figures.helpToBuyConditional
                  ? `Help to Buy up to ${eur(figures.helpToBuyEur)} not counted`
                  : `− ${eur(figures.helpToBuyEur)} Help to Buy`,
              ]
            : []),
        ]

  // ---- The three tiles, as the host card words them -----------------------------------------------
  const savings = calculator.market?.savings ?? null
  const mortgage = calculator.market?.mortgage ?? null
  const none = { value: 'Not available', lines: ['No market figures today'] }
  const tiles: PlanArrivalView['tiles'] = [
    savings === null
      ? { label: 'Savings', ...none }
      : {
          label: 'Savings',
          value: `up to ${pct2(savings.topRatePct)}`,
          lines: [
            `${eur(savings.interestToTargetEur)} interest by ${shortMonth(savings.by)}`,
            count(savings.accounts, 'account', 'accounts'),
          ],
        },
    {
      label: 'Mortgage',
      value: eur(figures.loanEur ?? home.loan),
      lines:
        mortgage === null
          ? none.lines
          : [
              `from ${pct2(mortgage.lowestRatePct)}, ${eur(mortgage.lowestMonthlyEur)}/mo`,
              `${count(mortgage.options, 'option', 'options')}, ${String(mortgage.termYears)} years`,
            ],
    },
    figures.maxPriceEur === null
      ? { label: 'Could afford', ...none, lines: ['Needs the income'] }
      : {
          label: 'Could afford',
          value: `up to ${eur(figures.maxPriceEur)}`,
          lines: [
            `${String(limits.loanToIncome)}× income, ${String(limits.maxLtvPct)}% loan`,
            `${String(figures.termYears)} years`,
          ],
        },
  ]

  return {
    keysOn: ready,
    readyLine: ready === null ? 'Not reached at this pace' : monthName(ready),
    readyNote: notes.length === 0 ? null : notes.join(', '),
    factParts,
    progress:
      figures.neededAtKeysEur === null
        ? null
        : {
            savedEur: request.depositSavedEur ?? 0,
            neededEur: figures.neededAtKeysEur,
            monthlySavingEur: request.monthlySavingEur ?? 0,
          },
    tiles,
    assumptions: assumptionChips(base, request.monthlyRentEur),
    hookQuestion:
      hook === null || hook.scoreEur <= 0
        ? null
        : { key: hook.key, question: hook.question, why: hook.why },
  }
}
