import { recurring, type TransactionLike } from './recurring.ts'

/**
 * The overview card's numbers, read off linked accounts (§6, §53).
 *
 * Nothing here is the model's. The card is built on the server from these figures and the
 * model is told to quote none of them, so what the customer reads is what the rows say. This
 * month's money in and out are sums; the salary is the largest steady monthly credit; the
 * regular outgoings are the steady debits with a cadence; savings held is the balance of the
 * accounts that are savings. A statement with nothing regular on it gets a null salary and an
 * empty list, not a guess.
 */

export type AccountLike = {
  readonly accountType: 'current' | 'savings'
  readonly balance: number
}

export type AccountsSummary = {
  readonly month: { readonly moneyIn: number; readonly moneyOut: number }
  readonly salary: {
    readonly amount: number
    readonly employer: string
    readonly lastOn: string
  } | null
  readonly regular: readonly {
    readonly label: string
    readonly amount: number
    readonly cadence: string
  }[]
  readonly savingsHeld: number
}

export function summariseAccounts(
  accounts: readonly AccountLike[],
  transactions: readonly TransactionLike[],
  today: string,
): AccountsSummary {
  const month = today.slice(0, 7)
  let moneyIn = 0
  let moneyOut = 0
  for (const transaction of transactions) {
    if (!transaction.bookedOn.startsWith(month) || transaction.bookedOn > today) continue
    if (transaction.amount > 0) moneyIn += Math.round(transaction.amount * 100)
    else moneyOut += Math.round(-transaction.amount * 100)
  }

  const salary = detectSalary(transactions)

  const regular = recurring(transactions, 'debit')
    .filter((item) => item.stable && item.cadence !== 'irregular')
    .slice(0, 5)
    .map((item) => ({ label: item.label, amount: item.amount, cadence: item.cadence }))

  return {
    month: { moneyIn: moneyIn / 100, moneyOut: moneyOut / 100 },
    salary:
      salary === null
        ? null
        : { amount: salary.amount, employer: salary.label, lastOn: salary.lastOn },
    regular,
    savingsHeld:
      accounts
        .filter((account) => account.accountType === 'savings')
        .reduce((sum, account) => sum + Math.round(account.balance * 100), 0) / 100,
  }
}

/**
 * The largest steady credit arriving monthly. Two occurrences are enough: ninety days holds
 * three paydays at most, and a statement that started just after one holds two.
 */
export function detectSalary(transactions: readonly TransactionLike[]) {
  return (
    recurring(transactions, 'credit').find((item) => item.stable && item.cadence === 'monthly') ??
    null
  )
}
