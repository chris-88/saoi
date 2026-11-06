import { adminTestApp } from './testing.ts'
import { knowledgeProductSchema, mortgageRateSchema } from '@shared/contracts/catalogue.ts'
import { demoKnowledgeBase } from '@shared/tenants/demo/knowledge-base.ts'
import { demoMortgageRates } from '@shared/tenants/demo/mortgage-rates.ts'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../errors.ts'
import type { AdminCatalogueStore } from '../../store/admin/catalogue.ts'

const product = knowledgeProductSchema.parse(demoKnowledgeBase.products[0])
const rate = mortgageRateSchema.parse(demoMortgageRates.rates[0])
const override = {
  enabled: false,
  name: null,
  summary: null,
  priority: null,
  milestoneLabels: {},
  checkinAgendas: {},
}

function fakeCatalogue(): AdminCatalogueStore & { calls: unknown[][] } {
  const calls: unknown[][] = []
  const note =
    <A extends unknown[], R>(name: string, result: R) =>
    (...args: A) => {
      calls.push([name, ...args])
      return Promise.resolve(result)
    }
  return {
    calls,
    listOverrides: note('listOverrides', { overrides: [] }),
    setOverride: note('setOverride', { version: 3 }),
    clearOverride: note('clearOverride', undefined),
    listProducts: note('listProducts', {
      loaded: true,
      rows: [
        {
          id: product.id,
          product,
          enabled: true,
          edited: false,
          published: true,
          version: 1,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    }),
    setProduct: note('setProduct', { version: 2 }),
    deleteProduct: note('deleteProduct', undefined),
    loadPublishedProducts: note('loadPublishedProducts', { inserted: 4 }),
    restoreProduct: note('restoreProduct', { version: 5 }),
    listRates: note('listRates', { loaded: false, asOf: '2026-01-01', rows: [] }),
    setRate: note('setRate', { version: 2 }),
    deleteRate: note('deleteRate', undefined),
    loadPublishedRates: note('loadPublishedRates', { inserted: 2 }),
    restoreRate: note('restoreRate', { version: 0 }),
  }
}

const OVERRIDE_PATH = '/api/admin/catalogue-overrides/goal/buy_first_home'
const routes: [string, string, unknown?][] = [
  ['GET', '/api/admin/products'],
  ['PUT', `/api/admin/products/${product.id}`, { product, enabled: true }],
  ['DELETE', `/api/admin/products/${product.id}`],
  ['POST', '/api/admin/products/load-published'],
  ['POST', `/api/admin/products/${product.id}/restore`],
  ['GET', '/api/admin/rates'],
  ['PUT', `/api/admin/rates/${rate.id}`, { rate, enabled: true }],
  ['DELETE', `/api/admin/rates/${rate.id}`],
  ['POST', '/api/admin/rates/load-published'],
  ['POST', `/api/admin/rates/${rate.id}/restore`],
  ['GET', '/api/admin/catalogue-overrides'],
  ['PUT', OVERRIDE_PATH, override],
  ['DELETE', OVERRIDE_PATH],
]

describe('admin catalogue routes', () => {
  it.each(routes)(
    '%s %s: 403 for a non-admin even with an invalid body, 401 anonymous',
    async (method, path) => {
      const { send } = adminTestApp({ catalogue: fakeCatalogue() })
      expect(
        (await send('user', method, path, method === 'GET' ? undefined : { nonsense: true }))
          .status,
      ).toBe(403)
      expect((await send('anonymous', method, path)).status).toBe(401)
    },
  )

  it('lists products and rates', async () => {
    const { send } = adminTestApp({ catalogue: fakeCatalogue() })
    const products = await send('admin', 'GET', '/api/admin/products')
    expect(products.status).toBe(200)
    expect(await products.json()).toMatchObject({ loaded: true, rows: [{ id: product.id }] })
    const rates = await send('admin', 'GET', '/api/admin/rates')
    expect(await rates.json()).toEqual({ loaded: false, asOf: '2026-01-01', rows: [] })
  })

  it('saves, deletes, loads and restores products', async () => {
    const store = fakeCatalogue()
    const { send } = adminTestApp({ catalogue: store })
    const put = await send('admin', 'PUT', `/api/admin/products/${product.id}`, {
      product,
      enabled: false,
    })
    expect(put.status).toBe(200)
    expect(await put.json()).toEqual({ version: 2 })
    expect(store.calls).toContainEqual(['setProduct', product.id, product, false])

    const del = await send('admin', 'DELETE', `/api/admin/products/${product.id}`)
    expect(await del.json()).toEqual({ deleted: true })

    const load = await send('admin', 'POST', '/api/admin/products/load-published')
    expect(await load.json()).toEqual({ inserted: 4 })

    const restore = await send('admin', 'POST', `/api/admin/products/${product.id}/restore`)
    expect(await restore.json()).toEqual({ version: 5 })
  })

  it('saves, deletes, loads and restores rates', async () => {
    const { send } = adminTestApp({ catalogue: fakeCatalogue() })
    const put = await send('admin', 'PUT', `/api/admin/rates/${rate.id}`, { rate, enabled: true })
    expect(await put.json()).toEqual({ version: 2 })
    const del = await send('admin', 'DELETE', `/api/admin/rates/${rate.id}`)
    expect(await del.json()).toEqual({ deleted: true })
    const load = await send('admin', 'POST', '/api/admin/rates/load-published')
    expect(await load.json()).toEqual({ inserted: 2 })
    const restore = await send('admin', 'POST', `/api/admin/rates/${rate.id}/restore`)
    expect(await restore.json()).toEqual({ version: 0 })
  })

  it('reads, writes and clears overrides', async () => {
    const store = fakeCatalogue()
    const { send } = adminTestApp({ catalogue: store })
    const list = await send('admin', 'GET', '/api/admin/catalogue-overrides')
    expect(await list.json()).toEqual({ overrides: [] })
    const put = await send('admin', 'PUT', OVERRIDE_PATH, override)
    expect(await put.json()).toEqual({ version: 3 })
    expect(store.calls).toContainEqual([
      'setOverride',
      { kind: 'goal', entryId: 'buy_first_home', ...override },
    ])
    const del = await send('admin', 'DELETE', OVERRIDE_PATH)
    expect(await del.json()).toEqual({ cleared: true })
    expect(store.calls).toContainEqual(['clearOverride', 'goal', 'buy_first_home'])
  })

  it('400 for an invalid body or kind, and for a mismatched id from the store', async () => {
    const store = fakeCatalogue()
    store.setProduct = () =>
      Promise.reject(new ApiError('bad_request', 'The row id and the product id must match.'))
    const { send } = adminTestApp({ catalogue: store })
    expect((await send('admin', 'PUT', `/api/admin/products/${product.id}`, {})).status).toBe(400)
    expect(
      (await send('admin', 'PUT', '/api/admin/catalogue-overrides/widget/x', override)).status,
    ).toBe(400)
    const mismatch = await send('admin', 'PUT', '/api/admin/products/savings.other', {
      product,
      enabled: true,
    })
    expect(mismatch.status).toBe(400)
    expect(await mismatch.json()).toMatchObject({
      error: { code: 'bad_request', message: 'The row id and the product id must match.' },
    })
  })

  it('404 for an override on an unknown entry', async () => {
    const store = fakeCatalogue()
    store.setOverride = () => Promise.reject(new ApiError('not_found', 'No goal called nope.'))
    const { send } = adminTestApp({ catalogue: store })
    const reply = await send('admin', 'PUT', '/api/admin/catalogue-overrides/goal/nope', override)
    expect(reply.status).toBe(404)
  })
})
