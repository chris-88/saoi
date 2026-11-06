import { describe, expect, it } from 'vitest'
import { loadedCase } from '../../testing.actions.ts'
import { CASE, toolContext } from './_testing.ts'
import { showAccountsTool } from './show-accounts.ts'

describe('show_accounts', () => {
  it('shows the overview read from the linked accounts', async () => {
    const loaded = loadedCase(CASE, {
      linkedAccounts: [
        {
          id: 'linked-1',
          bank: 'aib',
          displayName: 'Current account',
          accountType: 'current',
          iban: 'IE29AIBK93115212345678',
          balance: 1200,
          transactions: [],
        },
      ] as never,
    })

    const outcome = await showAccountsTool.run({}, toolContext({ loaded }))

    expect(outcome.refused).toBeUndefined()
    expect(outcome.card).toMatchObject({ type: 'accounts_overview' })
  })

  it('refuses while nothing is linked', async () => {
    const outcome = await showAccountsTool.run({}, toolContext())

    expect(outcome.refused).toBe(true)
    expect(outcome.card).toBeUndefined()
  })
})
