import type {
  Debt,
  MoneyFound,
  ProductView,
  SavingsFigures,
  Situation,
} from '../../contracts/market-tools.ts'
import { debtMonthlyRate, repaymentOf } from './debt.ts'
import { displayName, euro } from './figures.ts'
import { isCurrentAccount, withHeldRates } from './held-rates.ts'
import { switchMortgage } from './mortgage.ts'
import { savingsCandidates } from './search.ts'
import { DIRT_RATE, round2 } from './simulate.ts'
import type { AsOf, Market } from './types.ts'

/**
 * "Money found": one figure a year, broken into parts, each part resting on a sourced, dated
 * rate and the customer's own figures. Honest by construction:
 *
 * - idle cash counts only where what it earns now was given (an unknown rate is never zero);
 * - only confirmed rates count (a rate resting on CCPC's one figure is shown in `notCounted`);
 * - bonuses and cashback are never counted (the savings figures exclude bonuses; a switch's
 *   saving is the repayment difference only);
 * - debt interest is what clearing it from savings would avoid in the next twelve months, less
 *   what the same money would have earned in the best confirmed instant-access account.
 */

type Part = MoneyFound['parts'][number]
type NotCounted = MoneyFound['notCounted'][number]
type Best = { product: ProductView; figures: SavingsFigures }

const ACCESSIBLE = (item: Situation['savings'][number]): boolean =>
  item.access !== 'fixed_term' && item.access !== 'notice'

const whole = (value: number): number => Math.round(value)

/** The best instant-access account for an amount over twelve months: confirmed, and overall. */
function bestInstant(
  market: Market,
  amount: number,
  asOf: AsOf,
): { confirmed: Best | null; any: Best | null } {
  const found = savingsCandidates(
    market.products,
    { category: 'deposit', amount: Math.max(amount, 1), horizonMonths: 12, access: 'instant' },
    asOf,
    { add: () => undefined },
    [],
  )
  const ranked = found.candidates
    .flatMap((candidate) =>
      candidate.figures.kind === 'savings'
        ? [{ product: candidate.product, figures: candidate.figures }]
        : [],
    )
    .sort((a, b) => b.figures.netInterest - a.figures.netInterest)
  return {
    confirmed: ranked.find((candidate) => candidate.product.rateConfirmed) ?? null,
    any: ranked[0] ?? null,
  }
}

/** Twelve months' net interest at a product's figures, scaled to an amount. */
const netOn = (best: Best, amount: number): number =>
  best.figures.paidIn > 0 ? (best.figures.netInterest * amount) / best.figures.paidIn : 0

const sourceOf = (product: ProductView) => ({
  source: product.provenance.source === 'bank' ? `${product.providerName}’s own site` : 'CCPC',
  sourceUrl: product.provenance.providerUrl ?? product.provenance.sourceUrl,
  checkedAt: product.provenance.checkedAt,
})

/** Interest the next twelve months would cost on `amount` of the debt. */
function interestNextYear(debt: Debt, amount: number): number {
  const r = debtMonthlyRate(debt)
  const payment = repaymentOf(debt)
  if (r === null) return 0
  if (payment === null || amount < debt.balance - 0.005) return (amount * (debt.ratePct ?? 0)) / 100
  let balance = debt.balance
  let interest = 0
  for (let month = 0; month < 12 && balance > 0; month += 1) {
    const charge = balance * r
    interest += charge
    balance = Math.max(0, balance + charge - payment)
  }
  return interest
}

/** The best switch for a mortgage given in the situation, counted conservatively. */
function mortgageParts(
  market: Market,
  situation: Situation,
): { parts: Part[]; notCounted: NotCounted[] } {
  const parts: Part[] = []
  const notCounted: NotCounted[] = []
  for (const debt of situation.debts) {
    if (debt.kind !== 'mortgage' || debt.ratePct === undefined) continue
    if (debt.monthsRemaining === undefined) {
      notCounted.push({
        label: `${debt.label}: a switch`,
        annualEur: null,
        why: 'The months remaining were not given, so a switch cannot be worked out.',
      })
      continue
    }
    const result = switchMortgage(market, {
      mode: 'switch',
      balance: debt.balance,
      currentRatePct: debt.ratePct,
      remainingTermYears: Math.max(1, Math.ceil(debt.monthsRemaining / 12)),
    })
    // Without the home's value the loan-to-value is not known: count only rates in a band that
    // reaches 90% LTV (the dearest band, so a lower LTV does no worse), for any BER (no green
    // rate), below the high-value threshold.
    const open = result.options.filter(
      (option) =>
        option.product.terms.kind === 'mortgage' &&
        (option.product.terms.ltvMaxPct ?? 0) >= 90 &&
        option.product.terms.ber === null &&
        !/green|\bBER\b/i.test(option.product.name) &&
        !option.product.terms.highValue &&
        option.monthlySaving > 0,
    )
    const best = [...open].sort((a, b) => b.monthlySaving - a.monthlySaving)[0]
    if (best === undefined) continue
    parts.push({
      kind: 'mortgage_switch',
      label: `${debt.label}: switching to ${displayName(best.product)}`,
      annualEur: whole(best.monthlySaving * 12),
      detail: `${euro(best.monthlySaving)} a month less than at ${String(debt.ratePct)}% on ${euro(debt.balance)}, while its initial rate holds. Cashback and switching fees are not counted; the rate is one for a loan-to-value up to 90% (a lower loan-to-value usually gets a lower rate), because the home’s value was not given.`,
      ...sourceOf(best.product),
    })
  }
  return { parts, notCounted }
}

