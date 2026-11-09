import type { Debt, DebtRequest, DebtResponse, ProductView } from '../../contracts/market-tools.ts'
import {
  attributionsOf,
  cardInterestOver12Months,
  euro,
  interestToClear,
  loanFigures,
  monthlyOfApr,
  monthsToClear,
  oldestCheck,
  displayName,
} from './figures.ts'
import { flagsOf, loanCandidates, savingsCandidates } from './search.ts'
import { annuityPayment, round2 } from './simulate.ts'
import type { AsOf, Market } from './types.ts'

/**
 * What each debt costs, the order that saves the most interest, overpaying against saving the
 * same money, and what the market charges to refinance. Nothing is arranged.
 */

type RefinanceOption = DebtResponse['refinance'][number]['options'][number]

const DEBT_ASSUMPTIONS = [
  'A debt’s rate is read as an APR (an effective annual rate); a mortgage rate as a nominal annual rate.',
  'Repayments are level; where only the months remaining are given, the repayment is worked out from the balance and rate.',
  'Fees and charges are not added.',
]

/** The monthly rate of a debt: a mortgage's nominal rate, anything else's APR. */
export function debtMonthlyRate(debt: Debt): number | null {
  if (debt.ratePct === undefined) return null
  return debt.kind === 'mortgage' ? debt.ratePct / 100 / 12 : monthlyOfApr(debt.ratePct)
}

/** The repayment: as given, or the level payment that clears the balance in the months given. */
export function repaymentOf(debt: Debt): number | null {
  if (debt.monthlyRepayment !== undefined) return debt.monthlyRepayment
  const r = debtMonthlyRate(debt)
  if (r === null || debt.monthsRemaining === undefined) return null
  return annuityPayment(debt.balance, r, debt.monthsRemaining)
}

export function costOf(debt: Debt): DebtResponse['costs'][number] {
  const r = debtMonthlyRate(debt)
  const payment = repaymentOf(debt)
  const notes: string[] = []
  if (r === null) notes.push('No rate given: the cost cannot be worked out.')
  if (payment === null && r !== null) {
    notes.push(
      'No repayment or months remaining given: the interest still to pay cannot be worked out.',
    )
  }
  const months = r === null || payment === null ? null : monthsToClear(debt.balance, r, payment)
  if (r !== null && payment !== null && months === null) {
    notes.push(
      `${euro(round2(payment))} a month does not cover the interest: at this rate the balance never clears.`,
    )
  }
  return {
    debtId: debt.id,
    label: debt.label,
    ratePct: debt.ratePct ?? null,
    monthlyRepayment: payment === null ? null : round2(payment),
    monthsToClear: months,
    interestRemaining:
      r === null || payment === null ? null : interestToClear(debt.balance, r, payment),
    annualInterestNow:
      debt.ratePct === undefined ? null : round2((debt.balance * debt.ratePct) / 100),
    notes,
  }
}

/** Highest rate first; a rate not given goes last. */
export function payoffOrder(debts: readonly Debt[]): DebtResponse['payoffOrder'] {
  return [...debts]
    .sort(
      (a, b) =>
        (b.ratePct ?? -1) - (a.ratePct ?? -1) || a.balance - b.balance || a.id.localeCompare(b.id),
    )
    .map((debt) => ({
      debtId: debt.id,
      why:
        debt.ratePct === undefined
          ? 'No rate given, so where it falls in the order is not known.'
          : `${String(debt.ratePct)}% a year: each euro repaid early here saves ${String(debt.ratePct)} cent a year in interest.`,
    }))
}

