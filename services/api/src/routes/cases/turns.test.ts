import { describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '@shared/contracts/stream.ts'
import { createApp, type AppDeps } from '../../app.ts'
import { createLogger } from '../../log.ts'
import { createTokenVerifier } from '../../middleware/auth.ts'
import { ApiError } from '../../errors.ts'
import { just } from '../../turn/stream.ts'
import type { TurnRunner } from '../../turn/turn.ts'
import { CASE_ID, OTHER_CASE_ID, SECRET, fakeStore, fakeStores, tokenFor } from '../../testing.ts'

const PARTNER_USER = '44444444-4444-4444-8444-444444444444'
const ADMIN_USER = '55555555-5555-4555-8555-555555555555'
const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })

const FRAMES: StreamEvent[] = [
  { type: 'text_delta', text: 'Hello.' },
  { type: 'status', caseId: CASE_ID, invalidate: ['case'] },
  { type: 'done', messageId: '66666666-6666-4666-8666-666666666666', gateCategory: 'banking' },
]

function appWith(run: TurnRunner, overrides: Partial<AppDeps> = {}) {
  const lines: string[] = []
  const app = createApp({
    verifyToken,
    store: fakeStore({ partners: { [PARTNER_USER]: [CASE_ID] }, admins: [ADMIN_USER] }),
    ...fakeStores(),
    version: 'test',
    log: createLogger((line) => lines.push(line)),
    turn: { run, keepAliveMs: 25_000 },
    ...overrides,
  })
  return { app, lines }
}

const post = async (
  app: ReturnType<typeof appWith>['app'],
  path: string,
  token: string | null,
  body: unknown = { trigger: 'message', message: 'hello' },
) =>
  app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  })

const turnPath = (caseId = CASE_ID) => `/api/cases/${caseId}/turns`

describe('POST /api/cases/:caseId/turns: who may take a turn', () => {
  it('401 without a token, and the runner is never asked', async () => {
    const run = vi.fn<TurnRunner>(() => Promise.resolve(just(...FRAMES)))
    const { app } = appWith(run)
    expect((await post(app, turnPath(), null)).status).toBe(401)
    expect((await post(app, turnPath(), 'not-a-jwt')).status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })

  it('404 for a stranger, and for a case that does not exist', async () => {
    const run = vi.fn<TurnRunner>(() => Promise.resolve(just(...FRAMES)))
    const { app } = appWith(run)
    const stranger = await tokenFor({ sub: '77777777-7777-4777-8777-777777777777' })
    const reply = await post(app, turnPath(), stranger)
    expect(reply.status).toBe(404)
    expect(await reply.json()).toMatchObject({ ok: false, error: { code: 'not_found' } })
    expect((await post(app, turnPath(OTHER_CASE_ID), await tokenFor())).status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })

  it('403 for a partner on the case (Invariant 7) and for an administrator', async () => {
    const run = vi.fn<TurnRunner>(() => Promise.resolve(just(...FRAMES)))
    const { app } = appWith(run)
    const partner = await post(app, turnPath(), await tokenFor({ sub: PARTNER_USER }))
    expect(partner.status).toBe(403)
    expect(await partner.json()).toMatchObject({ error: { code: 'forbidden' } })
    expect((await post(app, turnPath(), await tokenFor({ sub: ADMIN_USER }))).status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('400 for a body that is not a turn, after the caller is known', async () => {
    const run = vi.fn<TurnRunner>(() => Promise.resolve(just(...FRAMES)))
    const { app } = appWith(run)
    const token = await tokenFor()
    expect((await post(app, turnPath(), token, { trigger: 'sing' })).status).toBe(400)
    expect((await post(app, turnPath(), token, { message: 'x'.repeat(1_001) })).status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('is not mounted when no turn runner is configured', async () => {
    const { app } = appWith(vi.fn(), {})
    const bare = createApp({
      verifyToken,
      store: fakeStore(),
      ...fakeStores(),
      version: 'test',
    })
    expect((await post(bare, turnPath(), await tokenFor())).status).toBe(404)
    expect(app).toBeDefined()
  })
})

describe('POST /api/cases/:caseId/turns: the primary’s stream', () => {
  it('200 text/event-stream, one data frame per event, in order, for the seat’s own case', async () => {
    const run = vi.fn<TurnRunner>(() => Promise.resolve(just(...FRAMES)))
    const { app } = appWith(run)
    const reply = await post(app, turnPath(), await tokenFor(), {
      trigger: 'message',
      message: 'hello',
    })

    expect(reply.status).toBe(200)
    expect(reply.headers.get('content-type')).toBe('text/event-stream')
    expect(reply.headers.get('x-accel-buffering')).toBe('no')
    expect(reply.headers.get('cache-control')).toContain('no-cache')
    expect(await reply.text()).toBe(FRAMES.map((f) => `data: ${JSON.stringify(f)}\n\n`).join(''))

    // The case comes from the path and the seat, never from the body.
    expect(run).toHaveBeenCalledWith({
      caseId: CASE_ID,
      participantId: expect.stringContaining('participant-primary') as string,
      body: { caseId: CASE_ID, trigger: 'message', message: 'hello' },
    })
  })

  it('defaults the trigger to a message, as the Edge Function did', async () => {
    const run = vi.fn<TurnRunner>(() => Promise.resolve(just(...FRAMES)))
    const { app } = appWith(run)
    await post(app, turnPath(), await tokenFor(), { message: 'hi' })
    expect(run.mock.calls[0]?.[0].body).toMatchObject({ trigger: 'message', message: 'hi' })
  })

  it('a failure before the stream opens is one error frame, not a bare 500', async () => {
    const run: TurnRunner = () => Promise.reject(new Error('relation "cases" does not exist'))
    const { app, lines } = appWith(run)
    const reply = await app.request(turnPath(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await tokenFor()}`,
        'Content-Type': 'application/json',
        'X-Request-ID': 'req-1',
      },
      body: JSON.stringify({ trigger: 'opening' }),
    })

    expect(reply.status).toBe(200)
    expect(await reply.text()).toBe(
      `data: ${JSON.stringify({
        type: 'error',
        error: {
          code: 'upstream_unavailable',
          message: 'Saoirse could not answer just now. Request id req-1.',
        },
      })}\n\n`,
    )
    // The database's words go to the log, never to the customer.
    expect(lines.join('\n')).toContain('turn failed before the stream opened')
  })

  it('a case that vanished is a 404, not an error frame', async () => {
    const run: TurnRunner = () =>
      Promise.reject(new ApiError('not_found', 'That case does not exist.'))
    const { app } = appWith(run)
    expect((await post(app, turnPath(), await tokenFor())).status).toBe(404)
  })
})
