import type { Card } from '@shared/contracts/cards.ts'
import { summariseAccounts } from '@shared/domain/open-banking/summarise.ts'
import { maskIban } from '@shared/domain/open-banking/synthesise.ts'
import type { ToolModule } from './_shared.ts'

export const showAccountsTool: ToolModule<'show_accounts'> = {
  name: 'show_accounts',
  run(_input, ctx) {
    const { loaded } = ctx

    if (loaded.linkedAccounts.length === 0) {
      return {
        result: 'Nothing is linked; offer show_connect_accounts instead.',
        refused: true,
      }
    }

    const today = new Date().toISOString().slice(0, 10)
    const summary = summariseAccounts(
      loaded.linkedAccounts,
      loaded.linkedAccounts.flatMap((account) => account.transactions),
      today,
    )

    const card: Card = {
      type: 'accounts_overview',
      asOf: today,
      accounts: loaded.linkedAccounts.map((account) => ({
        id: account.id,
        bank: account.bank,
        displayName: account.displayName,
        accountType: account.accountType,
        ibanMasked: maskIban(account.iban),
        balance: account.balance,
      })),
      month: summary.month,
      salary: summary.salary,
      regular: summary.regular.map((item) => ({
        label: item.label,
        amount: item.amount,
        cadence: item.cadence,
      })),
      savingsHeld: summary.savingsHeld,
    }

    return {
      result:
        'Overview shown, every figure read from the linked accounts. Say one line ' +
        'about what stands out for what they are doing, and quote no figure: they ' +
        'are on the card.',
      card,
    }
  },
}
