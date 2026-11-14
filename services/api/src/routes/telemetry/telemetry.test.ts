import { describe, expect, it } from 'vitest'
import type { McpCall } from '@shared/contracts/telemetry.ts'
import { createApp } from '../../app.ts'
import { createLogger } from '../../log.ts'
import { createTokenVerifier } from '../../middleware/auth.ts'
import { SECRET, fakeStore, fakeStores } from '../../testing.ts'

const KEY = 'internal-key-for-tests'
const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })

function appWith(options: { key?: string; failing?: boolean } = {}) {
  const recorded: McpCall[] = []
  const app = createApp({
    verifyToken,
    store: fakeStore(),
    ...fakeStores(),
    version: 'test',
    log: createLogger(() => undefined),
    telemetry: {
      internalKey: options.key ?? KEY,
      store: {
        record: (call) => {
          if (options.failing === true) return Promise.reject(new Error('database down'))
          recorded.push(call)
          return Promise.resolve()
        },
      },
    },
  })
  return { app, recorded }
}

const post = (app: ReturnType<typeof appWith>['app'], body: unknown, key?: string) =>
  app.request('/api/telemetry/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key === undefined ? {} : { 'X-Internal-Key': key }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const CALL = {
  kind: 'tool',
  name: 'saoi_home_calculator',
  host: 'claude',
  userAgent: 'Claude-User/1.0',
  sessionKey: 'a'.repeat(64),
  outcome: 'gated',
  ms: 412,
  gateMissing: ['income', 'monthlySaving'],
  asked: { price: '350-450k', buyingTogether: true },
}

describe('POST /api/telemetry/mcp', () => {
  it('is not there without a key configured, and refuses a missing or wrong key', async () => {
    expect((await post(appWith({ key: '' }).app, CALL, 'anything')).status).toBe(404)
    const { app, recorded } = appWith()
    expect((await post(app, CALL)).status).toBe(401)
    expect((await post(app, CALL, 'wrong')).status).toBe(401)
    expect(recorded).toEqual([])
  })

  it('records one call, with the defaults filled in and the user agent cut', async () => {
    const { app, recorded } = appWith()
    const reply = await post(app, { ...CALL, userAgent: 'x'.repeat(300) }, KEY)
    expect(reply.status).toBe(204)
    expect(recorded).toEqual([
      {
        ...CALL,
        userAgent: 'x'.repeat(200),
        clientName: null,
        clientVersion: null,
        card: false,
        savedPlanId: null,
      },
    ])
  })

  it('refuses a record that is not valid and says where', async () => {
    const { app, recorded } = appWith()
    const reply = await post(app, { ...CALL, host: 'copilot', sessionKey: '10.0.0.1' }, KEY)
    expect(reply.status).toBe(400)
    const body = (await reply.json()) as { error: { details: string[] } }
    expect(body.error.details.join(' ')).toMatch(/host/)
    expect(body.error.details.join(' ')).toMatch(/sessionKey/)
    expect((await post(app, 'not json', KEY)).status).toBe(400)
    expect(recorded).toEqual([])
  })

  it('refuses a body over 16 KiB', async () => {
    const { app } = appWith()
    const huge = JSON.stringify({ ...CALL, asked: { query: 'x'.repeat(20 * 1024) } })
    const reply = await app.request('/api/telemetry/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(huge.length),
        'X-Internal-Key': KEY,
      },
      body: huge,
    })
    expect(reply.status).toBe(413)
  })

  it('answers 500 when the write fails, so the MCP server logs it', async () => {
    const { app } = appWith({ failing: true })
    expect((await post(app, CALL, KEY)).status).toBe(500)
  })
})
