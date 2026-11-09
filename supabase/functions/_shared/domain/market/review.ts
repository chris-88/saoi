import type {
  Finding,
  Goal,
  ReviewRequest,
  ReviewResponse,
  Situation,
} from '../../contracts/market-tools.ts'
import { costOf } from './debt.ts'
import { attributionsOf, displayName, euro, oldestCheck } from './figures.ts'
import { HELP_TO_BUY } from '../../market/first-home-rules.ts'
import { firstHome } from './first-home.ts'
import { moneyFoundForReview } from './money-found.ts'
import { savingsCandidates } from './search.ts'
import { DIRT_RATE, monthsUntil, round2 } from './simulate.ts'
import type { AsOf, Market } from './types.ts'

/**
 * A first look at someone's money: deterministic findings, each with its euro figures, and the
 * goals they suggest. Every comparison is against the market as Saoi holds it today, and names
 * the product it compares with.
 */

const IDLE_AER_PCT = 0.1
const EMERGENCY_MONTHS = 3

export function monthlyOutgoings(situation: Situation): number | null {
  const rent = situation.outgoings?.rentMonthly
  const other = situation.outgoings?.otherMonthly
  if (rent === undefined && other === undefined) return null
  return (rent ?? 0) + (other ?? 0)
}

/** The best instant-access deposit for an amount over twelve months, after DIRT. */
export function bestInstantAccess(market: Market, amount: number, asOf: AsOf) {
  const found = savingsCandidates(
    market.products,
    { category: 'deposit', amount: Math.max(amount, 1), horizonMonths: 12, access: 'instant' },
    asOf,
    { add: () => undefined },
    [],
  )
  return (
    [...found.candidates].sort(
      (a, b) =>
        (b.figures.kind === 'savings' ? b.figures.netInterest : 0) -
        (a.figures.kind === 'savings' ? a.figures.netInterest : 0),
    )[0] ?? null
  )
}

