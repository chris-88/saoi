import { z } from 'zod'
import type { Db } from './case-repository.ts'
import type { LoadedLinkedAccount, LoadedTransfer } from './loaded-case.ts'

/**
 * The open banking rows, read for a turn (§6, §53).
 *
 * Only accounts under a consent that stands: a revoked consent takes the accounts and their
 * transactions out of everything downstream at once, which is what revoking means. The rows
 * stay in the table, so the inspector can still say what was linked and when it was let go.
 */

const accountRow = z.object({
  id: z.uuid(),
  bank: z.string(),
  display_name: z.string(),
  account_type: z.enum(['current', 'savings']),
  iban: z.string(),
  // Postgres numeric comes back as a number through PostgREST, and as a string through some
  // paths; both are coerced rather than trusted.
  balance: z.coerce.number(),
  consent_scope: z.array(z.string()),
  consent_expires_at: z.string(),
  created_at: z.string(),
})

const transactionRow = z.object({
  account_id: z.uuid(),
  booked_on: z.string(),
  amount: z.coerce.number(),
  description: z.string(),
  category: z.string(),
})

const transferRow = z.object({
  id: z.uuid(),
  from_account_id: z.uuid(),
  to_application_id: z.uuid().nullable(),
  to_label: z.string(),
  amount: z.coerce.number(),
  cadence: z.enum(['once', 'monthly']),
  state: z.enum(['initiated', 'settled', 'failed']),
  created_at: z.string(),
})

export async function loadLinkedAccounts(
  client: Db,
  caseId: string,
): Promise<readonly LoadedLinkedAccount[]> {
  const accountsResult = await client
    .from('linked_accounts')
    .select(
      'id, bank, display_name, account_type, iban, balance, consent_scope, consent_expires_at, created_at',
    )
    .eq('case_id', caseId)
    .is('revoked_at', null)
    .order('created_at', { ascending: true })

  if (accountsResult.error) {
    throw new Error(`Failed to load linked accounts: ${accountsResult.error.message}`)
  }
  const accounts = accountRow.array().parse(accountsResult.data)
  if (accounts.length === 0) return []

  const transactionsResult = await client
    .from('linked_transactions')
    .select('account_id, booked_on, amount, description, category')
    .in(
      'account_id',
      accounts.map((account) => account.id),
    )
    .order('booked_on', { ascending: false })

  if (transactionsResult.error) {
    throw new Error(`Failed to load linked transactions: ${transactionsResult.error.message}`)
  }
  const transactions = transactionRow.array().parse(transactionsResult.data)

  return accounts.map((account) => ({
    id: account.id,
    bank: account.bank,
    displayName: account.display_name,
    accountType: account.account_type,
    iban: account.iban,
    balance: account.balance,
    consentScope: account.consent_scope,
    consentExpiresAt: account.consent_expires_at,
    createdAt: account.created_at,
    transactions: transactions
      .filter((transaction) => transaction.account_id === account.id)
      .map((transaction) => ({
        bookedOn: transaction.booked_on,
        amount: transaction.amount,
        description: transaction.description,
        category: transaction.category,
      })),
  }))
}

export async function loadTransfers(
  client: Db,
  caseId: string,
): Promise<readonly LoadedTransfer[]> {
  const result = await client
    .from('transfers')
    .select('id, from_account_id, to_application_id, to_label, amount, cadence, state, created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true })

  if (result.error) throw new Error(`Failed to load transfers: ${result.error.message}`)

  return transferRow
    .array()
    .parse(result.data)
    .map((row) => ({
      id: row.id,
      fromAccountId: row.from_account_id,
      toApplicationId: row.to_application_id,
      toLabel: row.to_label,
      amount: row.amount,
      cadence: row.cadence,
      state: row.state,
      createdAt: row.created_at,
    }))
}
