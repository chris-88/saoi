import type {
  BuildPlanRequest,
  BuildPlanResponse,
  Debt,
  Goal,
  ProductView,
  Situation,
} from '../../contracts/market-tools.ts'
import type { MarketPlan, PlanProduct } from '../../contracts/market-plan.ts'
import { allocatable, allocate, type AllocationLine } from './allocate.ts'
import { debtMonthlyRate, payoffOrder, repaymentOf } from './debt.ts'
import { displayName, euro, interestToClear } from './figures.ts'
import { affordability } from './mortgage.ts'
import { project } from './projection.ts'
import { monthlyOutgoings } from './review.ts'
import { SAVINGS_ASSUMPTIONS, UNCONFIRMED_RATE } from './search.ts'
import { monthsUntil, round2, simulateDeposit } from './simulate.ts'
import type { AsOf, Market } from './types.ts'

/**
 * The fastest combination for someone's goals, across the whole market: `savings/arrange.ts`
 * generalised, returned as a `MarketPlan` (`contracts/market-plan.ts`) ready for
 * `POST /api/plans`.
 *
 * In order:
 * 1. An emergency fund, where it is a goal, goes first into the best instant-access account.
 * 2. Each debt that costs more than the savings would earn is worked out both ways, cleared from
 *    the lump sum (its repayment then saved) and kept, and the one that leaves more at the
 *    horizon is taken; both sets of figures are returned.
 * 3. What is left is split across the market by `allocate`: regular savers to their monthly
 *    caps, the lump sum to the longest term that ends by the goal's date (or instant and notice
 *    access when there is no date), within the deposit guarantee per provider.
 * 4. It is projected month by month, and the month the main goal is reached is stated.
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

export function buildPlan(
  market: Market,
  request: BuildPlanRequest,
  asOf: AsOf,
  createdAt: string,
): BuildPlanResponse {
  const { situation, goals } = request
  const maxAccounts = request.maxAccounts ?? DEFAULT_MAX_ACCOUNTS
  const reasoning: string[] = []
  const assumptions: string[] = [...SAVINGS_ASSUMPTIONS]

  const ordered = [...goals].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
  const main = ordered.find((goal) => SAVING_GOALS.has(goal.kind)) ?? null
  const emergency = ordered.find((goal) => goal.kind === 'emergency_fund') ?? null
  const dated = main?.targetDate !== undefined
  const horizon =
    main?.targetDate === undefined ? NO_DATE_HORIZON : monthsUntil(asOf, main.targetDate)
  const lockAllowed = dated
  if (!dated) {
    assumptions.push(
      `No date for the main goal: nothing is locked in a fixed term or notice account, and the figures run ${String(NO_DATE_HORIZON)} months.`,
    )
  }

  // ---- The money to place -------------------------------------------------------------------
  const available = situation.savings.filter((item) => item.access !== 'fixed_term')
  let lump = available.reduce((sum, item) => sum + item.balance, 0)
  let monthly = situation.monthlySaving ?? 0
  if (situation.savings.some((item) => item.access === 'fixed_term')) {
    assumptions.push('Savings already in a fixed term are left where they are.')
  }
  assumptions.push('Every other euro of savings held is treated as available to place.')
  reasoning.push(
    `${euro(lump)} held and ${euro(monthly)} a month to place, over ${String(horizon)} months.`,
  )

  // ---- 1. Emergency fund ----------------------------------------------------------------------
  const productsOut: PlanProduct[] = []
  let emergencyLines: readonly AllocationLine[] = []
  if (emergency !== null) {
    const outgoings = monthlyOutgoings(situation)
    const target =
      emergency.targetAmount ??
      (outgoings === null
        ? null
        : outgoings * (request.emergencyFundMonths ?? DEFAULT_EMERGENCY_MONTHS))
    if (target === null) {
      reasoning.push(
        'An emergency fund is a goal, but neither its size nor monthly outgoings were given, so none is set aside.',
      )
    } else {
      const take = Math.min(target, lump)
      const pool = allocatable(market.products, {
        horizonMonths: horizon,
        lockAllowed: false,
      })
      const fund = allocate(pool, {
        lumpSum: take,
        monthly: 0,
        horizonMonths: horizon,
        lockAllowed: false,
        maxAccounts: 1,
        asOf,
      })
      emergencyLines = fund.lines
      const placed = take - fund.unplaced.lumpSum
      lump -= placed
      const line = fund.lines[0]
      reasoning.push(
        line === undefined
          ? `No instant-access account takes ${euro(take)}, so the emergency fund is not placed.`
          : `${euro(placed)} set aside first for the emergency fund in ${displayName(line.product)}: the highest interest after DIRT with instant access.${take < target ? ` That is ${euro(round2(target - take))} short of ${euro(target)}.` : ''}`,
      )
    }
  }

  // ---- 2. Debts -------------------------------------------------------------------------------
  const pool = allocatable(market.products, {
    horizonMonths: horizon,
    lockAllowed,
  })
  const accountsLeft = Math.max(1, maxAccounts - emergencyLines.length)
  const place = (lumpSum: number, perMonth: number): Placed => {
    const allocation = allocate(pool, {
      lumpSum,
      monthly: perMonth,
      horizonMonths: horizon,
      lockAllowed,
      maxAccounts: accountsLeft,
      asOf,
    })
    if (allocation.lines.length === 0) {
      return {
        lines: [],
        unplaced: allocation.unplaced,
        savingsAtHorizon: 0,
        knownThrough: horizon,
        reachedOn: null,
        netInterest: 0,
      }
    }
    const projection = project(
      market,
      {
        horizonMonths: horizon,
        lines: allocation.lines.map((line) => ({
          productId: line.product.id,
          lumpSum: line.lumpSum,
          monthly: line.monthly,
          ...(line.termMonths === null ? {} : { termMonths: line.termMonths }),
        })),
        ...(main?.targetAmount === undefined ? {} : { targetAmount: main.targetAmount }),
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

  const steps: MarketPlan['debts'] = []
  const scenarios: BuildPlanResponse['debtScenarios'] = []
  const order = payoffOrder(situation.debts)
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

  for (const { debtId } of order) {
    const debt = situation.debts.find((candidate) => candidate.id === debtId)
    if (debt === undefined) continue
    if (debt.kind === 'mortgage') {
      steps.push({
        debtId,
        action: 'keep_paying',
        why: 'A mortgage: compare it with switcher rates using the mortgage switch calculation.',
      })
      continue
    }
    if (debt.ratePct === undefined) {
      steps.push({
        debtId,
        action: 'keep_paying',
        why: 'No rate given, so its cost cannot be set against savings.',
      })
      continue
    }
    const baseline = debtAfter(debt, horizon)
    const r = debtMonthlyRate(debt)
    const payment = repaymentOf(debt)
    if (baseline === null || r === null || payment === null) {
      steps.push({
        debtId,
        action: 'keep_paying',
        why: 'No repayment or months remaining given, so its cost cannot be worked out.',
      })
      continue
    }
    const costIfKept = interestToClear(debt.balance, r, payment) ?? undefined
    if (debt.ratePct <= bestNetPct || lump <= 0) {
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
    const keptPosition = round2(current.savingsAtHorizon - baseline.balance)
    const clearedPosition = round2(alternative.savingsAtHorizon - (after?.balance ?? 0))
    const chosen = clearedPosition > keptPosition ? 'cleared' : 'kept'
    scenarios.push({
      debtId,
      amount,
      kept: {
        savingsAtHorizon: current.savingsAtHorizon,
        debtAtHorizon: baseline.balance,
        netPosition: keptPosition,
        goalReachedOn: current.reachedOn,
      },
      cleared: {
        savingsAtHorizon: alternative.savingsAtHorizon,
        debtAtHorizon: after?.balance ?? 0,
        netPosition: clearedPosition,
        goalReachedOn: alternative.reachedOn,
      },
      chosen,
    })
    const costWithStep = clears ? 0 : (interestToClear(reduced.balance, r, payment) ?? undefined)
    const difference = round2(Math.abs(clearedPosition - keptPosition))
    const tradeOff = goalTradeOff(
      main?.targetAmount,
      current.reachedOn,
      alternative.reachedOn,
      chosen,
      baseline.balance,
    )
    if (chosen === 'cleared') {
      steps.push({
        debtId,
        action: clears ? 'pay_off_first' : 'overpay',
        why: clip(
          `At ${String(debt.ratePct)}% it costs more than the savings earn. ${clears ? 'Clearing' : `Paying ${euro(amount)} off`} from the lump sum${clears ? ` and saving its ${euro(round2(payment))} a month` : ''} leaves ${euro(difference)} more at month ${String(horizon)} than keeping it.${tradeOff}`,
          300,
        ),
        ...(costIfKept === undefined ? {} : { costIfKept }),
        ...(costWithStep === undefined ? {} : { costWithStep }),
      })
      reasoning.push(
        `${debt.label}: ${clears ? 'cleared' : `${euro(amount)} paid off`} from the lump sum. Net position (savings less debt) at month ${String(horizon)}: ${euro(clearedPosition)}, against ${euro(keptPosition)} if kept.${tradeOff}`,
      )
      lump -= amount
      if (clears) monthly += payment
      current = alternative
    } else {
      steps.push({
        debtId,
        action: 'keep_paying',
        why: clip(
          `Keeping it and saving the lump sum leaves ${euro(difference)} more at month ${String(horizon)} than ${clears ? 'clearing' : 'overpaying'} it, for the inputs given.${tradeOff}`,
          300,
        ),
        ...(costIfKept === undefined ? {} : { costIfKept }),
        ...(costWithStep === undefined ? {} : { costWithStep }),
      })
      reasoning.push(
        `${debt.label}: kept. Net position (savings less debt) at month ${String(horizon)}: ${euro(keptPosition)}, against ${euro(clearedPosition)} if ${clears ? 'cleared' : 'overpaid'}.${tradeOff}`,
      )
    }
  }

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
  if (main?.targetAmount !== undefined) {
    reasoning.push(
      current.reachedOn === null
        ? `${main.label}: ${euro(main.targetAmount)} is not reached within the ${String(current.knownThrough)} months the figures cover; ${euro(current.savingsAtHorizon)} is projected.`
        : `${main.label}: ${euro(main.targetAmount)} is reached in ${monthName(current.reachedOn)}.`,
    )
  }

  // ---- 4. What a house deposit supports --------------------------------------------------------
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
    const note = `A ${euro(deposit)} deposit and ${euro(situation.income.annualGross)} gross income support a price up to ${euro(result.maxPrice)} under the Central Bank limits (the ${result.bindingLimit} limit binds)${situation.firstTimeBuyer === undefined ? ', as a first-time buyer' : ''}.`
    afford = {
      deposit,
      maxPrice: result.maxPrice,
      maxLoanByIncome: result.maxLoanByIncome,
      bindingLimit: result.bindingLimit,
      note,
    }
    reasoning.push(note)
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
  productsOut.push(...products)
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
      products: productsOut.slice(0, 12),
      totals: { monthly: monthlyTotal, lumpSum: lumpTotal, netInterest: interestTotal },
    },
    debts: steps,
    ranking: {
      objective: 'highest_net_return',
      basis: clip(
        `The split that earns the most interest after DIRT that can be known over ${String(horizon)} months on ${euro(lumpTotal)} placed and ${euro(monthlyTotal)} a month, for the inputs given; debts set against savings by net position at month ${String(horizon)}.`,
        400,
      ),
    },
    assumptions: assumptions.slice(0, 20).map((text) => clip(text, 300)),
    createdAt,
    dataCheckedAt: [...productsOut.map((product) => product.checkedAt)].sort()[0] ?? createdAt,
  }

  return {
    plan,
    horizonMonths: horizon,
    knownThroughMonth: current.knownThrough,
    goalReachedOn: current.reachedOn,
    reasoning,
    debtScenarios: scenarios,
    affordability: afford,
    unplaced: current.unplaced,
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
  const checks = [
    ...(product.rateConfirmed ? [] : [UNCONFIRMED_RATE]),
    ...(product.depositGuarantee !== null &&
    product.depositGuarantee.country !== 'Ireland' &&
    product.depositGuarantee.scheme !== null
      ? [`Covered by the ${product.depositGuarantee.scheme}, not the Irish scheme.`]
      : []),
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
    debts: situation.debts.map((debt) => ({ ...debt })),
  }
}