function finish(
  parts: Part[],
  notCounted: NotCounted[],
  basis: string,
  held: string | null,
): MoneyFound {
  const annual = whole(parts.reduce((sum, part) => sum + part.annualEur, 0))
  const pieces = parts.map(
    (part) =>
      `${part.label.charAt(0).toLowerCase()}${part.label.slice(1)}, ${euro(part.annualEur)}`,
  )
  const headline =
    parts.length === 0
      ? notCounted.length === 0
        ? 'No money found that the figures given support.'
        : 'No money found that the figures given support yet; see what is not counted.'
      : `Money found: about ${euro(annual)} a year after DIRT (${pieces.join('; ')}).`
  return {
    annualEur: annual,
    headline: held === null ? headline : `${headline} ${held}`,
    parts,
    notCounted,
    basis,
  }
}

const BASIS =
  'A year’s figures, after DIRT at 33%: idle cash against the best confirmed instant-access rate (only where its current rate was given), debt interest not paid in the next twelve months less what the same money would earn, and a mortgage switch’s lower repayment. Bonuses, cashback and rates resting on CCPC’s one figure are not counted.'

/** For a review: what the situation as given could find, before any plan. */
export function moneyFoundForReview(market: Market, given: Situation, asOf: AsOf): MoneyFound {
  const { situation, basis: heldBasis, short: heldShort } = withHeldRates(market, given)
  const parts: Part[] = []
  const notCounted: NotCounted[] = []
  const pool = situation.savings.filter(ACCESSIBLE).map((item) => ({ item, left: item.balance }))
  const total = pool.reduce((sum, slot) => sum + slot.left, 0)
  const best = bestInstant(market, total, asOf)
  const confirmed = best.confirmed
  const bestNetPct = confirmed === null ? 0 : confirmed.figures.netRatePct

  // Debts first: the money that clears them is not also counted as idle.
  const debts = situation.debts
    .filter(
      (debt) => debt.kind !== 'mortgage' && debt.ratePct !== undefined && debt.ratePct > bestNetPct,
    )
    .sort((a, b) => (b.ratePct ?? 0) - (a.ratePct ?? 0))
  for (const debt of debts) {
    let amount = 0
    for (const slot of pool) {
      const take = Math.min(slot.left, debt.balance - amount)
      slot.left -= take
      amount += take
    }
    if (amount <= 0) continue
    const avoided = interestNextYear(debt, amount)
    const forgone = confirmed === null ? 0 : netOn(confirmed, amount)
    const found = avoided - forgone
    if (found <= 0) continue
    parts.push({
      kind: 'debt_interest',
      label: `${debt.label} cleared from savings`,
      annualEur: whole(found),
      detail: `${euro(round2(amount))} of savings against ${euro(debt.balance)} at ${String(debt.ratePct)}%: ${euro(round2(avoided))} of interest not paid in the next twelve months, less ${euro(round2(forgone))} the same money would earn after DIRT${confirmed === null ? '' : ` in ${displayName(confirmed.product)}`}.`,
      ...(confirmed === null
        ? { source: 'the customer’s figures', sourceUrl: null, checkedAt: null }
        : sourceOf(confirmed.product)),
    })
  }

  // Idle cash that is left.
  for (const { item, left } of pool) {
    if (left <= 0) continue
    if (item.aerPct === undefined) {
      const could = confirmed === null ? null : whole(netOn(confirmed, left))
      notCounted.push({
        label: `${euro(left)} in ${item.label}`,
        annualEur: could,
        why: `Its current rate was not given, so it is not counted.${confirmed === null || could === null ? '' : ` If it earns nothing now, ${displayName(confirmed.product)} would pay about ${euro(could)} a year after DIRT on it (a confirmed rate, with access kept).`}`,
      })
      continue
    }
    const now = left * (item.aerPct / 100) * (1 - DIRT_RATE)
    if (confirmed !== null) {
      const gain = netOn(confirmed, left) - now
      if (gain > 0.5) {
        parts.push({
          kind: 'idle_cash',
          label: `${item.label}: ${euro(left)} moved to ${displayName(confirmed.product)}`,
          annualEur: whole(gain),
          detail: `${euro(round2(netOn(confirmed, left)))} a year after DIRT in ${displayName(confirmed.product)}, against ${euro(round2(now))} at ${String(item.aerPct)}% now, with access kept.`,
          ...sourceOf(confirmed.product),
        })
      }
    }
    if (best.any !== null && best.any !== confirmed) {
      const more =
        netOn(best.any, left) - Math.max(now, confirmed === null ? 0 : netOn(confirmed, left))
      if (more > 0.5) {
        notCounted.push({
          label: `${item.label}: ${displayName(best.any.product)}`,
          annualEur: whole(more),
          why: `${euro(whole(more))} a year more at ${displayName(best.any.product)}’s rate, but that rate rests on CCPC’s one figure: the provider may pay it only for a period or on part of the balance.`,
        })
      }
    }
  }

  const mortgage = mortgageParts(market, situation)
  return finish(
    [...parts, ...mortgage.parts],
    [...notCounted, ...mortgage.notCounted],
    [BASIS, ...heldBasis].join(' '),
    heldShort,
  )
}

