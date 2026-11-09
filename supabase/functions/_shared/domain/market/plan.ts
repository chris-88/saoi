import {
  DEFAULT_MIN_LOCK_GAIN_EUR,
  DEFAULT_MIN_LOCK_GAIN_PCT_PER_YEAR,
  type BuildPlanRequest,
  type BuildPlanResponse,
  type PlanAlternative,
  type Debt,
  type Goal,
  type ProductView,
  type Situation,
} from '../../contracts/market-tools.ts'
import type { MarketPlan, PlanProduct } from '../../contracts/market-plan.ts'
import { allocatable, allocate, type AllocationLine } from './allocate.ts'
import { debtMonthlyRate, payoffOrder, repaymentOf } from './debt.ts'
import { displayName, euro, interestToClear } from './figures.ts'
import { HELP_TO_BUY } from '../../market/first-home-rules.ts'
import { firstHome, helpToBuyFor } from './first-home.ts'
import { affordability } from './mortgage.ts'
import { moneyFoundForPlan } from './money-found.ts'
import { questionsFor, sharpenLines } from './questions.ts'
import { project } from './projection.ts'
import { monthlyOutgoings } from './review.ts'
import { guaranteeFlag, SAVINGS_ASSUMPTIONS, UNCONFIRMED_RATE } from './search.ts'
import { addMonths, monthsUntil, round2, simulateDeposit } from './simulate.ts'
import type { AsOf, Market } from './types.ts'

/**
 * The fastest combination for someone's goals, across the whole market: `savings/arrange.ts`
 * generalised, returned as a `MarketPlan` (`contracts/market-plan.ts`) ready for
 * `POST /api/plans`.
 *
 * In order:
 * 1. An emergency buffer (an amount, months of outgoings, or an `emergency_fund` goal) goes
 *    first into the best instant-access account, kept apart from the goal.
 * 2. Each debt that costs more than the savings would earn is worked out both ways, cleared from
 *    the lump sum (its repayment then saved) and kept, and the one that leaves more at the
 *    horizon is taken; both sets of figures are returned.
 * 3. What is left is split across the market by `allocate`: regular savers to their monthly
 *    caps, the lump sum to the longest term that ends by the goal's date (or instant and notice
 *    access when there is no date), within the deposit guarantee per provider.
 * 4. Steps 2 and 3 run twice, with terms allowed and with everything in instant access. A term
 *    is used only when it leaves at least `minLockGainEur` and `minLockGainPctPerYear` more;
 *    otherwise, or when the customer keeps the money accessible or the date is not certain,
 *    the money stays in instant access. The reason is returned with both figures.
 * 5. It is projected month by month, the month the main goal is reached is stated, and the
 *    what-ifs (an extra €100 a month, clearing or keeping each debt, the pace) are worked out.
 *
 * Information, not advice: every step says what it measured, for the inputs given.
 */

const SAVING_GOALS: ReadonlySet<Goal['kind']> = new Set([
  'house_deposit',
  'save_for_purchase',
  'grow_savings',
  'other',
])
const DEFAULT_MAX_ACCOUNTS = 5
const DEFAULT_EMERGENCY_MONTHS = 3
const NO_DATE_HORIZON = 12

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

const monthName = (yyyyMm: string): string => {
  const [year, month] = yyyyMm.split('-').map(Number)
  const names = [
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
  ]
  return `${names[(month ?? 1) - 1] ?? ''} ${String(year)}`
}

/** What the debt still owes and has cost after `months` at its current repayment. */
function debtAfter(debt: Debt, months: number): { balance: number; interest: number } | null {
  const r = debtMonthlyRate(debt)
  const payment = repaymentOf(debt)
  if (r === null || payment === null) return null
  let balance = debt.balance
  let interest = 0
  for (let month = 0; month < months && balance > 0; month += 1) {
    const charge = balance * r
    interest += charge
    balance = Math.max(0, balance + charge - payment)
  }
  return { balance: round2(balance), interest: round2(interest) }
}

type Placed = {
  readonly lines: readonly AllocationLine[]
  readonly unplaced: { readonly lumpSum: number; readonly monthly: number }
  readonly savingsAtHorizon: number
  readonly knownThrough: number
  readonly reachedOn: string | null
  readonly netInterest: number
}

type Placer = (lumpSum: number, perMonth: number) => Placed

/** One way through the debts and the split, with terms allowed or not. */
type Run = {
  readonly lockAllowed: boolean
  readonly current: Placed
  readonly steps: MarketPlan['debts']
  readonly scenarios: BuildPlanResponse['debtScenarios']
  readonly reasoning: readonly string[]
  readonly assumptions: readonly string[]
  readonly lump: number
  readonly monthly: number
  /** Still owed at the horizon on the debts given (today's balance where no repayment was given). */
  readonly owed: number
  /** Debts counted at today's balance because their repayment was not given. */
  readonly ceilings: readonly string[]
  /** Debts not set against savings (a mortgage). */
  readonly notNetted: readonly string[]
  /** Everything held (the split and the buffer) less what is still owed, at the horizon. */
  readonly netPosition: number
}

const LOCKING: ReadonlySet<string> = new Set(['fixed_term', 'notice'])
const isLocked = (line: AllocationLine): boolean =>
  line.product.terms.kind === 'deposit' && LOCKING.has(line.product.terms.access)
const EXTRA_MONTHLY = 100
const PACE_HORIZON = 120

/** What the host relays after a plan: the offer to save it, and what the app adds. */
export const PLAN_NEXT = [
  'The plan is held for 24 hours behind the single-use save link so the customer can open it in the Saoi app (app.saoi.ie), then deleted unless opened; nothing else is stored. Offer the link.',
  'In the app the plan opens as a card, and Saoirse, Saoi’s assistant, knows it and can talk it through; signing in with an email address keeps it across devices, including the installed app. Alerts when a chosen product’s rate changes and reminders as the goal date nears are coming, not built yet.',
  'To compare options (another buffer, a debt kept or cleared, another monthly amount or date), pass them as `alternatives` in one saoi_build_plan call; call it again only when the customer changes their situation in a later message.',
].join(' ')

