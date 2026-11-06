import { describe, expect, it } from 'vitest'
import { loadedCase } from '../../testing.actions.ts'
import { CASE, toolContext } from './_testing.ts'
import { showConnectAccountsTool } from './show-connect-accounts.ts'

describe('show_connect_accounts', () => {
  it('draws the consent card with the banks, scope and expiry', async () => {
    const outcome = await showConnectAccountsTool.run(
      { why: 'To see what you save each month.' },
      toolContext(),
    )

    expect(outcome.card).toMatchObject({
      type: 'connect_accounts',
      why: 'To see what you save each month.',
      consentDays: 90,
    })
  })

  it('does not draw a second card while the first is still on screen', async () => {
    const loaded = loadedCase(CASE, {
      messages: [
        {
          role: 'assistant',
          content: '',
          cards: ['connect_accounts'],
          createdAt: '',
          timing: null,
        },
      ],
    })

    const outcome = await showConnectAccountsTool.run({ why: 'To see.' }, toolContext({ loaded }))

    expect(outcome.card).toBeUndefined()
    expect(outcome.result).toMatch(/already on screen/)
  })
})
