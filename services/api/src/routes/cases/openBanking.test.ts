import { describe, expect, it } from 'vitest'
import { CASE_ID, USER_ID } from '../../testing.ts'
import { APP_ID, LINKED_ID, MESSAGE_ID, loadedCase, writesOf } from '../../testing.actions.ts'
import { world } from './actions.fixture.ts'

describe('POST /linked-accounts', () => {
  it('links a bank under the scope consented to, generating its accounts', async () => {
    const { call, actions } = world()
    const got = await call('primary', '/linked-accounts', {
      bank: 'revolut',
      scope: ['balances', 'transactions'],
    })
    expect(got.status).toBe(201)
    expect(got.body).toMatchObject({
      summary: expect.stringMatching(
        /^Linked \d accounts? at Revolut\. Nexus will share balances and transactions for 90 days\.$/,
      ) as unknown,
    })

    const write = writesOf(actions)[0]
    expect(write?.name).toBe('saveLinkedAccounts')
    const args = write?.args as {
      bank: string
      scope: string[]
      prepared: { accounts: unknown[]; transactions: unknown[] }
      consentExpiresAt: string
    }
    expect(args.bank).toBe('revolut')
    expect(args.scope).toEqual(['balances', 'transactions'])
    expect(args.prepared.accounts.length).toBeGreaterThan(0)
    expect(args.prepared.transactions.length).toBeGreaterThan(0)
    // Ninety days, give or take the test's own clock.
    const days = (Date.parse(args.consentExpiresAt) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(89.9)
    expect(days).toBeLessThan(90.1)
  })

  it('linking the same bank twice is linking it once', async () => {
    const { call, actions } = world()
    const got = await call('primary', '/linked-accounts', { bank: 'aib', scope: ['balances'] })
    expect(got.body).toMatchObject({ summary: 'Your AIB accounts are already linked.' })
    expect(writesOf(actions)).toEqual([])
  })

  it.each([
    ['an unknown bank', { bank: 'monzo', scope: ['balances'] }],
    ['no scope', { bank: 'revolut', scope: [] }],
    ['an unknown scope', { bank: 'revolut', scope: ['everything'] }],
  ])('rejects %s', async (_name, body) => {
    const { call, actions } = world()
    expect((await call('primary', '/linked-accounts', body)).status).toBe(400)
    expect(actions.calls).toEqual([])
  })
})

describe('POST /linked-accounts/revoke', () => {
  it('marks what was linked as withdrawn', async () => {
    const { call, actions } = world()
    const got = await call('primary', '/linked-accounts/revoke')
    expect(got.body).toMatchObject({
      summary: 'Nexus access withdrawn. Nothing more will be read from those accounts.',
    })
    expect(writesOf(actions)).toEqual([
      { name: 'revokeLinkedAccounts', args: { caseId: CASE_ID, accounts: 1, banks: ['aib'] } },
    ])
  })

  it('says so when nothing is linked', async () => {
    const { call, actions } = world()
    actions.loaded = loadedCase(CASE_ID)
    const got = await call('primary', '/linked-accounts/revoke')
    expect(got.body).toMatchObject({ summary: 'Nothing is linked.' })
    expect(writesOf(actions)).toEqual([])
  })
})

describe('POST /transfers', () => {
  const body = {
    fromAccountId: LINKED_ID,
    toApplicationId: APP_ID,
    amount: 250,
    cadence: 'once',
  }
  const withAccount = (
    actions: ReturnType<typeof world>['actions'],
    over: Partial<NonNullable<typeof actions.loaded>['linkedAccounts'][number]>,
  ) => {
    const loaded = actions.loaded
    if (!loaded) throw new Error('no case')
    const [account] = loaded.linkedAccounts
    if (!account) throw new Error('no account')
    actions.loaded = { ...loaded, linkedAccounts: [{ ...account, ...over }] }
  }

  it('initiates a one-off and takes it off the linked balance', async () => {
    const { call, actions } = world()
    const got = await call('primary', '/transfers', body)
    expect(got.status).toBe(201)
    expect(got.body).toMatchObject({ summary: '€250 on its way from AIB to your current_account.' })
    expect(writesOf(actions)).toMatchObject([
      {
        name: 'saveTransfer',
        args: {
          caseId: CASE_ID,
          fromAccountId: LINKED_ID,
          toApplicationId: APP_ID,
          toLabel: 'current_account',
          amount: 250,
          cadence: 'once',
          newBalance: 750,
        },
      },
    ])
  })

  it('a monthly transfer is a standing order and moves nothing today', async () => {
    const { call, actions } = world()
    const got = await call('primary', '/transfers', { ...body, cadence: 'monthly' })
    expect(got.body).toMatchObject({
      summary: '€250 a month will go from AIB to your current_account.',
    })
    expect(writesOf(actions)).toMatchObject([{ args: { newBalance: null } }])
  })

  it.each([
    ['an account that is not linked', { ...body, fromAccountId: MESSAGE_ID }, 404],
    ['an application that is not on the case', { ...body, toApplicationId: MESSAGE_ID }, 404],
    ['more than the account holds', { ...body, amount: 1001 }, 400],
    ['no amount', { ...body, amount: 0 }, 400],
    ['no existing account to pay into', { ...body, toApplicationId: null }, 400],
  ])('refuses %s', async (_name, payload, status) => {
    const { call, actions } = world()
    expect((await call('primary', '/transfers', payload)).status).toBe(status)
    expect(writesOf(actions)).toEqual([])
  })

  it('refuses when the consent never covered payments', async () => {
    const { call, actions } = world()
    withAccount(actions, { consentScope: ['balances'] })
    const got = await call('primary', '/transfers', body)
    expect(got.status).toBe(403)
    expect(writesOf(actions)).toEqual([])
  })

  it('refuses when the consent has expired', async () => {
    const { call, actions } = world()
    withAccount(actions, { consentExpiresAt: new Date(Date.now() - 1000).toISOString() })
    const got = await call('primary', '/transfers', body)
    expect(got.status).toBe(403)
    expect(got.body).toMatchObject({
      error: { message: 'The consent for that account has expired.' },
    })
  })
})

describe('POST /push-subscriptions', () => {
  const body = { endpoint: 'https://push.example.invalid/abc', p256dh: 'k', auth: 'a' }

  it('stores the subscription against the caller’s own seat', async () => {
    const { call, actions } = world()
    const got = await call('primary', '/push-subscriptions', body)
    expect(got.status).toBe(201)
    expect(got.body).toEqual({ subscribed: true })
    expect(actions.calls).toEqual([
      {
        name: 'subscribePush',
        args: { caseId: CASE_ID, participantId: `participant-primary-${USER_ID}`, ...body },
      },
    ])
  })

  it('rejects an endpoint that is not a URL', async () => {
    const { call, actions } = world()
    expect(
      (await call('primary', '/push-subscriptions', { ...body, endpoint: 'nope' })).status,
    ).toBe(400)
    expect(actions.calls).toEqual([])
  })
})

describe('POST /feedback', () => {
  it('records a thumbs on one of Saoirse’s replies', async () => {
    const { call, actions } = world()
    const got = await call('primary', '/feedback', {
      kind: 'turn',
      messageId: MESSAGE_ID,
      rating: -1,
    })
    expect(got.status).toBe(201)
    expect(got.body).toMatchObject({ summary: 'Thanks, noted.' })
    expect(writesOf(actions)).toMatchObject([
      {
        name: 'saveFeedback',
        args: { kind: 'turn', messageId: MESSAGE_ID, rating: -1, replyTo: null },
      },
    ])
  })

  it('records a session rating with its words, and drops an empty comment', async () => {
    const { call, actions } = world()
    await call('primary', '/feedback', {
      kind: 'session',
      rating: 4,
      comment: 'Good',
      replyTo: 'a@example.invalid',
    })
    await call('primary', '/feedback', { kind: 'session', rating: 5, comment: '' })
    expect(writesOf(actions)).toMatchObject([
      { args: { messageId: null, comment: 'Good', replyTo: 'a@example.invalid' } },
      { args: { comment: null } },
    ])
  })

  it.each([
    ['a thumbs with no reply', { kind: 'turn', rating: 1 }],
    ['a thumbs that is not up or down', { kind: 'turn', messageId: MESSAGE_ID, rating: 3 }],
    ['a rating of zero', { kind: 'session', rating: 0 }],
    ['a rating above five', { kind: 'session', rating: 6 }],
    ['a reply address that is not one', { kind: 'session', rating: 3, replyTo: 'nope' }],
  ])('refuses %s', async (_name, body) => {
    const { call, actions } = world()
    expect((await call('primary', '/feedback', body)).status).toBe(400)
    expect(actions.calls).toEqual([])
  })

  it('404s a reply that is not Saoirse’s on this case', async () => {
    const { call, actions } = world()
    actions.saoirseMessages.clear()
    const got = await call('primary', '/feedback', {
      kind: 'turn',
      messageId: MESSAGE_ID,
      rating: 1,
    })
    expect(got.status).toBe(404)
    expect(actions.calls).toEqual([])
  })
})
