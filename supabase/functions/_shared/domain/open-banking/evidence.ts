import { daysBetween, recurring, type TransactionLike } from './recurring.ts'
import { detectSalary, type AccountLike } from './summarise.ts'

/**
 * What an assessment can take from linked accounts instead of asking for documents.
 *
 * A payslip evidences salary; three salary credits from the same employer evidence it at
 * least as well. A statement evidences rent; the standing order on the first of the month is
 * the statement. This is the reading, and only the reading: which requirement it satisfies,
 * and whether it is allowed to, is the requirement engine's decision. Null where the data
 * does not show it, never a figure carried over from what the customer said.
 */

export type AccountEvidence = {
  readonly salaryObserved: {
    readonly monthly: number
    readonly annualised: number
    readonly employer: string
    /** How many months' pay the statement shows. */
    readonly months: number
  } | null
  readonly rentObserved: { readonly monthly: number } | null
  readonly savingsObserved: number
  readonly daysOfHistory: number
}

export function accountEvidence(
  accounts: readonly AccountLike[],
  transactions: readonly TransactionLike[],
  today: string,
): AccountEvidence {
  const salary = detectSalary(transactions)

  const rent =
    recurring(transactions, 'debit').find(
      (item) => item.stable && item.cadence === 'monthly' && item.category === 'housing',
    ) ?? null

  const earliest = transactions.reduce<string | null>(
    (first, transaction) =>
      first === null || transaction.bookedOn < first ? transaction.bookedOn : first,
    null,
  )

  return {
    salaryObserved:
      salary === null
        ? null
        : {
            monthly: salary.amount,
            annualised: Math.round(salary.amount * 12 * 100) / 100,
            employer: salary.label,
            months: salary.count,
          },
    rentObserved: rent === null ? null : { monthly: rent.amount },
    savingsObserved:
      accounts
        .filter((account) => account.accountType === 'savings')
        .reduce((sum, account) => sum + Math.round(account.balance * 100), 0) / 100,
    daysOfHistory: earliest === null ? 0 : daysBetween(earliest, today) + 1,
  }
}
