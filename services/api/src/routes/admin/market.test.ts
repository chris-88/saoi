import { describe, expect, it } from 'vitest'
import type { MarketProductVersion } from '@shared/contracts/market.ts'
import type { AdminMarketStore, MarketProductFilter } from '../../store/admin/market.ts'
import { adminTestApp } from './testing.ts'

const PATH = '/api/admin/market-products'

const version: MarketProductVersion = {
  provider: 'boi',
  source: 'bank',
  category: 'savings',
  productId: 'savings.supersaver',
  providerProductName: 'Supersaver',
  rates: { kind: 'deposit', aerPct: 2.5, basis: 'variable' },
  conditions: { takesMonthly: true, takesLumpSum: false, minMonthlyEur: 25 },
  sourceUrl: 'https://example.invalid/supersaver',
  providerUrl: null,
  sourceProductId: null,
  sourceUpdatedAt: null,
  attribution: null,
  unknown: [],
  effectiveFrom: null,
  firstSeenAt: '2026-11-09T12:00:00.000Z',
  checkedAt: '2026-11-09T12:00:00.000Z',
  supersededAt: null,
}

function fake() {
  const calls: MarketProductFilter[] = []
  const store: AdminMarketStore = {
    list: (filter) => {
      calls.push(filter)
      return Promise.resolve({ items: [version], skipped: 0 })
    },
  }
  return { store, calls }
}

describe('admin market-products route', () => {
  it('403 for a non-admin even with an invalid query, 401 anonymous', async () => {
    const { send } = adminTestApp({ market: fake().store })
    expect((await send('user', 'GET', `${PATH}?history=maybe`)).status).toBe(403)
    expect((await send('anonymous', 'GET', PATH)).status).toBe(401)
  })

  it('returns the current rows by default', async () => {
    const { store, calls } = fake()
    const { send } = adminTestApp({ market: store })
    const reply = await send('admin', 'GET', PATH)
    expect(reply.status).toBe(200)
    expect(await reply.json()).toEqual({ items: [version], skipped: 0 })
    expect(calls).toEqual([
      { history: false, provider: undefined, source: undefined, productId: undefined },
    ])
  })

  it('history=true asks for every version', async () => {
    const { store, calls } = fake()
    const { send } = adminTestApp({ market: store })
    await send('admin', 'GET', `${PATH}?history=true&provider=boi&source=ccpc`)
    expect(calls).toEqual([
      { history: true, provider: 'boi', source: 'ccpc', productId: undefined },
    ])
  })

  it('a product filter implies history', async () => {
    const { store, calls } = fake()
    const { send } = adminTestApp({ market: store })
    await send('admin', 'GET', `${PATH}?productId=savings.supersaver`)
    expect(calls).toEqual([
      { history: true, provider: undefined, source: undefined, productId: 'savings.supersaver' },
    ])
  })

  it('a bad query is a 400', async () => {
    const { send } = adminTestApp({ market: fake().store })
    expect((await send('admin', 'GET', `${PATH}?history=maybe`)).status).toBe(400)
    expect((await send('admin', 'GET', `${PATH}?productId=Nope`)).status).toBe(400)
    expect((await send('admin', 'GET', `${PATH}?source=web`)).status).toBe(400)
  })

  it('is listed in the OpenAPI document', async () => {
    const { app } = adminTestApp({ market: fake().store })
    const doc = (await (await app.request('/api/openapi.json')).json()) as {
      paths: Record<string, unknown>
    }
    expect(Object.keys(doc.paths)).toContain(PATH)
  })
})