/** For a plan: only what the plan's own figures support. */
export function moneyFoundForPlan(
  market: Market,
  given: Situation,
  input: {
    readonly horizonMonths: number
    /** Lump sums the plan places, with their twelve-month net interest. */
    readonly lumps: readonly { product: ProductView; amount: number; netInterest12: number }[]
    /** Debts the plan clears, with the net position each way at the horizon. */
    readonly cleared: readonly { label: string; keptNet: number; clearedNet: number }[]
    /** Debts that could not be worked out both ways (no repayment or months left given). */
    readonly uncompared?: readonly { label: string; balance: number; ratePct: number }[]
  },
): MoneyFound {
  const { situation, basis: heldBasis, short: heldShort } = withHeldRates(market, given)
  const parts: Part[] = []
  const notCounted: NotCounted[] = []
  const accessible = situation.savings.filter(ACCESSIBLE)
  // "What the money earns now", in words: a current account says so, with its rate.
  const allCurrent = accessible.length > 0 && accessible.every(isCurrentAccount)
  const total = accessible.reduce((sum, item) => sum + item.balance, 0)
  const known = accessible.filter((item) => item.aerPct !== undefined)
  const knownBalance = known.reduce((sum, item) => sum + item.balance, 0)
  const knownNetPct =
    knownBalance > 0
      ? (known.reduce((sum, item) => sum + item.balance * (item.aerPct ?? 0), 0) / knownBalance) *
        (1 - DIRT_RATE)
      : 0
  const knownShare = total > 0 ? knownBalance / total : 0

  const years = Math.max(1, input.horizonMonths) / 12
  for (const debt of input.cleared) {
    const perYear = (debt.clearedNet - debt.keptNet) / years
    if (perYear <= 0.5) continue
    parts.push({
      kind: 'debt_interest',
      label: `${debt.label} cleared in this plan`,
      annualEur: whole(perYear),
      detail: `The plan with it cleared ends ${euro(round2(debt.clearedNet - debt.keptNet))} better off (savings less debt) after ${String(input.horizonMonths)} months than with it kept: about ${euro(whole(perYear))} a year.`,
      source: 'the customer’s figures and the plan’s products',
      sourceUrl: null,
      checkedAt: null,
    })
  }

  for (const lump of input.lumps) {
    const now = (lump.amount * knownNetPct) / 100
    const name = displayName(lump.product)
    const gain = (lump.netInterest12 - now) * knownShare
    const unknownPart = lump.netInterest12 * (1 - knownShare)
    if (!lump.product.rateConfirmed) {
      notCounted.push({
        label: `${euro(lump.amount)} in ${name}`,
        annualEur: whole(lump.netInterest12 - now * knownShare),
        why: 'Its rate rests on CCPC’s one figure: the provider may pay it only for a period or on part of the balance, so it is not counted.',
      })
      continue
    }
    if (gain > 0.5) {
      parts.push({
        kind: 'idle_cash',
        label: `${euro(lump.amount)} in ${name}`,
        annualEur: whole(gain),
        detail: `${euro(round2(lump.netInterest12))} a year after DIRT in ${name}, against what the money earns now (${allCurrent && knownNetPct === 0 ? '0% in a current account' : `${knownNetPct.toFixed(2)}% after DIRT`})${knownShare < 1 ? `, on the ${Math.round(knownShare * 100)}% of savings whose rate was given` : ''}.`,
        ...sourceOf(lump.product),
      })
    }
    if (unknownPart > 0.5) {
      notCounted.push({
        label: `${euro(round2(lump.amount * (1 - knownShare)))} in ${name}`,
        annualEur: whole(unknownPart),
        why: 'What this money earns now was not given, so the gain is not counted. The figure is what it would earn if it earns nothing now.',
      })
    }
  }

  for (const debt of input.uncompared ?? []) {
    notCounted.push({
      label: `${debt.label} cleared from savings`,
      annualEur: null,
      why: `At ${String(debt.ratePct)}% on ${euro(debt.balance)} it costs about ${euro(whole((debt.balance * debt.ratePct) / 100))} a year in interest, but its monthly repayment and months left were not given, so clearing it is not worked out or counted.`,
    })
  }

  const mortgage = mortgageParts(market, situation)
  return finish(
    [...parts, ...mortgage.parts],
    [...notCounted, ...mortgage.notCounted],
    [
      `${BASIS} In a plan, debt figures are the plan’s own net positions, spread over its ${String(input.horizonMonths)} months.`,
      ...heldBasis,
    ].join(' '),
    heldShort,
  )
}
