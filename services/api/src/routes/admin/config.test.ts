import { describe, expect, it, vi } from 'vitest'
import { SLIDER_NAMES } from '@shared/llm/persona.ts'
import type { AdminConfigStore } from '../../store/admin/config.ts'
import { adminTestApp } from './testing.ts'

const sliders = Object.fromEntries(SLIDER_NAMES.map((name) => [name, 0.5]))

function fake() {
  const store = {
    setKillSwitch: vi.fn((enabled: boolean) => Promise.resolve({ killSwitch: enabled })),
    setPersona: vi.fn(() => Promise.resolve({ preset: 'concise' })),
    testGuardrail: vi.fn(() =>
      Promise.resolve({
        category: 'banking',
        reachesModel: true,
        response: null,
        reason: null,
        injectionFlagged: false,
        profanity: false,
        sensitive: false,
      }),
    ),
    previewPersona: vi.fn(() => Promise.resolve({ reply: 'Hello.' })),
  } satisfies AdminConfigStore
  return { store, ...adminTestApp({ config: store }) }
}

const routes: [string, string, unknown][] = [
  ['PUT', '/api/admin/kill-switch', { enabled: true }],
  ['PUT', '/api/admin/persona', { preset: 'concise' }],
  ['POST', '/api/admin/persona/preview', { sliders, message: 'hi' }],
  ['POST', '/api/admin/guardrails/test', { message: 'hi' }],
]

describe('admin config', () => {
  it.each(routes)('%s %s is 403 for a non-admin whatever the body', async (method, path) => {
    const { send, store } = fake()
    expect((await send('user', method, path, { bad: 1 })).status).toBe(403)
    for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled()
  })

  it('sets the kill switch', async () => {
    const { send } = fake()
    const reply = await send('admin', 'PUT', '/api/admin/kill-switch', { enabled: true })
    expect(await reply.json()).toEqual({ killSwitch: true })
  })

  it('sets the persona', async () => {
    const { send, store } = fake()
    const reply = await send('admin', 'PUT', '/api/admin/persona', { preset: 'concise' })
    expect(reply.status).toBe(200)
    expect(store.setPersona).toHaveBeenCalledWith({ preset: 'concise', sliders: undefined })
  })

  it('previews a persona and tests a guardrail', async () => {
    const { send } = fake()
    const preview = await send('admin', 'POST', '/api/admin/persona/preview', {
      sliders,
      message: 'hi',
    })
    expect(await preview.json()).toEqual({ reply: 'Hello.' })
    const test = await send('admin', 'POST', '/api/admin/guardrails/test', { message: 'hi' })
    expect(await test.json()).toMatchObject({ category: 'banking', reachesModel: true })
  })

  it('rejects a body that does not fit for an admin', async () => {
    const { send } = fake()
    expect((await send('admin', 'PUT', '/api/admin/kill-switch', { enabled: 'yes' })).status).toBe(
      400,
    )
  })
})
