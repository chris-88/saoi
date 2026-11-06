import { Validator } from '@seriousme/openapi-schema-validator'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { createTokenVerifier } from './middleware/auth.ts'
import {
  CASE_ID,
  OTHER_CASE_ID,
  SECRET,
  USER_ID,
  fakeStore,
  fakeStores,
  tokenFor,
} from './testing.ts'

const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })

function appWith(store = fakeStore()) {
  return createApp({
    verifyToken,
    store,
    ...fakeStores(),
    version: 'test',
    feed: { pollMs: 5, keepAliveMs: 20 },
  })
}

const authed = async (init: { anonymous?: boolean } = {}) => ({
  Authorization: `Bearer ${await tokenFor({ is_anonymous: init.anonymous ?? false })}`,
})

describe('meta', () => {
  it('answers /health without a token', async () => {
    const response = await appWith().request('/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, version: 'test' })
  })

  it('serves an OpenAPI document that validates', async () => {
    const response = await appWith().request('/openapi.json')
    expect(response.status).toBe(200)
    const document: unknown = await response.json()

    const result = await new Validator().validate(document as Record<string, unknown>)
    expect(result.errors ?? result.valid).toBeTruthy()
    expect(result.valid).toBe(true)

    const paths = Object.keys((document as { paths: Record<string, unknown> }).paths)
    expect(paths).toEqual(
      expect.arrayContaining([
        '/health',
        '/api/cases/{caseId}/snapshot',
        '/api/cases/{caseId}/history',
        '/api/cases/{caseId}/events',
      ]),
    )
    const components = (document as { components: { schemas: Record<string, unknown> } }).components
    expect(Object.keys(components.schemas)).toEqual(
      expect.arrayContaining(['CaseFeedReady', 'CaseFeedUpdate']),
    )
  })
})

describe('auth', () => {
  it.each([
    ['no header', {}],
    ['not a bearer', { Authorization: 'Basic abc' }],
    ['garbage', { Authorization: 'Bearer not.a.jwt' }],
  ])('401 with %s', async (_name, headers) => {
    const response = await appWith().request(`/api/cases/${CASE_ID}/snapshot`, { headers })
    expect(response.status).toBe(401)
  })

  it('401 for a token signed with another secret', async () => {
    const token = await tokenFor({ secret: 'another-secret-another-secret-12345' })
    const response = await appWith().request(`/api/cases/${CASE_ID}/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(401)
  })

  it('401 for the anon key shape: right signature, wrong audience', async () => {
    const token = await tokenFor({ aud: 'anon' })
    const response = await appWith().request(`/api/cases/${CASE_ID}/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(401)
  })
})

describe('case access', () => {
  it('404, not 403, for a case the caller cannot see', async () => {
    const response = await appWith().request(`/api/cases/${OTHER_CASE_ID}/snapshot`, {
      headers: await authed(),
    })
    expect(response.status).toBe(404)
    const history = await appWith().request(`/api/cases/${OTHER_CASE_ID}/history`, {
      headers: await authed(),
    })
    expect(history.status).toBe(404)
    const events = await appWith().request(`/api/cases/${OTHER_CASE_ID}/events`, {
      headers: await authed(),
    })
    expect(events.status).toBe(404)
  })

  it('400 for a malformed case id', async () => {
    const response = await appWith().request('/api/cases/nope/snapshot', {
      headers: await authed(),
    })
    expect(response.status).toBe(400)
  })
})

describe('snapshot', () => {
  it('reports signedIn from the token and counts reuse per application', async () => {
    const store = fakeStore({
      rows: {
        applications: [
          { id: 'a1', product: 'credit_card', state: 'in_progress', catalogue_id: null },
        ],
        reusedApplicationIds: ['a1', 'a1', null],
        transfers: [{ to_application_id: 'a1', amount: '250.50', state: 'initiated' }],
      },
    })
    const anonymous = await appWith(store).request(`/api/cases/${CASE_ID}/snapshot`, {
      headers: await authed({ anonymous: true }),
    })
    expect(((await anonymous.json()) as { signedIn: boolean }).signedIn).toBe(false)

    const response = await appWith(store).request(`/api/cases/${CASE_ID}/snapshot`, {
      headers: await authed(),
    })
    const body = (await response.json()) as {
      signedIn: boolean
      reusedBy: Record<string, number>
      transfers: { amount: number }[]
    }
    expect(body.signedIn).toBe(true)
    expect(body.reusedBy).toEqual({ a1: 2 })
    expect(body.transfers[0]?.amount).toBe(250.5)
  })
})

describe('history', () => {
  it('settles a card the case has already decided, and drops system messages', async () => {
    const store = fakeStore({
      rows: { plans: [{ id: '44444444-4444-4444-8444-444444444444', status: 'active' }] },
      messages: [
        { id: 'm0', role: 'system', content: 'internal', cards: [] },
        { id: 'm1', role: 'customer', content: 'hello', cards: [] },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Shall I keep this?',
          cards: [
            {
              type: 'plan_proposal',
              planId: '44444444-4444-4444-8444-444444444444',
              title: 'Save for a deposit',
              targetAmount: null,
              currentAmount: null,
              projectedDate: null,
              monthsRemaining: null,
              milestones: [],
              checkin: null,
              confirmLabel: 'Keep it',
            },
            { type: 'not_a_card' },
          ],
        },
      ],
    })
    const response = await appWith(store).request(`/api/cases/${CASE_ID}/history`, {
      headers: await authed(),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      entries: { kind: string; text?: string; settled?: { label: string } }[]
    }
    expect(body.entries.map((entry) => entry.kind)).toEqual(['message', 'message', 'card'])
    expect(body.entries[2]?.settled?.label).toBe('Save for a deposit')
  })
})

describe('events (SSE)', () => {
  it('opens with ready, delivers a new narratable event, and keeps alive', async () => {
    const store = fakeStore({
      events: [
        {
          id: 'e1',
          type: 'application_approved',
          payload: { applicationName: 'Credit card' },
          created_at: '2026-11-01T10:00:00.000Z',
        },
      ],
    })
    const response = await appWith(store).request(`/api/cases/${CASE_ID}/events`, {
      headers: await authed(),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader()
    if (!reader) throw new Error('no body')

    let received = ''
    const read = async (until: (text: string) => boolean) => {
      while (!until(received)) {
        const next = await reader.read()
        if (next.done) break
        received += next.value
      }
    }

    await read((text) => text.includes('event: ready'))
    expect(received).toContain('"latest":{"id":"e1","text":"Credit card was approved."}')

    store.events.push(
      // Not narratable, so it is not sent at all.
      { id: 'e2', type: 'fact_recorded', payload: {}, created_at: '2026-11-01T10:00:01.000Z' },
      {
        id: 'e3',
        type: 'application_declined',
        payload: { applicationName: 'Loan' },
        created_at: '2026-11-01T10:00:02.000Z',
      },
    )
    await read((text) => text.includes('event: update'))
    expect(received).toContain('id: e3')
    expect(received).toContain('Loan was not approved.')
    expect(received).not.toContain('fact_recorded')

    await read((text) => text.includes(': keep-alive'))
    expect(received).toContain(': keep-alive')
    await reader.cancel()
  })
})

// Guards the claim in the README: the service's user id is what access is checked against.
describe('identity', () => {
  it('hands the token subject to the access check', async () => {
    const store = fakeStore({ access: { 'someone-else': [CASE_ID] } })
    const response = await appWith(store).request(`/api/cases/${CASE_ID}/snapshot`, {
      headers: await authed(),
    })
    expect(USER_ID).not.toBe('someone-else')
    expect(response.status).toBe(404)
  })
})
