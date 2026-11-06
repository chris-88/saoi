import { describe, expect, it } from 'vitest'
import { ApiError } from '../../errors.ts'
import { supabaseAdminPushStore, type AdminPushStore } from '../../store/admin/push.ts'
import type { Db } from '../../store/client.ts'
import { adminTestApp } from './testing.ts'

const ID = '44444444-4444-4444-8444-444444444444'
const path = `/api/admin/cases/${ID}/notifications`

const sent = { message: 'hi', url: 'http://x/#/?n=abc', subscriptions: 2, delivered: 1 }

describe('admin push routes', () => {
  it('is 403 for a non-admin even with a bad body, and 401 for anonymous', async () => {
    const push: AdminPushStore = { sendNotification: () => Promise.resolve(sent) }
    const { send } = adminTestApp({ push })
    expect((await send('user', 'POST', path, { title: '' })).status).toBe(403)
    expect((await send('anonymous', 'POST', path, {})).status).toBe(401)
  })

  it('sends with the defaults or the presenter’s own words', async () => {
    const calls: unknown[] = []
    const push: AdminPushStore = {
      sendNotification: (input) => {
        calls.push(input)
        return Promise.resolve(sent)
      },
    }
    const { send } = adminTestApp({ push })
    const plain = await send('admin', 'POST', path, {})
    expect(plain.status).toBe(200)
    expect(await plain.json()).toEqual(sent)
    await send('admin', 'POST', path, { title: 'Hello', body: 'World' })
    expect(calls).toEqual([{ caseId: ID }, { caseId: ID, title: 'Hello', body: 'World' }])
  })

  it('rejects an over-long title with 400', async () => {
    const push: AdminPushStore = { sendNotification: () => Promise.resolve(sent) }
    const { send } = adminTestApp({ push })
    expect((await send('admin', 'POST', path, { title: 'x'.repeat(41) })).status).toBe(400)
  })

  it('maps missing push configuration to 502', async () => {
    const push: AdminPushStore = {
      sendNotification: () =>
        Promise.reject(new ApiError('upstream_unavailable', 'Push is not configured.')),
    }
    const { send } = adminTestApp({ push })
    expect((await send('admin', 'POST', path, {})).status).toBe(502)
  })
})

describe('supabaseAdminPushStore', () => {
  it('refuses when VAPID is not configured, before touching the database', async () => {
    const store = supabaseAdminPushStore({} as Db, {
      saoiModel: 'a',
      gateModel: 'b',
      appBaseUrl: '',
    })
    await expect(store.sendNotification({ caseId: ID })).rejects.toMatchObject({
      code: 'upstream_unavailable',
    })
  })
})