export function review(market: Market, request: ReviewRequest, asOf: AsOf): ReviewResponse {
  const { situation, goals } = request
  const findings: Finding[] = []
  const assumptions = [
    'Savings rates are compared after DIRT at 33%, over twelve months, in instant-access accounts.',
    'Variable rates are assumed to stay as published.',
  ]
  const held = situation.savings
  const total = held.reduce((sum, item) => sum + item.balance, 0)
  const best = bestInstantAccess(market, total, asOf)
  const bestNetPct = best === null || best.figures.kind !== 'savings' ? 0 : best.figures.netRatePct
  const bestName = best === null ? null : displayName(best.product)

  // ---- Idle money --------------------------------------------------------------------------
  for (const item of held) {
    if (item.aerPct === undefined) {
      findings.push({
        kind: 'unknown_rate',
        headline: `What ${euro(item.balance)} in ${item.label} earns is not known`,
        detail: 'No rate was given, so it is not compared. It is not assumed to earn nothing.',
        figures: { balance: item.balance },
      })
      continue
    }
    if (item.aerPct > IDLE_AER_PCT || item.access === 'fixed_term' || item.balance <= 0) continue
    const now = round2(item.balance * (item.aerPct / 100) * (1 - DIRT_RATE))
    const could = round2((item.balance * bestNetPct) / 100)
    if (could <= now) continue
    findings.push({
      kind: 'idle_money',
      headline: `${euro(item.balance)} in ${item.label} earns ${euro(now)} a year after DIRT`,
      detail: `At ${item.aerPct}% it earns ${euro(now)} a year. The highest instant-access rate Saoi holds${bestName === null ? '' : ` (${bestName})`} would pay about ${euro(could)} after DIRT on the same money, with access kept.`,
      figures: {
        balance: item.balance,
        earnsNow: now,
        couldEarnInstantAccess: could,
        difference: round2(could - now),
      },
    })
  }

  // ---- Emergency fund ---------------------------------------------------------------------
  const outgoings = monthlyOutgoings(situation)
  if (outgoings === null) {
    assumptions.push('Monthly outgoings were not given, so an emergency fund is not sized.')
  } else {
    const accessible = held
      .filter((item) => item.access !== 'fixed_term' && item.access !== 'notice')
      .reduce((sum, item) => sum + item.balance, 0)
    const target = outgoings * EMERGENCY_MONTHS
    if (accessible < target) {
      findings.push({
        kind: 'no_emergency_fund',
        headline: `Instant-access savings cover ${String(round2(outgoings === 0 ? 0 : accessible / outgoings))} months of outgoings`,
        detail: `Three months of outgoings is ${euro(target)}; ${euro(accessible)} is held where it can be reached at once.`,
        figures: {
          outgoingsMonthly: outgoings,
          threeMonths: target,
          accessibleNow: accessible,
          shortfall: round2(target - accessible),
        },
      })
    }
  }

  // ---- Debt costing more than savings earn -----------------------------------------------
  for (const debt of situation.debts) {
    if (debt.kind === 'mortgage' || debt.ratePct === undefined) continue
    const netSavingsPct = bestNetPct
    if (debt.ratePct <= netSavingsPct) continue
    const cost = costOf(debt)
    const annual = round2((debt.balance * debt.ratePct) / 100)
    const sameInSavings = round2((debt.balance * netSavingsPct) / 100)
    findings.push({
      kind: 'debt_costs_more_than_savings_earn',
      headline: `${debt.label} at ${String(debt.ratePct)}% costs more than any savings account earns`,
      detail: `${euro(debt.balance)} at ${String(debt.ratePct)}% costs about ${euro(annual)} a year in interest. The same money in the highest-paying instant-access account would earn about ${euro(sameInSavings)} after DIRT.${cost.interestRemaining === null ? '' : ` Interest still to pay at the current repayment: ${euro(cost.interestRemaining)}.`}${total > 0 ? ` ${euro(total)} is held in savings.` : ''}`,
      figures: {
        balance: debt.balance,
        ratePct: debt.ratePct,
        annualInterest: annual,
        bestSavingsNetRatePct: netSavingsPct,
        sameMoneyInSavingsEarns: sameInSavings,
        ...(cost.interestRemaining === null ? {} : { interestRemaining: cost.interestRemaining }),
      },
    })
  }

  // ---- A fixed term ending soon ----------------------------------------------------------
  for (const item of held) {
    if (item.fixedTermEndsOn === undefined) continue
    const months = monthsUntil(asOf, item.fixedTermEndsOn)
    if (months > 3) continue
    findings.push({
      kind: 'fixed_term_ending',
      headline: `${item.label}: the fixed term ends ${item.fixedTermEndsOn}`,
      detail: `${euro(item.balance)} comes back within ${String(months)} month${months === 1 ? '' : 's'}. Unless it is moved, it usually rolls into the provider’s default account or a new term at its current rate.`,
      figures: { balance: item.balance, monthsUntilEnd: months },
    })
  }

  // ---- Goals short at the current pace ---------------------------------------------------
  for (const goal of [...goals].sort(byPriority)) {
    if (goal.targetAmount === undefined || goal.targetDate === undefined) continue
    const months = monthsUntil(asOf, goal.targetDate)
    const monthly = situation.monthlySaving ?? 0
    const projected = total + monthly * months
    if (projected >= goal.targetAmount) continue
    findings.push({
      kind: 'goal_short_at_current_pace',
      headline: `${goal.label}: ${euro(round2(goal.targetAmount - projected))} short by ${goal.targetDate} at the current pace`,
      detail: `${euro(total)} held and ${euro(monthly)} a month for ${String(months)} months is ${euro(projected)} before interest, against ${euro(goal.targetAmount)}. Reaching it needs about ${euro(round2((goal.targetAmount - total) / months))} a month before interest.`,
      figures: {
        target: goal.targetAmount,
        months,
        projectedBeforeInterest: projected,
        shortfall: round2(goal.targetAmount - projected),
        monthlyNeededBeforeInterest: round2((goal.targetAmount - total) / months),
      },
    })
  }
  if (goals.some((goal) => goal.targetAmount !== undefined && goal.targetDate !== undefined)) {
    assumptions.push(
      'Goal pace counts savings held and monthly saving before interest; every goal is set against all savings held.',
    )
  }

  // ---- A first home: Help to Buy -----------------------------------------------------------
  const firstHomeGoal = goals.some((goal) => goal.kind === 'house_deposit')
  if (situation.firstTimeBuyer === true || (firstHomeGoal && situation.firstTimeBuyer !== false)) {
    const income = situation.income?.annualGross
    const home =
      income === undefined
        ? null
        : firstHome(market, {
            annualGrossIncome: income,
            deposit: total,
            propertyKind: 'new_build',
            limit: 1,
          })
    const withHtb = home?.lending.maxPriceWithHelpToBuy ?? null
    findings.push({
      kind: 'help_to_buy',
      headline: `Help to Buy: up to ${euro(HELP_TO_BUY.capEur)} towards a new build, for a first-time buyer`,
      detail: `Revenue refunds the lesser of 10% of a new build’s or self-build’s price (up to ${euro(HELP_TO_BUY.maxPriceEur)}), ${euro(HELP_TO_BUY.capEur)}, and the Income Tax and DIRT paid over the last four tax years, for homes bought or built by ${HELP_TO_BUY.endsOn}.${withHtb === null || home === null ? '' : ` With ${euro(total)} saved and ${euro(income ?? 0)} income, the Central Bank limits allow a price up to ${euro(home.lending.maxPriceWithoutHelpToBuy)}, or ${euro(withHtb)} for a new build with Help to Buy towards the deposit.`} saoi_first_home works it out for a price.${situation.firstTimeBuyer === undefined ? ' Assumed a first-time buyer.' : ''}`,
      figures: {
        capEur: HELP_TO_BUY.capEur,
        maxPriceEur: HELP_TO_BUY.maxPriceEur,
        ...(home === null
          ? {}
          : { maxPriceWithoutHelpToBuy: home.lending.maxPriceWithoutHelpToBuy }),
        ...(withHtb === null ? {} : { maxPriceWithHelpToBuy: withHtb }),
      },
    })
    assumptions.push(
      `Help to Buy as Revenue states it (${HELP_TO_BUY.sources[1]?.url ?? ''}, checked ${HELP_TO_BUY.sources[1]?.checkedOn ?? ''}).`,
    )
  }

  // ---- Candidate goals -------------------------------------------------------------------
  const has = (kind: Goal['kind']) => goals.some((goal) => goal.kind === kind)
  const candidateGoals: ReviewResponse['candidateGoals'] = []
  if (!has('emergency_fund') && findings.some((f) => f.kind === 'no_emergency_fund')) {
    candidateGoals.push({
      kind: 'emergency_fund',
      label: 'Three months’ outgoings in instant access',
      why: 'Instant-access savings are below three months of outgoings.',
    })
  }
  if (
    !has('pay_off_debt') &&
    findings.some((f) => f.kind === 'debt_costs_more_than_savings_earn')
  ) {
    candidateGoals.push({
      kind: 'pay_off_debt',
      label: 'Clear the highest-rate debt',
      why: 'A debt costs more in interest than any savings account earns.',
    })
  }
  if (!has('grow_savings') && findings.some((f) => f.kind === 'idle_money')) {
    candidateGoals.push({
      kind: 'grow_savings',
      label: 'Put idle money to work',
      why: 'Money is held at a rate well below what instant access pays.',
    })
  }
  if (!has('house_deposit') && situation.firstTimeBuyer === true) {
    candidateGoals.push({
      kind: 'house_deposit',
      label: 'A house deposit',
      why: 'A first-time buyer: 10% of the price is needed under the Central Bank’s limits.',
    })
  }
  if (
    !has('switch_mortgage') &&
    situation.debts.some((debt) => debt.kind === 'mortgage' && debt.ratePct !== undefined)
  ) {
    candidateGoals.push({
      kind: 'switch_mortgage',
      label: 'Compare the mortgage with switcher rates',
      why: 'A mortgage rate was given; the market’s switcher rates can be set against it.',
    })
  }

  const compared = best === null ? [] : [best.product]
  return {
    moneyFound: moneyFoundForReview(market, situation, asOf),
    findings,
    candidateGoals,
    assumptions,
    dataCheckedAt: oldestCheck(compared),
    attributions: attributionsOf(compared),
    next: REVIEW_NEXT,
  }
}

/** What the host relays after a review: the way to a plan, and what saving it adds. */
export const REVIEW_NEXT = [
  'Nothing has been stored. These findings are figures for the customer to weigh; they decide what matters.',
  'Once they have chosen goals (with an amount and a date where they have one), saoi_build_plan turns this into a plan with products, figures and the month each goal is reached.',
  'A plan can then be saved into the Saoi app with saoi_save_plan: it opens there as a card that Saoirse, Saoi’s assistant, knows and can talk through, and signing in keeps it across devices.',
].join(' ')

function byPriority(a: Goal, b: Goal): number {
  return (a.priority ?? 99) - (b.priority ?? 99)
}
