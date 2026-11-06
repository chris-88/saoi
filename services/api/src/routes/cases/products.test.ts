import { describe, expect, it } from 'vitest'
import { writesOf } from '../../testing.actions.ts'
import { loadedCase } from '../../testing.actions.ts'
import { CASE_ID } from '../../testing.ts'
import { world } from './actions.fixture.ts'

describe('POST /products/select', () => {
  it('starts what was chosen, says so, and settles the case', async () => {
    const { call, actions } = world()
    const got = await call('primary', '/products/select', {
      products: [
        { product: 'credit_card' },
        { product: 'savings', catalogueId: 'savings.supersaver' },
      ],
    })
    expect(got.status).toBe(200)
    expect(got.body).toEqual({ applications: [], summary: 'Started credit_card, savings.' })
    expect(actions.calls.map((c) => c.name)).toEqual(['startApplications', 'settle'])
    expect(actions.calls[0]?.args).toEqual([
      { product: 'credit_card' },
      { product: 'savings', catalogueId: 'savings.supersaver' },
    ])
  })

  it('counts what carried over, in the customer’s words', async () => {
    const { call, actions } = world()
    actions.startApplications = () =>
      Promise.resolve({ created: [{ product: 'credit_card' }], reused: 1 })
    const got = await call('primary', '/products/select', {
      products: [{ product: 'credit_card' }],
    })
    expect(got.body).toMatchObject({
      summary: 'Started credit_card. 1 thing carried over from what we already knew.',
    })
  })

  it('says when there was nothing new to start', async () => {
    const { call, actions } = world()
    actions.startApplications = () => Promise.resolve({ created: [], reused: 0 })
    const got = await call('primary', '/products/select', {
      products: [{ product: 'credit_card' }],
    })
    expect(got.body).toMatchObject({ summary: 'Those were already started.' })
  })

  it.each([
    ['no products', { products: [] }],
    ['an unknown product', { products: [{ product: 'yacht' }] }],
    ['too many', { products: Array.from({ length: 6 }, () => ({ product: 'savings' })) }],
    ['no body', {}],
  ])('rejects %s with 400 and writes nothing', async (_name, body) => {
    const { call, actions } = world()
    const got = await call('primary', '/products/select', body)
    expect(got.status).toBe(400)
    expect(got.body).toMatchObject({ ok: false, error: { code: 'bad_request' } })
    expect(actions.calls).toEqual([])
  })

  it('is 404 when the case has gone', async () => {
    const { call, actions } = world()
    actions.loaded = null
    expect(
      (await call('primary', '/products/select', { products: [{ product: 'savings' }] })).status,
    ).toBe(404)
  })
})

describe('POST /products/:product/decline', () => {
  it('records the decline once', async () => {
    const { call, actions } = world()
    const got = await call('primary', '/products/personal_loan/decline')
    expect(got.status).toBe(200)
    expect(got.body).toMatchObject({ summary: 'Noted — I will not bring that up again.' })
    expect(writesOf(actions)).toEqual([{ name: 'declineProduct', args: 'personal_loan' }])
  })

  it('declining twice is declining once: no second event', async () => {
    const { call, actions } = world()
    actions.loaded = loadedCase(CASE_ID, {
      productInterests: [{ product: 'personal_loan', status: 'declined', reason: null }],
    })
    const got = await call('primary', '/products/personal_loan/decline')
    expect(got.body).toMatchObject({ summary: 'Already left to one side.' })
    expect(writesOf(actions)).toEqual([])
  })

  it('rejects a product we do not sell', async () => {
    const { call, actions } = world()
    expect((await call('primary', '/products/yacht/decline')).status).toBe(400)
    expect(actions.calls).toEqual([])
  })
})
