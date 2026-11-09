import type {
  CreditCardTerms,
  LoanFigures,
  MortgageFigures,
  MortgageTerms,
  ProductView,
} from '../../contracts/market-tools.ts'
import { annuityPayment, round2 } from './simulate.ts'

/**
 * The arithmetic of borrowing, on published rates.
 *
 * Mortgages: a mortgage rate is a nominal annual rate, so a month is a twelfth of it. The fixed
 * period is costed at the initial rate; after it, the balance left is re-amortised at the
 * provider's stated follow-on rate over the rest of the term, which is an assumption the result
 * states (the follow-on rate is "potential"). Where there is no follow-on rate, there is no
 * whole-term figure.
 *
 * Loans and debts: an APR is an effective annual rate, so a month is its twelfth root. No fees
 * are added: CCPC states set-up fees as words.
 */

/** The monthly rate an effective annual rate (APR) compounds to. */
export const monthlyOfApr = (aprPct: number): number => Math.pow(1 + aprPct / 100, 1 / 12) - 1

/** The balance left after `paid` payments of `payment` at monthly rate `r`. */
export function balanceAfter(principal: number, r: number, payment: number, paid: number): number {
  if (r === 0) return Math.max(0, principal - payment * paid)
  const grown = principal * Math.pow(1 + r, paid)
  return Math.max(0, grown - (payment * (Math.pow(1 + r, paid) - 1)) / r)
}

export function mortgageFigures(
  terms: MortgageTerms,
  loanAmount: number,
  termYears: number,
  ltvPct: number | null,
): MortgageFigures {
  const months = termYears * 12
  const r = terms.initialRatePct / 100 / 12
  const monthly = annuityPayment(loanAmount, r, months)
  const fixedMonths =
    terms.rateType === 'fixed' && terms.fixedYears !== null
      ? Math.min(months, terms.fixedYears * 12)
      : null
  const cashbackEur =
    terms.cashback.pct === null ? null : round2((loanAmount * terms.cashback.pct) / 100)

  let monthlyAfterFixed: number | null = null
  let paidDuringFixed: number | null = null
  let totalRepaid: number | null = null

  if (fixedMonths === null) {
    // Variable: the rate as published, held. An assumption the caller states.
    totalRepaid = monthly * months
  } else {
    paidDuringFixed = monthly * fixedMonths
    const left = months - fixedMonths
    if (left === 0) totalRepaid = paidDuringFixed
    else if (terms.followOnRatePct !== null) {
      const rest = balanceAfter(loanAmount, r, monthly, fixedMonths)
      monthlyAfterFixed = annuityPayment(rest, terms.followOnRatePct / 100 / 12, left)
      totalRepaid = paidDuringFixed + monthlyAfterFixed * left
    }
  }

  return {
    kind: 'mortgage',
    loanAmount: round2(loanAmount),
    ltvPct: ltvPct === null ? null : round2(ltvPct),
    termYears,
    monthlyRepayment: round2(monthly),
    monthlyAfterFixed: monthlyAfterFixed === null ? null : round2(monthlyAfterFixed),
    paidDuringFixed: paidDuringFixed === null ? null : round2(paidDuringFixed),
    totalRepaid: totalRepaid === null ? null : round2(totalRepaid),
    cashbackEur,
    totalCostAfterCashback:
      totalRepaid === null ? null : round2(totalRepaid - loanAmount - (cashbackEur ?? 0)),
  }
}

export function loanFigures(aprPct: number, amount: number, termMonths: number): LoanFigures {
  const monthly = annuityPayment(amount, monthlyOfApr(aprPct), termMonths)
  const total = monthly * termMonths
  return {
    kind: 'loan',
    amount: round2(amount),
    termMonths,
    monthlyRepayment: round2(monthly),
    totalRepaid: round2(total),
    totalInterest: round2(total - amount),
  }
}

/**
 * Interest on a card balance held for twelve months with nothing repaid: the balance-transfer
 * rate for its introductory months, the purchase rate after. Simple monthly interest; null where
 * the purchase rate is not stated.
 */
export function cardInterestOver12Months(terms: CreditCardTerms, balance: number): number | null {
  if (terms.purchaseRatePct === null) return null
  let interest = 0
  for (let month = 1; month <= 12; month += 1) {
    const rate =
      terms.balanceTransfer !== null && month <= terms.balanceTransfer.introMonths
        ? terms.balanceTransfer.introPct
        : terms.purchaseRatePct
    interest += (balance * rate) / 100 / 12
  }
  return round2(interest)
}

/** A loan's months to clear at a payment, or null when the payment never clears it. */
export function monthsToClear(
  balance: number,
  monthlyRate: number,
  payment: number,
): number | null {
  if (balance <= 0) return 0
  if (payment <= 0) return null
  if (monthlyRate === 0) return Math.ceil(balance / payment)
  if (payment <= balance * monthlyRate) return null
  return Math.ceil(-Math.log(1 - (balance * monthlyRate) / payment) / Math.log(1 + monthlyRate))
}

/** Interest still to pay on a debt cleared at a payment. Null when it never clears. */
export function interestToClear(
  balance: number,
  monthlyRate: number,
  payment: number,
): number | null {
  const months = monthsToClear(balance, monthlyRate, payment)
  if (months === null) return null
  let left = balance
  let interest = 0
  for (let month = 0; month < months && left > 0; month += 1) {
    const charge = left * monthlyRate
    interest += charge
    left = left + charge - payment
  }
  return round2(interest)
}

/** The oldest `checkedAt` of the products shown: how fresh the stalest figure is. */
export function oldestCheck(products: readonly ProductView[]): string | null {
  return [...products.map((product) => product.provenance.checkedAt)].sort()[0] ?? null
}

export function attributionsOf(products: readonly ProductView[]): string[] {
  return [
    ...new Set(
      products.flatMap((product) =>
        product.provenance.attribution === null ? [] : [product.provenance.attribution],
      ),
    ),
  ]
}

export const euro = (value: number): string =>
  `€${value.toLocaleString('en-IE', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`

/** "bunq Free", not "bunq bunq Free". */
export function displayName(product: ProductView): string {
  return product.name.toLowerCase().startsWith(product.providerName.toLowerCase())
    ? product.name
    : `${product.providerName} ${product.name}`
}
