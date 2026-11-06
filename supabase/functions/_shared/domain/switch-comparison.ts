import { monthlyRepayment } from './mortgage.ts'

/**
 * What a switch is worth, over the period the customer can actually compare.
 *
 * Case eb37e9b5: a customer with €300,000 over twenty years, offered 4% to stay, asked three
 * times to have that set against the bank's two-year fixed with €6,000 cashback, and was told
 * each time to take the repayments and subtract the cashback himself. The arithmetic is not
 * the model's to do and it is not the customer's either.
 *
 * The comparison runs over the candidate's fixed period, because that is the only period on
 * which either rate is known. A whole-term figure would be inventing the other eighteen years.
 * Costs are listed beside the result and never subtracted from it: the published ones are
 * ranges and "agreed with your solicitor", and a net figure built on a guess would be the
 * plausible number this whole codebase exists to avoid.
 */

export type RateToCompare = {
  readonly label: string
  readonly ratePct: number
  /** Cashback the rate pays, in euro, where it pays any. */
  readonly cashbackEur: number | null
  /** How long the rate is fixed for, where it is. */
  readonly fixedYears: number | null
}

export type SwitchComparisonRow = {
  readonly optionId: string
  readonly monthlyEur: number
  /** Positive when the candidate is cheaper each month than the rate compared against. */
  readonly monthlyDifferenceEur: number
  readonly overYears: number
  /** Monthly difference times the months in the period. */
  readonly repaymentDifferenceEur: number
  /** Candidate cashback less any cashback the other rate pays. */
  readonly cashbackDifferenceEur: number
  /** The two differences together. Before the costs of switching, which are listed, not deducted. */
  readonly netBeforeCostsEur: number
}

export type SwitchComparison = {
  readonly against: {
    readonly label: string
    readonly ratePct: number
    readonly monthlyEur: number
  }
  readonly rows: readonly SwitchComparisonRow[]
}

/**
 * The period to compare over: the candidate's fixed years, else the other rate's, else one
 * year, and never longer than the term.
 */
export function comparisonYears(
  candidate: Pick<RateToCompare, 'fixedYears'>,
  against: Pick<RateToCompare, 'fixedYears'>,
  termYears: number,
): number {
  const years = candidate.fixedYears ?? against.fixedYears ?? 1
  return Math.max(1, Math.min(years, termYears))
}

export function compareSwitch(input: {
  readonly balanceEur: number
  readonly termYears: number
  readonly against: RateToCompare
  readonly candidates: readonly (RateToCompare & { readonly id: string })[]
}): SwitchComparison {
  const againstMonthly = Math.round(
    monthlyRepayment(input.balanceEur, input.against.ratePct, input.termYears),
  )

  const rows = input.candidates.map((candidate): SwitchComparisonRow => {
    const monthlyEur = Math.round(
      monthlyRepayment(input.balanceEur, candidate.ratePct, input.termYears),
    )
    const overYears = comparisonYears(candidate, input.against, input.termYears)
    const monthlyDifferenceEur = againstMonthly - monthlyEur
    const repaymentDifferenceEur = monthlyDifferenceEur * overYears * 12
    const cashbackDifferenceEur = (candidate.cashbackEur ?? 0) - (input.against.cashbackEur ?? 0)

    return {
      optionId: candidate.id,
      monthlyEur,
      monthlyDifferenceEur,
      overYears,
      repaymentDifferenceEur,
      cashbackDifferenceEur,
      netBeforeCostsEur: repaymentDifferenceEur + cashbackDifferenceEur,
    }
  })

  return {
    against: {
      label: input.against.label,
      ratePct: input.against.ratePct,
      monthlyEur: againstMonthly,
    },
    rows,
  }
}