const lowerFirst = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`

/**
 * The plan, and each named alternative worked out in the same call (Chris, 2026-11-09, after
 * test 5: hosts called build_plan once per scenario and every call drew its own card). An
 * alternative is the same request with a few inputs changed; it comes back as a position and
 * one comparison line, not a second plan.
 */
export function buildPlan(
  market: Market,
  request: BuildPlanRequest,
  asOf: AsOf,
  createdAt: string,
): BuildPlanResponse {
  const { alternatives: asked = [], ...base } = request
  const main = buildMain(market, base, asOf, createdAt)
  if (asked.length === 0) return main
  const alternatives = asked.map((alternative) =>
    workOutAlternative(market, base, alternative, main, asOf, createdAt),
  )
  const closing = main.presentation.at(-1)
  return {
    ...main,
    alternatives,
    presentation: [
      ...main.presentation.slice(0, -1),
      ...alternatives.map((alternative) => alternative.line),
      ...(closing === undefined ? [] : [closing]),
    ],
  }
}

function workOutAlternative(
  market: Market,
  base: Omit<BuildPlanRequest, 'alternatives'>,
  alternative: PlanAlternative,
  main: BuildPlanResponse,
  asOf: AsOf,
  createdAt: string,
): BuildPlanResponse['alternatives'][number] {
  const changes: string[] = []
  const plans = new Map((alternative.debtPlans ?? []).map((item) => [item.debtId, item.plan]))
  const debts = base.situation.debts.map((debt) => {
    const plan = plans.get(debt.id)
    if (plan === undefined) return debt
    changes.push(
      `the ${lowerFirst(debt.label)} ${plan === 'keep' ? 'kept' : plan === 'clear' ? 'cleared from savings' : 'compared both ways'}`,
    )
    return { ...debt, plan }
  })
  const mainGoal = [...base.goals]
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .find((goal) => SAVING_GOALS.has(goal.kind))
  const goals = base.goals.map((goal) =>
    goal !== mainGoal
      ? goal
      : {
          ...goal,
          ...(alternative.targetDate === undefined ? {} : { targetDate: alternative.targetDate }),
          ...(alternative.targetAmount === undefined
            ? {}
            : { targetAmount: alternative.targetAmount }),
        },
  )
  if (alternative.emergencyBufferEur !== undefined) {
    changes.push(`a ${euro(alternative.emergencyBufferEur)} emergency buffer`)
  }
  if (alternative.keepAccessible !== undefined) {
    changes.push(
      alternative.keepAccessible ? 'everything in instant access' : 'fixed terms allowed',
    )
  }
  if (alternative.monthlySaving !== undefined) {
    changes.push(`${euro(alternative.monthlySaving)} a month`)
  }
  if (alternative.targetDate !== undefined) {
    changes.push(`the goal by ${monthName(alternative.targetDate.slice(0, 7))}`)
  }
  if (alternative.targetAmount !== undefined) {
    changes.push(`a ${euro(alternative.targetAmount)} target`)
  }
  if (alternative.homePrice !== undefined) changes.push(`a ${euro(alternative.homePrice)} home`)
  const result = buildMain(
    market,
    {
      ...base,
      situation: {
        ...base.situation,
        debts,
        ...(alternative.monthlySaving === undefined
          ? {}
          : { monthlySaving: alternative.monthlySaving }),
      },
      goals,
      ...(alternative.emergencyBufferEur === undefined
        ? {}
        : { emergencyBufferEur: alternative.emergencyBufferEur }),
      ...(alternative.keepAccessible === undefined
        ? {}
        : { keepAccessible: alternative.keepAccessible }),
      ...(alternative.homePrice === undefined ? {} : { homePrice: alternative.homePrice }),
    },
    asOf,
    createdAt,
  )
  const position = result.position
  const differenceEur = round2(position.total - main.position.total)
  const sameDate = position.at === main.position.at
  const owed = position.owed > 0 ? `, less ${euro(position.owed)} still owed` : ''
  const line = `${alternative.name} (${changes.length === 0 ? 'as given' : changes.join(', ')}): ${euro(position.total)} at ${monthName(position.at)}, everything held${owed}${sameDate ? `; ${differenceEur >= 0 ? `${euro(differenceEur)} more` : `${euro(-differenceEur)} less`} than the plan above` : ''}.`
  return {
    name: alternative.name,
    changes,
    position,
    differenceEur,
    goalReachedOn: result.goalReachedOn,
    moneyFoundAnnualEur: result.moneyFound.annualEur,
    line,
  }
}

function buildMain(
  market: Market,
  request: Omit<BuildPlanRequest, 'alternatives'>,
  asOf: AsOf,
  createdAt: string,
): BuildPlanResponse {
  const { situation, goals } = request
  const questions = questionsFor(situation, goals)
  const maxAccounts = request.maxAccounts ?? DEFAULT_MAX_ACCOUNTS
  const reasoning: string[] = []
  const assumptions: string[] = [...SAVINGS_ASSUMPTIONS]
  const whatIfLines: string[] = []

  const ordered: Goal[] = [...goals].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
  const main = ordered.find((goal) => SAVING_GOALS.has(goal.kind)) ?? null
  let emergency = ordered.find((goal) => goal.kind === 'emergency_fund') ?? null
  const dated = main?.targetDate !== undefined
  const horizon =
    main?.targetDate === undefined ? NO_DATE_HORIZON : monthsUntil(asOf, main.targetDate)
  const whenLabel =
    main?.targetDate === undefined
      ? monthName(addMonths(asOf, horizon))
      : monthName(main.targetDate.slice(0, 7))

  // ---- Debts with no repayment given: an even repayment over the horizon is assumed ----------
  // Chris, 2026-11-09: a balance and a rate are enough to compare clearing against keeping if the
  // debt is taken as repaid in equal monthly instalments over the plan's months. It is stated as
  // an assumption everywhere it shows, and the real repayment is asked for.
  const assumedRepayments: BuildPlanResponse['assumedRepayments'] = []
  const modelled: Situation = {
    ...situation,
    debts: situation.debts.map((debt) => {
      if (
        debt.kind === 'mortgage' ||
        debt.ratePct === undefined ||
        debt.balance <= 0 ||
        debt.monthlyRepayment !== undefined ||
        debt.monthsRemaining !== undefined
      ) {
        return debt
      }
      const even: Debt = { ...debt, monthsRemaining: horizon }
      const payment = round2(repaymentOf(even) ?? 0)
      assumedRepayments.push({
        debtId: debt.id,
        label: debt.label,
        balance: debt.balance,
        months: horizon,
        monthlyRepayment: payment,
        note: `Assumed: the ${lowerFirst(debt.label)}’s ${euro(debt.balance)} repaid evenly over ${String(horizon)} months (about ${euro(payment)} a month at ${String(debt.ratePct)}%), as no repayment was given; with the actual repayment the figure is exact.`,
      })
      return even
    }),
  }
  for (const item of assumedRepayments) assumptions.push(clip(item.note, 300))

  // ---- The money to place -------------------------------------------------------------------
  const available = situation.savings.filter((item) => item.access !== 'fixed_term')
  let lump = available.reduce((sum, item) => sum + item.balance, 0)
  const monthly = situation.monthlySaving ?? 0
  if (situation.savings.some((item) => item.access === 'fixed_term')) {
    assumptions.push('Savings already in a fixed term are left where they are.')
  }
  assumptions.push('Every other euro of savings held is treated as available to place.')
  reasoning.push(
    `${euro(lump)} held and ${euro(monthly)} a month to place, over ${String(horizon)} months.`,
  )

  // ---- 1. Emergency buffer --------------------------------------------------------------------
  const outgoings = monthlyOutgoings(situation)
  const bufferMonths =
    request.emergencyBufferMonths ??
    request.emergencyFundMonths ??
    (emergency === null ? null : DEFAULT_EMERGENCY_MONTHS)
  const bufferFromMonths =
    bufferMonths === null || outgoings === null ? null : round2(outgoings * bufferMonths)
  const bufferTarget =
    request.emergencyBufferEur ??
    (request.emergencyBufferMonths === undefined ? emergency?.targetAmount : undefined) ??
    bufferFromMonths
  let emergencyLines: readonly AllocationLine[] = []
  let bufferHeld = 0
  if (bufferTarget === null && bufferMonths !== null) {
    reasoning.push(
      `An emergency buffer of ${String(bufferMonths)} months of outgoings was asked for, but outgoings were not given, so none is set aside.`,
    )
    whatIfLines.push(
      'With monthly outgoings (rent and the rest), or a buffer in euro, the buffer is sized and held in instant access: give them in a later call, or a buffer as an alternative.',
    )
  } else if (bufferTarget !== null && bufferTarget !== undefined && bufferTarget > 0) {
    if (emergency === null && ordered.length < 8) {
      const taken = new Set(ordered.map((goal) => goal.id))
      let id = 'emergency-buffer'
      for (let n = 2; taken.has(id); n += 1) id = `emergency-buffer-${String(n)}`
      const maxPriority = Math.max(0, ...ordered.map((goal) => goal.priority ?? 0))
      emergency = {
        id,
        kind: 'emergency_fund',
        label: 'Emergency buffer',
        targetAmount: bufferTarget,
        priority: Math.min(20, maxPriority + 1),
      }
      ordered.push(emergency)
    }
    const take = Math.min(bufferTarget, lump)
    const fund = allocate(
      allocatable(market.products, { horizonMonths: horizon, lockAllowed: false }),
      {
        lumpSum: take,
        monthly: 0,
        horizonMonths: horizon,
        lockAllowed: false,
        maxAccounts: 1,
        asOf,
      },
    )
    emergencyLines = fund.lines
    bufferHeld = round2(take - fund.unplaced.lumpSum)
    lump -= bufferHeld
    const line = fund.lines[0]
    const sized =
      request.emergencyBufferEur !== undefined
        ? 'as asked'
        : bufferFromMonths !== null && bufferTarget === bufferFromMonths
          ? `${String(bufferMonths)} months of ${euro(outgoings ?? 0)} outgoings`
          : 'the goal’s target'
    reasoning.push(
      line === undefined
        ? `No instant-access account takes ${euro(take)}, so the emergency buffer is not placed.`
        : `${euro(bufferHeld)} held first as an emergency buffer (${sized}) in ${displayName(line.product)}: the highest interest after DIRT with instant access. It is kept apart from the goal.${take < bufferTarget ? ` That is ${euro(round2(bufferTarget - take))} short of ${euro(bufferTarget)}.` : ''}`,
    )
  } else if (request.emergencyBufferEur === 0) {
    reasoning.push('No emergency buffer is held, as asked.')
  }

  // The buffer at the horizon, with its interest: part of everything held, kept apart.
  const bufferAtHorizon =
    emergencyLines.length === 0
      ? 0
      : project(
          market,
          {
            horizonMonths: horizon,
            lines: emergencyLines.map((line) => ({
              productId: line.product.id,
              lumpSum: line.lumpSum,
              monthly: line.monthly,
            })),
          },
          asOf,
        ).totals.balance

  // ---- 2. Debts and the split, with terms allowed and without --------------------------------
  const accountsLeft = Math.max(1, maxAccounts - emergencyLines.length)
  const placer = (lockAllowed: boolean, months: number, target?: number): Placer => {
    const pool = allocatable(market.products, { horizonMonths: months, lockAllowed })
    return (lumpSum, perMonth) => {
      const allocation = allocate(pool, {
        lumpSum,
        monthly: perMonth,
        horizonMonths: months,
        lockAllowed,
        maxAccounts: accountsLeft,
        asOf,
      })
      if (allocation.lines.length === 0) {
        return {
          lines: [],
          unplaced: allocation.unplaced,
          savingsAtHorizon: 0,
          knownThrough: months,
          reachedOn: null,
          netInterest: 0,
        }
      }
      const projection = project(
        market,
        {
          horizonMonths: months,
          lines: allocation.lines.map((line) => ({
            productId: line.product.id,
            lumpSum: line.lumpSum,
            monthly: line.monthly,
            ...(line.termMonths === null ? {} : { termMonths: line.termMonths }),
          })),
          ...(target === undefined ? {} : { targetAmount: target }),
        },
        asOf,
      )
      return {
        lines: allocation.lines,
        unplaced: allocation.unplaced,
        savingsAtHorizon: projection.totals.balance,
        knownThrough: projection.totals.knownThroughMonth,
        reachedOn: projection.goal?.reachedOn ?? null,
        netInterest: projection.totals.netInterest,
      }
    }
  }
  const run = (lockAllowed: boolean): Run =>
    solveDebts(modelled, placer(lockAllowed, horizon, main?.targetAmount), {
      lockAllowed,
      lump,
      monthly,
      horizon,
      targetAmount: main?.targetAmount,
      held: bufferAtHorizon,
    })

  const thresholdEur = request.minLockGainEur ?? DEFAULT_MIN_LOCK_GAIN_EUR
  const thresholdPct = request.minLockGainPctPerYear ?? DEFAULT_MIN_LOCK_GAIN_PCT_PER_YEAR
  const instant = run(false)
  let chosen = instant
  let liquidity: BuildPlanResponse['liquidity']
  const forcedWhy = !dated
    ? `No date for the main goal: nothing is locked in a fixed term or notice account, and the figures run ${String(NO_DATE_HORIZON)} months.`
    : request.keepAccessible === true
      ? 'Kept in instant access, as asked: nothing is locked in a fixed term or notice account.'
      : request.goalDateCertain === false
        ? 'The goal may come sooner than its date, so nothing is locked in a fixed term or notice account: the money stays in instant access.'
        : null
  if (forcedWhy !== null) {
    liquidity = {
      decision: 'instant_access',
      why: forcedWhy,
      lockedNetPosition: null,
      instantNetPosition: instant.netPosition,
      gainEur: null,
      gainPctPerYear: null,
      thresholdEur,
      thresholdPctPerYear: thresholdPct,
    }
  } else {
    const locked = run(true)
    const lockedLines = locked.current.lines.filter(isLocked)
    const lockedSum = lockedLines.reduce((sum, line) => sum + line.lumpSum, 0)
    if (lockedLines.length === 0 || lockedSum <= 0) {
      liquidity = {
        decision: 'not_compared',
        why: 'No fixed term or notice account adds anything over instant access for this money, so none is used.',
        lockedNetPosition: locked.netPosition,
        instantNetPosition: instant.netPosition,
        gainEur: null,
        gainPctPerYear: null,
        thresholdEur,
        thresholdPctPerYear: thresholdPct,
      }
      chosen = locked.netPosition > instant.netPosition ? locked : instant
    } else {
      const gainEur = round2(locked.netPosition - instant.netPosition)
      const gainPct = round2((gainEur / lockedSum / (horizon / 12)) * 100)
      const lockedNames = lockedLines
        .map(
          (line) =>
            `${euro(line.lumpSum)} in ${displayName(line.product)}${line.termMonths === null ? '' : ` for ${String(line.termMonths)} months`}`,
        )
        .join(' and ')
      const both = `${euro(locked.netPosition)} against ${euro(instant.netPosition)} in instant access (everything held less what is still owed, at ${whenLabel})`
      const passes = gainEur >= thresholdEur && gainPct >= thresholdPct
      chosen = passes ? locked : instant
      liquidity = {
        decision: passes ? 'locked' : 'instant_access',
        why: passes
          ? `Locking ${lockedNames} leaves ${euro(gainEur)} more (${gainPct.toFixed(2)}% a year on the money locked): ${both}. That clears the ${euro(thresholdEur)} and ${String(thresholdPct)}% a year a lock has to earn, so the term is used; the money cannot be reached before it ends.`
          : gainEur <= 0
            ? `Locking ${lockedNames} would leave no more than instant access (${both}), so the money stays in instant access and can be reached at any time.`
            : `Locking ${lockedNames} would leave only ${euro(gainEur)} more (${gainPct.toFixed(2)}% a year on the money locked): ${both}. A lock has to earn at least ${euro(thresholdEur)} and ${String(thresholdPct)}% a year, so the money stays in instant access and can be reached at any time.`,
        lockedNetPosition: locked.netPosition,
        instantNetPosition: instant.netPosition,
        gainEur,
        gainPctPerYear: gainPct,
        thresholdEur,
        thresholdPctPerYear: thresholdPct,
      }
      if (gainEur > 0)
        whatIfLines.push(
          passes
            ? `What if every euro stayed in instant access (an alternative with keepAccessible: true): ${euro(instant.netPosition)} at ${whenLabel} (everything held less what is still owed), ${euro(gainEur)} less than this plan.`
            : `What if the lump sum were locked in a fixed term anyway (minLockGainEur: 0 and minLockGainPctPerYear: 0, in a later call): ${euro(locked.netPosition)} at ${whenLabel} (everything held less what is still owed), ${euro(gainEur)} more than this plan, with the money tied up.`,
        )
    }
  }
  reasoning.push(...chosen.reasoning)
  reasoning.push(liquidity.why)
  assumptions.push(...chosen.assumptions)
  assumptions.push(clip(liquidity.why, 300))
  const current = chosen.current
  lump = chosen.lump

  // ---- 3. The split ---------------------------------------------------------------------------
  for (const line of current.lines) {
    reasoning.push(describeLine(line))
  }
  if (current.unplaced.lumpSum > 0 || current.unplaced.monthly > 0) {
    reasoning.push(
      `Not placed: ${euro(current.unplaced.lumpSum)} and ${euro(current.unplaced.monthly)} a month; no account within the limits adds known interest for it.`,
    )
  }
  if (current.knownThrough < horizon) {
    reasoning.push(
      `The figures run to month ${String(current.knownThrough)}: a rate after that is not known for every account.`,
    )
  }
  // Everything held less what is still owed: the one figure a scenario is read by, with its parts.
  const owedAtHorizon = chosen.owed
  const position = planPosition({
    at: main?.targetDate?.slice(0, 7) ?? addMonths(asOf, horizon),
    when: whenLabel,
    total: chosen.netPosition,
    towardsGoal: current.savingsAtHorizon,
    goalLabel: main?.label ?? null,
    buffer: bufferAtHorizon,
    owed: owedAtHorizon,
    debts: modelled.debts,
    steps: chosen.steps,
    ceilings: chosen.ceilings,
    notNetted: chosen.notNetted,
  })
  reasoning.push(position.line)
  if (main?.targetAmount !== undefined) {
    reasoning.push(
      current.reachedOn === null
        ? `${main.label}: ${euro(main.targetAmount)} is not reached within the ${String(current.knownThrough)} months the figures cover.`
        : `${main.label}: ${euro(main.targetAmount)} is reached in ${monthName(current.reachedOn)}.`,
    )
  }

  // ---- 4. What if -----------------------------------------------------------------------------
  const pace = placer(chosen.lockAllowed, horizon, main?.targetAmount)
  const more = pace(chosen.lump, chosen.monthly + EXTRA_MONTHLY)
  const extraMonthly =
    current.lines.length === 0
      ? null
      : {
          extra: EXTRA_MONTHLY,
          addsAtHorizon: round2(more.savingsAtHorizon - current.savingsAtHorizon),
          goalReachedOn: more.reachedOn,
        }
  if (extraMonthly !== null) {
    whatIfLines.push(
      `Each extra ${euro(EXTRA_MONTHLY)} a month adds about ${euro(extraMonthly.addsAtHorizon)} by ${whenLabel}, after DIRT${extraMonthly.goalReachedOn !== null && extraMonthly.goalReachedOn !== current.reachedOn && main?.targetAmount !== undefined ? `, and reaches ${euro(main.targetAmount)} in ${monthName(extraMonthly.goalReachedOn)}` : ''}.`,
    )
  }
  for (const scenario of chosen.scenarios) {
    const debt = situation.debts.find((candidate) => candidate.id === scenario.debtId)
    const label = debt?.label ?? scenario.debtId
    const other = scenario.chosen === 'cleared' ? scenario.kept : scenario.cleared
    whatIfLines.push(
      scenario.chosen === 'cleared'
        ? `What if the ${label} were kept instead of cleared (an alternative with its plan: "keep"): ${euro(other.netPosition)} at ${whenLabel}, everything held less the ${euro(other.debtAtHorizon)} still owed then, against ${euro(scenario.cleared.netPosition)} in this plan.`
        : `What if the ${label} were ${other.debtAtHorizon > 0 ? 'part paid' : 'cleared'} from the lump sum instead (an alternative with its plan: "clear"): ${euro(other.netPosition)} at ${whenLabel} (everything held less what is still owed), against ${euro(scenario.kept.netPosition)} in this plan.`,
    )
  }
  let goalReachedAtCurrentPace: string | null = current.reachedOn
  if (main?.targetAmount !== undefined && goalReachedAtCurrentPace === null) {
    goalReachedAtCurrentPace = placer(
      false,
      Math.max(PACE_HORIZON, horizon),
      main.targetAmount,
    )(chosen.lump, chosen.monthly).reachedOn
  }
  if (main?.targetAmount !== undefined) {
    whatIfLines.push(
      goalReachedAtCurrentPace === null
        ? `At this pace ${euro(main.targetAmount)} is not reached within the months the figures cover.`
        : `At this pace ${euro(main.targetAmount)} is reached in ${monthName(goalReachedAtCurrentPace)}.`,
    )
  } else if (main !== null) {
    whatIfLines.push(
      'With a target amount for the goal, the month it is reached is worked out: an alternative with targetAmount, or the amount in a later call.',
    )
  }

  // ---- 5. What a house deposit supports --------------------------------------------------------
  let afford: BuildPlanResponse['affordability'] = null
  if (main?.kind === 'house_deposit' && situation.income?.annualGross !== undefined) {
    const deposit = current.savingsAtHorizon
    const result = affordability(market, {
      mode: 'affordability',
      buyer: situation.firstTimeBuyer === false ? 'second_and_subsequent' : 'first_time_buyer',
      annualGrossIncome: situation.income.annualGross,
      deposit,
      limit: 1,
    })
    const note = `A ${euro(deposit)} deposit${owedAtHorizon > 0 ? ` (with ${euro(owedAtHorizon)} still owed on debts)` : ''} and ${euro(situation.income.annualGross)} gross income support a price up to ${euro(result.maxPrice)} under the Central Bank limits (the ${result.bindingLimit} limit binds)${situation.firstTimeBuyer === undefined ? ', as a first-time buyer' : ''}.`
    let helpToBuy: NonNullable<BuildPlanResponse['affordability']>['helpToBuy'] = null
    if (situation.firstTimeBuyer !== false && request.propertyKind !== 'second_hand') {
      const home = firstHome(market, {
        annualGrossIncome: situation.income.annualGross,
        deposit,
        propertyKind: request.propertyKind ?? 'new_build',
        firstTimeBuyer: true,
        ...(request.taxPaidLastFourYearsEur === undefined
          ? {}
          : { taxPaidLastFourYearsEur: request.taxPaidLastFourYearsEur }),
        limit: 1,
      })
      const withHtb = home.lending.maxPriceWithHelpToBuy
      const htbAt = home.helpToBuy.upToEur
      const htbNote =
        withHtb === null
          ? `Help to Buy would not raise the price the limits allow here.`
          : `For a new build or self-build, Help to Buy (up to ${euro(htbAt)} at that price: 10% of it, at most ${euro(HELP_TO_BUY.capEur)}, and no more than the Income Tax and DIRT paid over the last four years${request.taxPaidLastFourYearsEur === undefined ? ', not given' : ''}) counted towards the deposit lifts that to ${euro(withHtb)}.`
      helpToBuy = {
        upToEur: htbAt,
        maxPriceWithHelpToBuy: withHtb,
        note: htbNote,
        sourceUrl: HELP_TO_BUY.sources[1]?.url ?? '',
        checkedOn: HELP_TO_BUY.sources[1]?.checkedOn ?? '',
      }
    }
    afford = {
      deposit,
      maxPrice: result.maxPrice,
      maxLoanByIncome: result.maxLoanByIncome,
      bindingLimit: result.bindingLimit,
      note,
      helpToBuy,
    }
    reasoning.push(note)
    if (helpToBuy !== null) reasoning.push(helpToBuy.note)
    assumptions.push(clip(note, 300))
  }

  // ---- The plan -------------------------------------------------------------------------------
  const allLines = [...emergencyLines, ...current.lines]
  const products = allLines.map((line) =>
    planProduct(market, line, horizon, asOf, {
      role: emergencyLines.includes(line)
        ? 'emergency_fund'
        : line.monthly > 0
          ? 'regular_saver'
          : 'lump_sum',
      goalIds: emergencyLines.includes(line)
        ? emergency === null
          ? []
          : [emergency.id]
        : main === null
          ? []
          : [main.id],
      reachedOn: emergencyLines.includes(line) ? null : current.reachedOn,
    }),
  )
  const monthlyTotal = round2(allLines.reduce((sum, line) => sum + line.monthly, 0))
  const lumpTotal = round2(allLines.reduce((sum, line) => sum + line.lumpSum, 0))
  const interestTotal = round2(
    products.reduce((sum, product) => sum + (product.projected?.netInterest ?? 0), 0),
  )

  const plan: MarketPlan = {
    version: 1,
    title: clip(
      main === null
        ? (ordered[0]?.label ?? 'Savings plan')
        : `${main.label}${main.targetDate === undefined ? '' : ` by ${monthName(main.targetDate.slice(0, 7))}`}`,
      120,
    ),
    situation: planSituation(situation),
    goals: ordered.map((goal) => ({ ...goal })),
    recommendation: {
      products: products.slice(0, 12),
      totals: { monthly: monthlyTotal, lumpSum: lumpTotal, netInterest: interestTotal },
    },
    debts: [...chosen.steps],
    ranking: {
      objective: 'highest_net_return',
      basis: clip(
        `The split that earns the most interest after DIRT that can be known over ${String(horizon)} months on ${euro(lumpTotal)} placed and ${euro(monthlyTotal)} a month, for the inputs given; a fixed term or notice account only where it beats instant access by ${euro(thresholdEur)} and ${String(thresholdPct)}% a year; debts set against savings by net position at month ${String(horizon)}.`,
        400,
      ),
    },
    // The position leads the assumptions: the app's plan card shows them in order.
    assumptions: [position.line, ...assumptions].slice(0, 20).map((text) => clip(text, 300)),
    position: {
      at: position.at,
      total: position.total,
      towardsGoal: position.towardsGoal,
      buffer: position.buffer,
      owed: position.owed,
      line: clip(position.line, 400),
    },
    createdAt,
    dataCheckedAt: [...products.map((product) => product.checkedAt)].sort()[0] ?? createdAt,
  }

  const moneyFound = moneyFoundForPlan(market, modelled, {
    horizonMonths: horizon,
    lumps: allLines.flatMap((line) =>
      line.lumpSum > 0 && line.product.terms.kind === 'deposit'
        ? [
            {
              product: line.product,
              amount: line.lumpSum,
              netInterest12: simulateDeposit(line.product.terms, {
                lumpSum: line.lumpSum,
                monthly: 0,
                horizonMonths: 12,
                termMonths: line.termMonths ?? undefined,
                asOf,
              }).figures.netInterest,
            },
          ]
        : [],
    ),
    cleared: chosen.scenarios.flatMap((scenario) =>
      scenario.chosen === 'cleared'
        ? [
            {
              label:
                situation.debts.find((debt) => debt.id === scenario.debtId)?.label ??
                scenario.debtId,
              keptNet: scenario.kept.netPosition,
              clearedNet: scenario.cleared.netPosition,
            },
          ]
        : [],
    ),
    uncompared: modelled.debts.flatMap((debt) =>
      chosen.ceilings.includes(debt.label) && debt.ratePct !== undefined
        ? [{ label: debt.label, balance: debt.balance, ratePct: debt.ratePct }]
        : [],
    ),
  })

  // ---- Help to Buy, whenever the goal is a home and the buyer a first-time buyer ---------------
  let helpToBuy: BuildPlanResponse['helpToBuy'] = null
  if (main?.kind === 'house_deposit' && situation.firstTimeBuyer !== false) {
    const price = request.homePrice ?? afford?.helpToBuy?.maxPriceWithHelpToBuy ?? null
    const htb = helpToBuyFor({
      price,
      propertyKind: request.propertyKind,
      firstTimeBuyer: true,
      taxPaid: request.taxPaidLastFourYearsEur,
    })
    const where =
      price === null
        ? ''
        : ` on ${euro(price)}${request.homePrice === undefined ? ' (the most the limits allow with it)' : ''}`
    const note =
      htb.status === 'not_available'
        ? `Help to Buy: not available here. ${htb.reasons.join(' ')}`
        : htb.status === 'available'
          ? `Help to Buy: ${euro(htb.amountEur ?? 0)}${where}, counted towards the deposit (Revenue).`
          : `Help to Buy: depends, up to ${euro(htb.upToEur)}${where} for a new build or self-build. ${htb.reasons.slice(1).join(' ')} (Revenue, cap ${euro(HELP_TO_BUY.capEur)} from ${HELP_TO_BUY.capFrom}, to ${HELP_TO_BUY.endsOn}.)`
    helpToBuy = {
      status: htb.status,
      amountEur: htb.amountEur,
      upToEur: htb.upToEur,
      note: note.trim(),
      sourceUrl: HELP_TO_BUY.sources[1]?.url ?? '',
      checkedOn: HELP_TO_BUY.sources[1]?.checkedOn ?? '',
    }
  }

  // ---- Present to the customer ------------------------------------------------------------------
  const presentation = planPresentation({
    assumed: assumedRepayments.map((item) => item.note),
    moneyFound,
    when: whenLabel,
    position: position.line,
    mainLabel: main?.label ?? null,
    reachedOn: current.reachedOn,
    targetAmount: main?.targetAmount,
    scenarios: chosen.scenarios.map((scenario) => ({
      label: situation.debts.find((debt) => debt.id === scenario.debtId)?.label ?? scenario.debtId,
      cleared: scenario.cleared.netPosition,
      kept: scenario.kept.netPosition,
      keptOwed: scenario.kept.debtAtHorizon,
      chosen: scenario.chosen,
    })),
    questions,
    liquidity,
    lines: allLines,
    buffer: bufferHeld,
    extraMonthly,
    helpToBuy,
  })

  return {
    alternatives: [],
    assumedRepayments,
    presentation,
    questions,
    position,
    saveLink: null,
    helpToBuy,
    moneyFound,
    plan,
    horizonMonths: horizon,
    knownThroughMonth: current.knownThrough,
    goalReachedOn: current.reachedOn,
    reasoning,
    debtScenarios: [...chosen.scenarios],
    affordability: afford,
    unplaced: current.unplaced,
    liquidity,
    whatIf: { extraMonthly, goalReachedAtCurrentPace, lines: whatIfLines },
    next:
      assumedRepayments.length === 0
        ? PLAN_NEXT
        : `${PLAN_NEXT} The ${assumedRepayments.map((item) => lowerFirst(item.label)).join(' and ')} figures assume an even repayment over ${String(horizon)} months: the actual monthly repayment, or the months left, makes them exact.`,
  }
}

/**
 * Each debt, as the customer chose (`debt.plan`): `compare` (the default) works out a debt that
 * costs more than the savings would earn both ways, cleared (or overpaid) from the lump sum with
 * its repayment then saved, and kept, and takes the one that leaves more at the horizon; `keep`
 * keeps it, still owed; `clear` clears it. Both outcomes are returned wherever both can be worked
 * out. Every debt given is in the net position: a debt whose repayment was not given counts
 * today's balance as still owed (the most it can be, so the net position is the least), and a
 * mortgage is named as not set against savings.
 *
 * Every net position includes `held`: what sits outside the split (the emergency buffer) at the
 * horizon, so the figure is everything held less everything owed.
 */
function solveDebts(
  situation: Situation,
  place: Placer,
  input: {
    lockAllowed: boolean
    lump: number
    monthly: number
    horizon: number
    targetAmount: number | undefined
    held: number
  },
): Run {
  const { horizon, held } = input
  let { lump, monthly } = input
  const reasoning: string[] = []
  const assumptions: string[] = []
  const steps: MarketPlan['debts'] = []
  const scenarios: BuildPlanResponse['debtScenarios'] = []
  const ceilings: string[] = []
  const notNetted: string[] = []
  let owedAtHorizon = 0
  let current = place(lump, monthly)
  // What the savings in this plan earn after DIRT, at best: the rate a debt is set against.
  const bestNetPct = Math.max(
    0,
    ...current.lines.map((line) =>
      line.product.terms.kind === 'deposit'
        ? simulateDeposit(line.product.terms, {
            lumpSum: line.lumpSum,
            monthly: line.monthly,
            horizonMonths: horizon,
            termMonths: line.termMonths ?? undefined,
          }).figures.netRatePct
        : 0,
    ),
  )

  for (const { debtId } of payoffOrder(situation.debts)) {
    const debt = situation.debts.find((candidate) => candidate.id === debtId)
    if (debt === undefined) continue
    const choice = debt.plan ?? 'compare'
    if (debt.kind === 'mortgage') {
      notNetted.push(debt.label)
      steps.push({
        debtId,
        action: 'keep_paying',
        why: 'A mortgage: not set against savings here; compare it with switcher rates using the mortgage switch calculation.',
      })
      continue
    }
    const baseline = debtAfter(debt, horizon)
    const r = debtMonthlyRate(debt)
    const payment = repaymentOf(debt)

    // ---- Repayment (or rate) not given: today's balance is the most still owed ---------------
    if (baseline === null || r === null || payment === null) {
      const missing =
        debt.ratePct === undefined ? 'No rate given' : 'No repayment or months remaining given'
      if (choice === 'clear' && lump > 0) {
        const amount = round2(Math.min(debt.balance, lump))
        const left = round2(debt.balance - amount)
        lump -= amount
        current = place(lump, monthly)
        if (left > 0) {
          owedAtHorizon += left
          ceilings.push(debt.label)
        }
        steps.push({
          debtId,
          action: left > 0 ? 'overpay' : 'pay_off_first',
          why: clip(
            `${left > 0 ? `${euro(amount)} paid off` : 'Cleared'} from the lump sum, as asked. ${missing}, so the repayment it frees is not counted as saved${left > 0 ? `, and the ${euro(left)} left is counted as still owed` : ''}.`,
            300,
          ),
        })
        reasoning.push(
          `${debt.label}: ${left > 0 ? `${euro(amount)} paid off` : 'cleared'} from the lump sum, as asked. ${missing}: the repayment it frees is not counted as saved, so keeping or clearing it is not compared.`,
        )
        continue
      }
      owedAtHorizon += debt.balance
      ceilings.push(debt.label)
      steps.push({
        debtId,
        action: 'keep_paying',
        why: clip(
          `${choice === 'keep' ? 'Kept, as asked. ' : ''}${missing}: today’s ${euro(debt.balance)} is counted as still owed (the most it can be), and clearing it is not compared.`,
          300,
        ),
      })
      reasoning.push(
        `${debt.label}: kept${choice === 'keep' ? ', as asked' : ''}. ${missing}, so today’s ${euro(debt.balance)} is counted as still owed at month ${String(horizon)}: the most it can be. With the repayment or the months left, both options are worked out.`,
      )
      continue
    }

    const costIfKept = interestToClear(debt.balance, r, payment) ?? undefined
    const notWorthComparing = (debt.ratePct ?? 0) <= bestNetPct
    if (lump <= 0 || (choice === 'compare' && notWorthComparing)) {
      owedAtHorizon += baseline.balance
      steps.push({
        debtId,
        action: 'keep_paying',
        why: clip(
          lump <= 0
            ? `${String(debt.ratePct)}%, and no lump sum is left to put against it.`
            : `${String(debt.ratePct)}% costs less than the savings in this plan earn after DIRT (about ${bestNetPct.toFixed(2)}%).`,
          300,
        ),
        ...(costIfKept === undefined ? {} : { costIfKept }),
      })
      continue
    }

    const amount = round2(Math.min(debt.balance, lump))
    const clears = amount >= debt.balance - 0.005
    const reduced: Debt = {
      ...debt,
      balance: round2(debt.balance - amount),
      monthlyRepayment: payment,
    }
    const after = clears ? { balance: 0, interest: 0 } : debtAfter(reduced, horizon)
    // Cleared: its repayment is saved from the next month on. Overpaid: it clears sooner and the
    // repayment keeps going to it, which is what `debtAfter` models.
    const alternative = place(lump - amount, monthly + (clears ? payment : 0))
    const keptPosition = round2(held + current.savingsAtHorizon - owedAtHorizon - baseline.balance)
    const clearedPosition = round2(
      held + alternative.savingsAtHorizon - owedAtHorizon - (after?.balance ?? 0),
    )
    const pick =
      choice === 'clear'
        ? 'cleared'
        : choice === 'keep'
          ? 'kept'
          : clearedPosition > keptPosition
            ? 'cleared'
            : 'kept'
    const asked = choice === 'compare' ? '' : ' (as asked)'
    scenarios.push({
      debtId,
      amount,
      kept: {
        savingsAtHorizon: round2(held + current.savingsAtHorizon),
        debtAtHorizon: baseline.balance,
        netPosition: keptPosition,
        goalReachedOn: current.reachedOn,
      },
      cleared: {
        savingsAtHorizon: round2(held + alternative.savingsAtHorizon),
        debtAtHorizon: after?.balance ?? 0,
        netPosition: clearedPosition,
        goalReachedOn: alternative.reachedOn,
      },
      chosen: pick,
    })
    const costWithStep = clears ? 0 : (interestToClear(reduced.balance, r, payment) ?? undefined)
    const difference = round2(Math.abs(clearedPosition - keptPosition))
    const more = (mine: number, other: number): string =>
      mine >= other ? `${euro(difference)} more` : `${euro(difference)} less`
    const tradeOff = goalTradeOff(
      input.targetAmount,
      current.reachedOn,
      alternative.reachedOn,
      pick,
      baseline.balance,
    )
    if (pick === 'cleared') {
      steps.push({
        debtId,
        action: clears ? 'pay_off_first' : 'overpay',
        why: clip(
          `At ${String(debt.ratePct)}%${asked}. ${clears ? 'Clearing' : `Paying ${euro(amount)} off`} from the lump sum${clears ? ` and saving its ${euro(round2(payment))} a month` : ''} leaves ${more(clearedPosition, keptPosition)} at month ${String(horizon)} than keeping it.${tradeOff}`,
          300,
        ),
        ...(costIfKept === undefined ? {} : { costIfKept }),
        ...(costWithStep === undefined ? {} : { costWithStep }),
      })
      reasoning.push(
        `${debt.label}: ${clears ? 'cleared' : `${euro(amount)} paid off`} from the lump sum${asked}. Net position (everything held less what is still owed) at month ${String(horizon)}: ${euro(clearedPosition)}, against ${euro(keptPosition)} if kept.${tradeOff}`,
      )
      lump -= amount
      if (clears) {
        const freed = round2(payment)
        const total = round2(monthly + freed)
        const freedLine = `The ${euro(freed)} a month the ${debt.label} took is saved instead from the next month: with the ${euro(monthly)} a month already saved, ${euro(total)} a month goes into the accounts below.`
        reasoning.push(freedLine)
        assumptions.push(freedLine)
        monthly = total
      } else {
        owedAtHorizon += after?.balance ?? 0
      }
      current = alternative
    } else {
      owedAtHorizon += baseline.balance
      steps.push({
        debtId,
        action: 'keep_paying',
        why: clip(
          `Kept${asked}: keeping it and saving the lump sum leaves ${more(keptPosition, clearedPosition)} at month ${String(horizon)} than ${clears ? 'clearing' : 'overpaying'} it, for the inputs given.${tradeOff}`,
          300,
        ),
        ...(costIfKept === undefined ? {} : { costIfKept }),
        ...(costWithStep === undefined ? {} : { costWithStep }),
      })
      reasoning.push(
        `${debt.label}: kept${asked}, still owed. Net position (everything held less what is still owed) at month ${String(horizon)}: ${euro(keptPosition)}, against ${euro(clearedPosition)} if ${clears ? 'cleared' : 'overpaid'}.${tradeOff}`,
      )
    }
  }

  return {
    lockAllowed: input.lockAllowed,
    current,
    steps,
    scenarios,
    reasoning,
    assumptions,
    lump,
    monthly,
    owed: round2(owedAtHorizon),
    ceilings,
    notNetted,
    netPosition: round2(held + current.savingsAtHorizon - owedAtHorizon),
  }
}

/**
 * When the goal's date moves the other way from the net position, say so: keeping a debt can
 * reach a savings target sooner while leaving less overall, and that is the customer's call.
 */
function goalTradeOff(
  target: number | undefined,
  keptOn: string | null,
  clearedOn: string | null,
  chosen: 'kept' | 'cleared',
  owedIfKept: number,
): string {
  if (target === undefined || keptOn === clearedOn) return ''
  const sooner = (a: string | null, b: string | null) => a !== null && (b === null || a < b)
  if (chosen === 'cleared' && sooner(keptOn, clearedOn) && keptOn !== null) {
    return ` Keeping it reaches ${euro(target)} sooner, in ${monthName(keptOn)} rather than ${clearedOn === null ? 'later' : monthName(clearedOn)}, with ${euro(owedIfKept)} still owed at the end.`
  }
  if (chosen === 'kept' && sooner(clearedOn, keptOn) && clearedOn !== null) {
    return ` Clearing it reaches ${euro(target)} sooner, in ${monthName(clearedOn)}.`
  }
  return ''
}

function describeLine(line: AllocationLine): string {
  const terms = line.product.terms
  const name = displayName(line.product)
  const parts: string[] = []
  if (line.lumpSum > 0) {
    parts.push(
      `${euro(line.lumpSum)} in ${name}${line.termMonths === null ? '' : ` for ${String(line.termMonths)} months`}`,
    )
  }
  if (line.monthly > 0) {
    const cap =
      terms.kind === 'deposit' &&
      terms.maxMonthlyEur !== null &&
      line.monthly >= terms.maxMonthlyEur - 0.005
    parts.push(
      `${euro(line.monthly)} a month in ${name}${cap ? ` (its ${euro(terms.kind === 'deposit' ? (terms.maxMonthlyEur ?? 0) : 0)} monthly cap)` : ''}`,
    )
  }
  return `${parts.join('; ')}: the most known interest after DIRT for this part of the money.`
}

function planProduct(
  market: Market,
  line: AllocationLine,
  horizon: number,
  asOf: AsOf,
  options: { role: PlanProduct['role']; goalIds: string[]; reachedOn: string | null },
): PlanProduct {
  const product: ProductView = line.product
  const terms = product.terms
  const rung =
    terms.kind === 'deposit' && line.termMonths !== null
      ? terms.ladder.find((candidate) => candidate.months === line.termMonths)
      : undefined
  const rowId = rung?.productId ?? product.provenance.rows[0]?.productId ?? product.id
  const ratePct =
    rung?.aerPct ??
    (terms.kind === 'deposit' ? (terms.aerPct ?? terms.bands[0]?.aerPct) : undefined)
  const projection = project(
    market,
    {
      horizonMonths: horizon,
      lines: [
        {
          productId: product.id,
          lumpSum: line.lumpSum,
          monthly: line.monthly,
          ...(line.termMonths === null ? {} : { termMonths: line.termMonths }),
        },
      ],
    },
    asOf,
  )
  const figures = projection.lines[0]?.figures
  const guarantee = guaranteeFlag(product)
  const checks = [
    ...(product.rateConfirmed ? [] : [UNCONFIRMED_RATE]),
    ...(guarantee === null ? [] : [guarantee]),
    ...product.checks,
  ]
  const unknowns = [
    ...product.unknowns.map((unknown) => unknown.meaning),
    ...(figures?.stop === null || figures?.stop === undefined
      ? []
      : [`What it pays after month ${String(figures.stop.afterMonths)}`]),
  ]
  const url = product.provenance.providerUrl
  return {
    role: options.role,
    goalIds: options.goalIds,
    provider: product.provider,
    providerName: clip(product.providerName, 80),
    source: product.provenance.source,
    category: product.category,
    productId: clip(rowId, 80),
    productName: clip(
      rung === undefined ? product.name : `${product.name} (${String(rung.months)} months)`,
      120,
    ),
    ...(line.lumpSum > 0 ? { amount: line.lumpSum } : {}),
    ...(line.monthly > 0 ? { monthlyAmount: line.monthly } : {}),
    ...(ratePct === undefined || ratePct === null ? {} : { ratePct }),
    ...(figures === undefined
      ? {}
      : {
          projected: {
            horizonMonths: Math.max(1, figures.knownMonths),
            balance: figures.endBalance,
            netInterest: figures.netInterest,
            ...(options.reachedOn === null ? {} : { goalReachedOn: options.reachedOn }),
          },
        }),
    why: clip(
      options.role === 'emergency_fund'
        ? 'Instant access at the highest rate after DIRT, for money that has to stay reachable.'
        : describeLine(line),
      400,
    ),
    unknowns: unknowns.slice(0, 20).map((text) => clip(text, 120)),
    checks: [...(product.platform === null ? [] : [product.platform.note]), ...checks]
      .filter((text, index, all) => all.indexOf(text) === index)
      .slice(0, 10)
      .map((text) => clip(text, 200)),
    ...(product.depositGuarantee === null
      ? {}
      : {
          depositGuarantee: {
            scheme:
              product.depositGuarantee.scheme === null
                ? null
                : clip(product.depositGuarantee.scheme, 160),
            country: product.depositGuarantee.country,
            coverEur: product.depositGuarantee.coverEur,
            note:
              product.depositGuarantee.note === null
                ? null
                : clip(product.depositGuarantee.note, 300),
            sourceUrl:
              product.depositGuarantee.sourceUrl !== null &&
              product.depositGuarantee.sourceUrl.startsWith('https://') &&
              product.depositGuarantee.sourceUrl.length <= 500
                ? product.depositGuarantee.sourceUrl
                : null,
            checkedOn: product.depositGuarantee.checkedOn,
          },
        }),
    checkedAt: product.provenance.checkedAt,
    ...(product.provenance.attribution === null
      ? {}
      : { attribution: clip(product.provenance.attribution, 200) }),
    ...(url !== null && url.startsWith('https://') && url.length <= 500 ? { url } : {}),
  }
}

function planSituation(situation: Situation): MarketPlan['situation'] {
  const held = situation.savings.reduce((sum, item) => sum + item.balance, 0)
  const summary =
    situation.summary ??
    [
      held > 0 ? `Holds ${euro(held)} in savings.` : null,
      situation.monthlySaving === undefined
        ? null
        : `Can save ${euro(situation.monthlySaving)} a month.`,
      situation.income?.annualGross === undefined
        ? null
        : `Gross income ${euro(situation.income.annualGross)} a year.`,
      ...situation.debts.map(
        (debt) =>
          `${debt.label}: ${euro(debt.balance)}${debt.ratePct === undefined ? '' : ` at ${String(debt.ratePct)}%`}.`,
      ),
    ]
      .filter((part): part is string => part !== null)
      .join(' ')
  return {
    summary: clip(summary === '' ? 'Situation as described to the assistant.' : summary, 1200),
    ...(situation.income === undefined ? {} : { income: situation.income }),
    ...(situation.outgoings === undefined ? {} : { outgoings: situation.outgoings }),
    ...(situation.monthlySaving === undefined ? {} : { monthlySaving: situation.monthlySaving }),
    savings: situation.savings.map((item) => ({
      label: item.label,
      balance: item.balance,
      ...(item.provider === undefined ? {} : { provider: item.provider }),
      ...(item.aerPct === undefined ? {} : { aerPct: item.aerPct }),
    })),
    // The plan choice is an input to this call, not part of what the customer owes.
    debts: situation.debts.map(({ plan: _choice, ...debt }) => debt),
  }
}

/**
 * What the host reads first: the headline sentences, in order, as options with their figures.
 * One net figure per scenario (savings less what is still owed), never a gross pot alone.
 * No instructions: the customer decides.
 */
function planPresentation(input: {
  assumed: readonly string[]
  moneyFound: BuildPlanResponse['moneyFound']
  when: string
  position: string
  mainLabel: string | null
  reachedOn: string | null
  targetAmount: number | undefined
  scenarios: readonly {
    label: string
    cleared: number
    kept: number
    keptOwed: number
    chosen: 'cleared' | 'kept'
  }[]
  questions: readonly string[]
  liquidity: BuildPlanResponse['liquidity']
  lines: readonly AllocationLine[]
  buffer: number
  extraMonthly: BuildPlanResponse['whatIf']['extraMonthly']
  helpToBuy: BuildPlanResponse['helpToBuy']
}): string[] {
  const out: string[] = [input.moneyFound.headline, input.position, ...input.assumed]
  for (const scenario of input.scenarios) {
    const better = scenario.cleared >= scenario.kept ? 'cleared' : 'kept'
    out.push(
      `${scenario.label}, cleared or kept (both worked out in this call, each everything held less what is still owed at ${input.when}): cleared from savings now, ${euro(scenario.cleared)}; kept, ${euro(scenario.kept)} (${scenario.keptOwed > 0 ? `${euro(scenario.keptOwed)} still owed then` : 'repaid by then'}). ${better === 'cleared' ? 'Clearing it' : 'Keeping it'} leaves ${euro(round2(Math.abs(scenario.cleared - scenario.kept)))} more. This plan has it ${scenario.chosen}.`,
    )
  }
  if (input.mainLabel !== null && input.targetAmount !== undefined) {
    out.push(
      `${input.mainLabel}${input.targetAmount === undefined ? '' : input.reachedOn === null ? `: ${euro(input.targetAmount)} is not reached within the figures` : `: ${euro(input.targetAmount)} is reached in ${monthName(input.reachedOn)}`}.`,
    )
  }
  const placed = input.lines
    .map((line) => {
      const parts = [
        line.lumpSum > 0 ? euro(line.lumpSum) : null,
        line.monthly > 0 ? `${euro(line.monthly)} a month` : null,
      ].filter((part): part is string => part !== null)
      return `${parts.join(' and ')} in ${displayName(line.product)}${line.termMonths === null ? '' : ` (${String(line.termMonths)}-month term)`}`
    })
    .join('; ')
  if (placed !== '') {
    out.push(
      `The split this plan uses: ${placed}${input.buffer > 0 ? `, the first ${euro(input.buffer)} as an emergency buffer kept apart` : ''}.`,
    )
  }
  if (input.liquidity.decision === 'instant_access' && input.liquidity.gainEur !== null) {
    out.push(
      input.liquidity.gainEur <= 0
        ? `Everything stays in instant access: no fixed term pays more by ${input.when}.`
        : `Everything stays in instant access: a fixed term would add only ${euro(input.liquidity.gainEur)} by ${input.when}.`,
    )
  } else if (input.liquidity.decision === 'locked' && input.liquidity.gainEur !== null) {
    out.push(
      `A fixed term adds ${euro(input.liquidity.gainEur)} by ${input.when} over instant access, with the money tied up until it ends.`,
    )
  }
  if (input.extraMonthly !== null) {
    out.push(
      `Each extra ${euro(input.extraMonthly.extra)} a month adds about ${euro(input.extraMonthly.addsAtHorizon)} by ${input.when}.`,
    )
  }
  if (input.helpToBuy !== null) out.push(input.helpToBuy.note)
  out.push(...sharpenLines(input.questions))
  out.push('These are options with their figures, for the inputs given; the customer decides.')
  return out
}

/**
 * Where the plan ends, everything included and each part named (after the fourth Claude test:
 * a net figure that left out the buffer, or had no debt in it, read as something it was not).
 * Towards the goal plus the buffer, less what is still owed; with no debts given it says so
 * rather than calling the figure a net position.
 */
function planPosition(input: {
  at: string
  when: string
  total: number
  towardsGoal: number
  goalLabel: string | null
  buffer: number
  owed: number
  debts: readonly Debt[]
  steps: MarketPlan['debts']
  ceilings: readonly string[]
  notNetted: readonly string[]
}): BuildPlanResponse['position'] {
  // Whole euro: the position is a headline, and its parts add up to it to the euro.
  const eur0 = (value: number): string => euro(Math.round(value))
  const goal =
    input.goalLabel === null
      ? 'the savings'
      : /^the\s/i.test(input.goalLabel)
        ? lowerFirst(input.goalLabel)
        : `the ${lowerFirst(input.goalLabel)}`
  const list = (names: readonly string[]): string =>
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`
  const held = [
    `${eur0(input.towardsGoal)} towards ${goal}`,
    ...(input.buffer > 0 ? [`${eur0(input.buffer)} emergency buffer`] : []),
  ]
  const parts = `: ${list(held)}`
  const total = eur0(input.total)
  const owing = input.debts.filter((debt) => debt.kind !== 'mortgage')
  const cleared = owing.filter((debt) =>
    input.steps.some((step) => step.debtId === debt.id && step.action === 'pay_off_first'),
  )
  const stillOwed = owing
    .filter((debt) => !cleared.includes(debt))
    .map((debt) => lowerFirst(debt.label))
  const notNetted =
    input.notNetted.length === 0
      ? ''
      : ` The ${list(input.notNetted.map(lowerFirst))} ${input.notNetted.length === 1 ? 'is' : 'are'} not set against savings here.`

  let line: string
  if (input.debts.length === 0) {
    line = `${total} in all at ${input.when}${parts} (no debts given).`
  } else if (input.owed <= 0) {
    line = `${total} in all at ${input.when}${parts}, with nothing still owed on the debts given${cleared.length === 0 ? '' : ` (the ${list(cleared.map((debt) => lowerFirst(debt.label)))} cleared from savings in this plan)`}.${notNetted}`
  } else {
    line = `${total} net at ${input.when}, everything held less what is still owed${parts}, less ${eur0(input.owed)} still owed on the ${list(stillOwed)}${input.ceilings.length === 0 ? '' : ` (for the ${list(input.ceilings.map(lowerFirst))}, today’s balance, the most it can be: its repayment was not given, so ${total} is the least)`}.${notNetted}`
  }
  return {
    at: input.at,
    total: input.total,
    towardsGoal: round2(input.towardsGoal),
    buffer: round2(input.buffer),
    owed: round2(input.owed),
    owedIsCeiling: input.ceilings.length > 0,
    debtsGiven: input.debts.length > 0,
    line,
  }
}
