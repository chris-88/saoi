import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CASE = '22222222-2222-4222-8222-222222222222'
const PLAN = '33333333-3333-4333-8333-333333333333'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function load(apiUrl: string) {
  vi.resetModules()
  vi.doMock('@/lib/env', () => ({ saoiApiUrl: apiUrl }))
  vi.doMock('@/lib/supabase', () => ({
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }) },
    },
  }))
  return (await import('@/admin/adminClient')).adminApi
}

describe('adminApi', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const last = () => {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    return {
      url,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? init.body : '',
      headers: init.headers,
    }
  }

  it('reads the overview from a GET route with the bearer token, not the function', async () => {
    const api = await load('https://api.test/saoi')
    fetchMock.mockImplementation(() => Promise.resolve(json({})))
    // The empty body fails the response schema; what matters is the request that was made.
    await expect(api.overview('7d')).rejects.toThrow()
    expect(last().url).toBe('https://api.test/saoi/api/admin/overview?period=7d')
    expect(last().method).toBe('GET')
    expect(last().headers).toMatchObject({ Authorization: 'Bearer tok' })
  })

  it('sends confirm: true with reset, delete and purge', async () => {
    const api = await load('https://api.test/saoi')
    fetchMock.mockImplementation(() => Promise.resolve(json({ purged: 1, usersRemoved: 0 })))

    await api.resetCase(CASE)
    expect(last()).toMatchObject({
      url: 'https://api.test/saoi/api/admin/cases/reset',
      method: 'POST',
    })
    expect(JSON.parse(last().body)).toEqual({ caseId: CASE, confirm: true })

    await api.deleteCase(CASE)
    expect(last()).toMatchObject({
      url: `https://api.test/saoi/api/admin/cases/${CASE}`,
      method: 'DELETE',
    })
    expect(JSON.parse(last().body)).toEqual({ confirm: true })

    await api.purgeCases()
    expect(last().url).toBe('https://api.test/saoi/api/admin/cases/purge')
    expect(JSON.parse(last().body)).toEqual({ confirm: true })
  })

  it('refuses to reset without a case id instead of picking one', async () => {
    const api = await load('https://api.test/saoi')
    await expect(api.resetCase()).rejects.toThrow('Choose a case')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('puts the ids in the path and the rest in the body', async () => {
    const api = await load('https://api.test/saoi')
    fetchMock.mockImplementation(() => Promise.resolve(json({})))
    await api.planMove(CASE, PLAN, 'pause')
    expect(last().url).toBe(`https://api.test/saoi/api/admin/cases/${CASE}/plans/${PLAN}/moves`)
    expect(JSON.parse(last().body)).toEqual({ move: 'pause' })

    await api.setKillSwitch(true)
    expect(last()).toMatchObject({
      url: 'https://api.test/saoi/api/admin/kill-switch',
      method: 'PUT',
    })

    await api.deleteProduct('p 1')
    expect(last()).toMatchObject({
      url: 'https://api.test/saoi/api/admin/products/p%201',
      method: 'DELETE',
    })
  })

  it('surfaces the server message when a route refuses', async () => {
    const api = await load('https://api.test/saoi')
    fetchMock.mockResolvedValue(
      json(
        { ok: false, error: { code: 'forbidden', message: 'You are not an administrator.' } },
        403,
      ),
    )
    await expect(api.setKillSwitch(true)).rejects.toThrow('You are not an administrator.')
  })
})
