/**
 * The catalogue routes against a real database: product and rate edits are written, versioned and
 * restorable, and the overrides are checked against the compiled catalogue.
 */
// The harness first: it loads @hono/zod-openapi, which must patch zod before the shared schemas exist.
import '../harness.ts'
import { knowledgeProductSchema, mortgageRateSchema } from '@shared/contracts/catalogue.ts'
import { demoKnowledgeBase } from '@shared/tenants/demo/knowledge-base.ts'
import { demoMortgageRates } from '@shared/tenants/demo/mortgage-rates.ts'
import { afterAll, describe, expect, it } from 'vitest'
import {
  anonymousUser,
  buildApp,
  emailUser,
  errorCode,
  request,
  serviceClient,
} from '../harness.ts'

const app = buildApp()
const service = serviceClient()
const product = knowledgeProductSchema.parse(demoKnowledgeBase.products[0])
const rate = mortgageRateSchema.parse(demoMortgageRates.rates[0])

// Empty means "use the published files", so leave both tables as they were found.
afterAll(async () => {
  await service.from('product_catalogue').delete().neq('id', '')
  await service.from('mortgage_rates').delete().neq('id', '')
  await service.from('catalogue_overrides').delete().eq('entry_id', 'buy_first_home')
})

describe('admin catalogue', () => {
  it('refuses a non-administrator on every route', async () => {
    const visitor = await anonymousUser()
    const list = await request(app, 'GET', '/api/admin/products', { token: visitor.token })
    expect(list.status).toBe(403)
    expect(errorCode(list)).toBe('forbidden')
    const put = await request(app, 'PUT', `/api/admin/products/${product.id}`, {
      token: visitor.token,
      body: {},
    })
    expect(put.status).toBe(403)
  })

  it('shows the published products until something is loaded', async () => {
    const admin = await emailUser({ admin: true })
    await service.from('product_catalogue').delete().neq('id', '')
    const list = await request(app, 'GET', '/api/admin/products', { token: admin.token })
    expect(list.status).toBe(200)
    expect(list.body.loaded).toBe(false)
    expect(list.body.rows.length).toBe(demoKnowledgeBase.products.length)
  })

  it('writes, versions and restores a product, seeding the file first', async () => {
    const admin = await emailUser({ admin: true })
    const token = admin.token
    await service.from('product_catalogue').delete().neq('id', '')

    const set = await request(app, 'PUT', `/api/admin/products/${product.id}`, {
      token,
      body: { product, enabled: false },
    })
    expect(set.status).toBe(200)
    expect(set.body).toEqual({ version: 2 })

    // One edit never leaves a one-row catalogue.
    const stored = await service.from('product_catalogue').select('id')
    expect(stored.data?.length).toBe(demoKnowledgeBase.products.length)

    const list = await request(app, 'GET', '/api/admin/products', { token })
    expect(list.body.loaded).toBe(true)
    expect(list.body.rows.find((row: { id: string }) => row.id === product.id)).toMatchObject({
      enabled: false,
      version: 2,
      published: true,
    })

    const mismatch = await request(app, 'PUT', '/api/admin/products/savings.other', {
      token,
      body: { product, enabled: true },
    })
    expect(mismatch.status).toBe(400)
    expect(errorCode(mismatch)).toBe('bad_request')

    const restored = await request(app, 'POST', `/api/admin/products/${product.id}/restore`, {
      token,
    })
    expect(restored.status).toBe(200)
    expect(restored.body).toEqual({ version: 3 })
    const back = await service
      .from('product_catalogue')
      .select('enabled')
      .eq('id', product.id)
      .single()
    expect(back.data?.enabled).toBe(true)

    const deleted = await request(app, 'DELETE', `/api/admin/products/${product.id}`, { token })
    expect(deleted.body).toEqual({ deleted: true })
    const loaded = await request(app, 'POST', '/api/admin/products/load-published', { token })
    expect(loaded.status).toBe(200)
    expect(loaded.body).toEqual({ inserted: 1 })
  })

  it('removes a product the published file does not have when it is restored', async () => {
    const admin = await emailUser({ admin: true })
    const added = { ...product, id: 'savings.presenter_added' }
    await request(app, 'PUT', `/api/admin/products/${added.id}`, {
      token: admin.token,
      body: { product: added, enabled: true },
    })
    const restored = await request(app, 'POST', `/api/admin/products/${added.id}/restore`, {
      token: admin.token,
    })
    expect(restored.body).toEqual({ version: 0 })
    const gone = await service.from('product_catalogue').select('id').eq('id', added.id)
    expect(gone.data).toEqual([])
  })

  it('writes and restores a rate, and loads the published table', async () => {
    const admin = await emailUser({ admin: true })
    const token = admin.token
    await service.from('mortgage_rates').delete().neq('id', '')

    const set = await request(app, 'PUT', `/api/admin/rates/${rate.id}`, {
      token,
      body: { rate, enabled: false },
    })
    expect(set.status).toBe(200)
    const mismatch = await request(app, 'PUT', '/api/admin/rates/other', {
      token,
      body: { rate, enabled: true },
    })
    expect(mismatch.status).toBe(400)

    const list = await request(app, 'GET', '/api/admin/rates', { token })
    expect(list.body.loaded).toBe(true)
    expect(typeof list.body.asOf).toBe('string')

    const restored = await request(app, 'POST', `/api/admin/rates/${rate.id}/restore`, { token })
    expect(restored.status).toBe(200)
    const loaded = await request(app, 'POST', '/api/admin/rates/load-published', { token })
    expect(loaded.body).toEqual({ inserted: 0 })
    const deleted = await request(app, 'DELETE', `/api/admin/rates/${rate.id}`, { token })
    expect(deleted.body).toEqual({ deleted: true })
  })

  it('sets, lists and clears a catalogue override, and refuses nonsense', async () => {
    const admin = await emailUser({ admin: true })
    const token = admin.token
    const path = '/api/admin/catalogue-overrides/goal/buy_first_home'
    const body = {
      enabled: false,
      name: null,
      summary: null,
      priority: null,
      milestoneLabels: {},
      checkinAgendas: {},
    }

    const set = await request(app, 'PUT', path, { token, body })
    expect(set.status).toBe(200)
    expect(typeof set.body.version).toBe('number')

    const list = await request(app, 'GET', '/api/admin/catalogue-overrides', { token })
    expect(list.status).toBe(200)
    expect(
      list.body.overrides.some((o: { entryId: string }) => o.entryId === 'buy_first_home'),
    ).toBe(true)

    const unknown = await request(app, 'PUT', '/api/admin/catalogue-overrides/goal/no_such_goal', {
      token,
      body,
    })
    expect(unknown.status).toBe(404)

    const priority = await request(app, 'PUT', path, {
      token,
      body: { ...body, priority: 'high' },
    })
    expect(priority.status).toBe(400)

    const strayMilestone = await request(app, 'PUT', path, {
      token,
      body: { ...body, milestoneLabels: { nope: 'Nope' } },
    })
    expect(strayMilestone.status).toBe(400)

    const cleared = await request(app, 'DELETE', path, { token })
    expect(cleared.body).toEqual({ cleared: true })
  })
})
