import type { FactReader, Product } from '../journey.ts'
import type { ProductVariant } from './types.ts'
import { repaymentFor, totalPaid } from './maths.ts'

/**
 * Whether the thing they asked for is the thing that suits them.
 *
 * A customer arrives asking for a personal loan because a personal loan is the product they have
 * heard of. Whether it fits depends on two things they have not been asked: what the money is
 * for, and how soon they mean to be rid of it. Somebody clearing €3,000 by Christmas wants
 * something with no term attached; the same €3,000 over four years wants the opposite.
 *
 * Deterministic, like every other judgement in this system. The rule decides whether there is a
 * better fit and works out what the difference costs; Saoirse decides how to say it. A model asked
 * to notice this on its own would notice it sometimes.
 */

export type SuitabilityContext = {
  readonly facts: FactReader
  /** Variants by product, so the comparison runs on the same figures the quote card showed. */
  readonly variants: Readonly<Partial<Record<Product, readonly ProductVariant[] | undefined>>>
}

export type Suggestion = {
  readonly id: string
  /** What they came in asking about. */
  readonly from: Product
  /** What may suit better. */
  readonly to: Product
  /** In the customer's terms, with the figure where there is one. */
  readonly because: string
  /** Never "instead of": the customer decides, and both may be reasonable. */
  readonly strength: 'worth_raising' | 'clearly_better'
}

const euro = (amount: number): string => `€${Math.round(amount).toLocaleString('en-IE')}`

/** The cheapest rate a product offers, which is the fairest way to compare two of them. */
function bestRate(variants: readonly ProductVariant[] | undefined): number | null {
  if (variants === undefined || variants.length === 0) return null
  return Math.min(...variants.map((variant) => variant.annualRate))
}

/**
 * What else is worth putting in front of them, given what they have actually said.
 *
 * Returns nothing when the case cannot answer the question — no amount, or no sense of how long.
 * Guessing which product suits somebody from an amount alone is how cross-selling works, and
 * saying nothing is the right answer until they have said enough.
 */
export function suggestionsFor(
  considering: Product,
  context: SuitabilityContext,
): readonly Suggestion[] {
  const amount = context.facts.number('borrowing.requestedAmount', 'household')
  const horizon = context.facts.number('borrowing.repaymentMonths', 'household')

  if (amount === null || amount <= 0) return []
  if (horizon === null || horizon <= 0) return []

  const suggestions: Suggestion[] = []

  const loanRate = bestRate(context.variants.personal_loan)
  const cardRate = bestRate(context.variants.credit_card)

  /**
   * A loan they mean to clear in months, not years.
   *
   * The loan is cheaper per euro and that is not the point: it commits them to a term and to a
   * break cost for leaving it early. For a few months' borrowing the flexibility is worth more
   * than the rate, and the interest difference is small enough to say out loud.
   */
  if (considering === 'personal_loan' && horizon <= 9 && cardRate !== null && loanRate !== null) {
    const onCard = interestOver(amount, cardRate, horizon)
    const onLoan = interestOver(amount, loanRate, horizon)
    const difference = Math.abs(onCard - onLoan)

    suggestions.push({
      id: 'loan_short_horizon',
      from: 'personal_loan',
      to: 'credit_card',
      because:
        `They expect to clear ${euro(amount)} within ${describeMonths(horizon)}. A loan ties ` +
        `them to a term; a card does not. Over that time the card costs about ${euro(difference)} ` +
        `more in interest, which is the trade for being able to clear it whenever they like.`,
      strength: 'worth_raising',
    })
  }

  /**
   * A card balance they will be carrying for years.
   *
   * The other direction, and a much bigger number: at a card's rate against a loan's, the
   * difference over two or three years is most of a holiday.
   */
  if (considering === 'credit_card' && horizon >= 18 && cardRate !== null && loanRate !== null) {
    const onCard = interestOver(amount, cardRate, horizon)
    const onLoan = interestOver(amount, loanRate, horizon)

    if (onCard - onLoan > 100) {
      suggestions.push({
        id: 'card_long_horizon',
        from: 'credit_card',
        to: 'personal_loan',
        because:
          `Carrying ${euro(amount)} for ${describeMonths(horizon)} on a card costs about ` +
          `${euro(onCard - onLoan)} more in interest than a loan over the same time, and the ` +
          `loan has a date it ends on.`,
        strength: 'clearly_better',
      })
    }
  }

  /**
   * Borrowing that is not really borrowing.
   *
   * Somebody with the money sitting in savings is about to pay interest to keep a balance they
   * already have. Worth saying once — there are good reasons to keep a reserve intact, and that
   * is their call, not the bank's.
   */
  const savings = context.facts.number('assets.savingsBalance', 'household')
  if (
    (considering === 'personal_loan' || considering === 'credit_card') &&
    savings !== null &&
    savings >= amount * 2
  ) {
    suggestions.push({
      id: 'already_has_it',
      from: considering,
      to: 'savings',
      because:
        `They hold ${euro(savings)} in savings against borrowing ${euro(amount)}. Worth asking ` +
        'once whether they would rather use some of it — keeping a reserve intact is a good ' +
        'reason not to, and that is their decision.',
      strength: 'worth_raising',
    })
  }

  return suggestions
}

/** Interest paid clearing an amount over a number of months at a rate. */
function interestOver(amount: number, annualRate: number, months: number): number {
  const payment = repaymentFor(amount, annualRate, months)
  return totalPaid(payment, months) - amount
}

function describeMonths(months: number): string {
  if (months < 12) return `${String(months)} months`
  const whole = Math.round(months / 12)
  return `${String(whole)} ${whole === 1 ? 'year' : 'years'}`
}
