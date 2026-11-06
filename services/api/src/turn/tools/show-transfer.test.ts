import { describe, expect, it } from 'vitest'
import { APP_ID, application, loadedCase } from '../../testing.actions.ts'
import { CASE, toolContext } from './_testing.ts'
import { showTransferTool } from './show-transfer.ts'

const linked = (balance: number) =>
  ({
    id: 'linked-1',
    bank: 'AIB',
    displayName: 'Savings',
    accountType: 'savings',
    iban: 'IE29AIBK93115212345678',
    balance,
    transactions: [],
  }) as never

describe('show_transfer', () => {
  it('offers to move what the linked account holds into the application', async () => {
    const loaded = loadedCase(CASE, {
      applications: [application('savings', 'waiting_customer')],
      linkedAccounts: [linked(12_000)],
    })

    const outcome = await showTransferTool.run(
      { applicationId: APP_ID, cadence: 'once' },
      toolContext({ loaded }),
    )

    expect(outcome.refused).toBeUndefined()
    expect(outcome.card).toMatchObject({
      type: 'transfer',
      fromAccountId: 'linked-1',
      toApplicationId: APP_ID,
      amount: 12_000,
      cadence: 'once',
    })
  })

  it('refuses a transfer to an application that does not exist', async () => {
    const outcome = await showTransferTool.run({ applicationId: APP_ID }, toolContext())

    expect(outcome.refused).toBe(true)
    expect(outcome.card).toBeUndefined()
  })

  it('refuses when nothing is linked to move from', async () => {
    const loaded = loadedCase(CASE, { applications: [application('savings', 'waiting_customer')] })

    const outcome = await showTransferTool.run({ applicationId: APP_ID }, toolContext({ loaded }))

    expect(outcome.result).toMatch(/Nothing is linked/)
    expect(outcome.refused).toBe(true)
  })
})