export function debts(market: Market, request: DebtRequest, asOf: AsOf): DebtResponse {
  const costs = request.debts.map(costOf)
  const order = payoffOrder(request.debts)
  const assumptions = [...DEBT_ASSUMPTIONS]
  const shown: ProductView[] = []

  // ---- Overpay versus save, on the debt at the top of the order --------------------------
  const overpayVersusSave: DebtResponse['overpayVersusSave'] = []
  const top = request.debts.find((debt) => debt.id === order[0]?.debtId)
  const topRate = top === undefined ? null : debtMonthlyRate(top)
  const topPayment = top === undefined ? null : repaymentOf(top)
  if (top !== undefined && topRate !== null && topPayment !== null) {
    const baseline = interestToClear(top.balance, topRate, topPayment)
    const horizon = Math.min(480, monthsToClear(top.balance, topRate, topPayment) ?? 12)
    const compare = (amount: number, cadence: 'monthly' | 'once') => {
      const withStep =
        cadence === 'monthly'
          ? interestToClear(top.balance, topRate, topPayment + amount)
          : interestToClear(Math.max(0, top.balance - amount), topRate, topPayment)
      const saved = baseline === null || withStep === null ? 0 : round2(baseline - withStep)
      const savings = savingsCandidates(
        market.products,
        {
          category: cadence === 'monthly' ? 'savings' : 'deposit',
          ...(cadence === 'monthly' ? { monthlyAmount: amount } : { amount }),
          horizonMonths: horizon,
        },
        asOf,
        { add: () => undefined },
        [],
      )
      const best = [...savings.candidates].sort(
        (a, b) =>
          (b.figures.kind === 'savings' ? b.figures.netInterest : 0) -
          (a.figures.kind === 'savings' ? a.figures.netInterest : 0),
      )[0]
      const net = best?.figures.kind === 'savings' ? best.figures.netInterest : 0
      if (best !== undefined) shown.push(best.product)
      overpayVersusSave.push({
        debtId: top.id,
        amount,
        cadence,
        horizonMonths: horizon,
        interestSavedByOverpaying: Math.max(0, saved),
        netInterestBySaving: net,
        savingProduct: best === undefined ? null : displayName(best.product),
        difference: round2(saved - net),
      })
    }
    if (request.extraMonthly !== undefined && request.extraMonthly > 0)
      compare(request.extraMonthly, 'monthly')
    if (request.lumpSum !== undefined && request.lumpSum > 0) {
      compare(Math.min(request.lumpSum, top.balance), 'once')
    }
    if (overpayVersusSave.length > 0) {
      assumptions.push(
        `Overpaying is compared with saving the same money over ${String(horizon)} months (the time the debt takes to clear now), in the savings product that earns the most after DIRT. The repayment freed when a debt clears early is not counted.`,
      )
    }
  }

  // ---- What the market charges to refinance ---------------------------------------------
  const refinance: DebtResponse['refinance'] = request.debts.flatMap(
    (debt): DebtResponse['refinance'] => {
      const cost = costs.find((c) => c.debtId === debt.id)
      if (debt.kind === 'mortgage') {
        return [
          {
            debtId: debt.id,
            options: [],
            note: 'For a mortgage, compare switcher rates with the mortgage switch calculation.',
          },
        ]
      }
      if (debt.kind === 'credit_card') {
        const options: RefinanceOption[] = market.products
          .flatMap((product): RefinanceOption[] => {
            if (product.terms.kind !== 'credit_card') return []
            const interest = cardInterestOver12Months(product.terms, debt.balance)
            const now =
              debt.ratePct === undefined ? null : round2((debt.balance * debt.ratePct) / 100)
            return [
              {
                product,
                figures: {
                  kind: 'credit_card' as const,
                  balance: debt.balance,
                  interestOver12Months: interest,
                },
                interestSaving: interest === null || now === null ? null : round2(now - interest),
                flags: flagsOf(product),
              },
            ]
          })
          .sort((a, b) => figureCost(a) - figureCost(b))
          .slice(0, 3)
        shown.push(...options.map((option) => option.product))
        return [
          {
            debtId: debt.id,
            options,
            note: 'Cards compared on twelve months’ interest on the balance with nothing repaid; the saving is against the current card’s rate for a year.',
          },
        ]
      }
      const termMonths = debt.monthsRemaining ?? cost?.monthsToClear ?? 60
      const found = loanCandidates(
        market.products,
        {
          amount: debt.balance,
          termMonths,
          ...(debt.kind === 'car_finance' ? { purpose: 'car' as const } : {}),
        },
        { add: () => undefined },
        [],
      )
      const options: RefinanceOption[] = [...found.candidates]
        .flatMap((candidate): RefinanceOption[] =>
          candidate.figures.kind === 'loan' && candidate.product.terms.kind === 'loan'
            ? [
                {
                  product: candidate.product,
                  figures: loanFigures(candidate.product.terms.aprPct, debt.balance, termMonths),
                  interestSaving:
                    cost?.interestRemaining === null || cost?.interestRemaining === undefined
                      ? null
                      : round2(cost.interestRemaining - candidate.figures.totalInterest),
                  flags: candidate.flags,
                },
              ]
            : [],
        )
        .sort((a, b) => figureCost(a) - figureCost(b))
        .slice(0, 3)
      shown.push(...options.map((option) => option.product))
      return [
        {
          debtId: debt.id,
          options,
          note: `Loans for ${euro(debt.balance)} over ${String(termMonths)} months, lowest total interest first. Lenders decide the rate offered; check eligibility.`,
        },
      ]
    },
  )

  return {
    costs,
    payoffOrder: order,
    overpayVersusSave,
    refinance,
    assumptions,
    dataCheckedAt: oldestCheck(shown),
    attributions: attributionsOf(shown),
  }
}

function figureCost(option: RefinanceOption): number {
  return option.figures.kind === 'loan'
    ? option.figures.totalInterest
    : (option.figures.interestOver12Months ?? Number.POSITIVE_INFINITY)
}
