/**
 * `POST /api/cases/:caseId/turns` end to end against a real database, with the fixture provider
 * (`fixtureModels`): no model is called and no key is needed.
 *
 * The Node counterpart of `supabase/functions/integration/saoirse-turn.integration.ts`, and it pins
 * the same things: the frames and their order, the gate's refusal, the auth matrix, and a script
 * that advances with the conversation. The one difference is deliberate: a stranger is 404 here
 * (the Edge Function said 403), and a partner is 403 (Invariant 7, as before).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  addPartner,
  buildApp,
  errorCode,
  NO_SUCH_ID,
  requestRaw,
  rows,
  rowsInOrder,
  serviceClient,
  sseFrames,
  startVisitor,
} from './harness.ts'

const app = buildApp({ fixture: 'opening' })

/** The Edge Function's own output for the same conversation: see `test/recordings`. */
const recording = JSON.parse(
  readFileSync(new URL('../recordings/saoirse-turn-opening.json', import.meta.url), 'utf8'),
) as { contentType: string; turns: string[] }

const normalise = (text: string, caseId: string) =>
  text
    .replaceAll(caseId, '<case-id>')
    .replace(/"messageId":"[0-9a-f-]{36}"/g, '"messageId":"<message-id>"')

const FIRST = 'My wife and I want to buy our first home next year.'
const turnPath = (caseId: string) => `/api/cases/${caseId}/turns`
const turn = (message: string) => ({ trigger: 'message', message })

describe('POST /api/cases/:caseId/turns', () => {
  it('runs one full turn: gate, stage, message, facts, events and frame order', async () => {
    const visitor = await startVisitor(app)

    const reply = await requestRaw(app, turnPath(visitor.caseId), {
      token: visitor.user.token,
      body: turn(FIRST),
    })
    expect(reply.status).toBe(200)
    expect(reply.headers.get('content-type')).toBe('text/event-stream')
    expect(reply.headers.get('x-accel-buffering')).toBe('no')

    const frames = sseFrames(reply.text)
    const types = frames.map((f) => f.type)

    // Order: the spoken text first, then cards, then the status invalidation, then done.
    const firstNonText = types.findIndex((t) => t !== 'text_delta')
    expect(firstNonText).toBeGreaterThan(0)
    expect(types.slice(0, firstNonText).every((t) => t === 'text_delta')).toBe(true)
    expect(types.at(-1)).toBe('done')
    expect(types.at(-2)).toBe('status')
    expect(types.filter((t) => t === 'done')).toHaveLength(1)
    expect(types).not.toContain('error')
    // The first message a customer types owes them the data notice.
    expect(frames.filter((f) => f.type === 'card').map((c) => c.card.type)).toEqual(['data_notice'])
    expect(types.indexOf('card')).toBeGreaterThan(types.lastIndexOf('text_delta'))

    const spoken = frames
      .filter((f) => f.type === 'text_delta')
      .map((f) => f.text)
      .join('')
    expect(spoken.startsWith('First home with your wife')).toBe(true)

    const status = frames.find((f) => f.type === 'status')
    expect(status.caseId).toBe(visitor.caseId)
    expect(status.invalidate).toContain('facts')

    // Gate: the customer's message is stored with the category it was admitted under.
    const messages = await rowsInOrder('messages', visitor.caseId)
    const byRole = (role: string) => messages.filter((m) => m.role === role)
    expect(byRole('customer')).toHaveLength(1)
    expect(byRole('customer')[0].content).toBe(FIRST)
    expect(byRole('customer')[0].gate_category).toBe('banking')

    // Persist: Saoirse's reply is exactly what was streamed, and `done` points at it.
    expect(byRole('assistant')).toHaveLength(1)
    expect(byRole('assistant')[0].content).toBe(spoken.trim())
    const done = frames.at(-1)
    expect(done.messageId).toBe(byRole('assistant')[0].id)
    expect(done.gateCategory).toBe('banking')

    // Facts the script recorded, with provenance.
    const facts = await rows('facts', visitor.caseId)
    expect(facts.map((f) => f.key).sort()).toEqual([
      'goals.primaryObjective',
      'household.buyingWith',
      'housing.firstTimeBuyer',
    ])
    expect(facts.every((f) => f.source === 'customer_stated' && f.superseded_by === null)).toBe(
      true,
    )

    // Events: the notice once, one per recorded fact, and the model's turn summary last.
    const events = await rowsInOrder('events', visitor.caseId)
    const eventTypes = events.map((e) => e.type)
    expect(eventTypes.filter((t) => t === 'data_notice_shown')).toHaveLength(1)
    expect(eventTypes.filter((t) => t === 'context_captured')).toHaveLength(3)
    expect(eventTypes.at(-1)).toBe('turn_tools')
    expect(eventTypes).not.toContain('request_blocked')
    expect(
      events.filter((e) => e.type === 'context_captured').every((e) => e.actor === 'model'),
    ).toBe(true)
  })

  it('writes the same bytes the Edge Function wrote for the same conversation', async () => {
    const visitor = await startVisitor(app)
    const token = visitor.user.token

    const first = await requestRaw(app, turnPath(visitor.caseId), { token, body: turn(FIRST) })
    const second = await requestRaw(app, turnPath(visitor.caseId), {
      token,
      body: turn("Yeah I'd like to get a plan together."),
    })

    expect(first.headers.get('content-type')).toBe(recording.contentType)
    expect(normalise(first.text, visitor.caseId)).toBe(recording.turns[0])
    expect(normalise(second.text, visitor.caseId)).toBe(recording.turns[1])
  })

  it('advances the script with the conversation and does not repeat the notice', async () => {
    const visitor = await startVisitor(app)
    const token = visitor.user.token

    await requestRaw(app, turnPath(visitor.caseId), { token, body: turn(FIRST) })
    const second = await requestRaw(app, turnPath(visitor.caseId), {
      token,
      body: turn("Yeah I'd like to get a plan together."),
    })
    expect(second.status).toBe(200)
    const frames = sseFrames(second.text)
    expect(frames.at(-1).type).toBe('done')
    expect(frames.filter((f) => f.type === 'card')).toHaveLength(0)
    expect(
      frames.some((f) => f.type === 'text_delta' && f.text.startsWith("Good, we'll build it")),
    ).toBe(true)

    const messages = await rowsInOrder('messages', visitor.caseId)
    expect(messages.map((m) => m.role)).toEqual(['customer', 'assistant', 'customer', 'assistant'])
    const notices = (await rowsInOrder('events', visitor.caseId)).filter(
      (e) => e.type === 'data_notice_shown',
    )
    expect(notices).toHaveLength(1)

    // Past the end of the script the failure is an `error` frame inside a 200 stream, and the
    // customer's message is not stored (the model is chosen before the save).
    const third = await requestRaw(app, turnPath(visitor.caseId), {
      token,
      body: turn('And then?'),
    })
    expect(third.status).toBe(200)
    const failed = sseFrames(third.text)
    expect(failed.map((f) => f.type)).toEqual(['error'])
    expect(failed[0].error.code).toBe('upstream_unavailable')
    expect(await rowsInOrder('messages', visitor.caseId)).toHaveLength(4)
  })

  it('answers a refused turn with the canned reply and never lets the model speak', async () => {
    const visitor = await startVisitor(app)
    const service = serviceClient()

    // The deterministic refusal available without a classifier: the global kill switch.
    await service.from('domain_config').update({ kill_switch: true }).eq('scope', 'global')
    let reply
    try {
      reply = await requestRaw(app, turnPath(visitor.caseId), {
        token: visitor.user.token,
        body: turn(FIRST),
      })
    } finally {
      await service.from('domain_config').update({ kill_switch: false }).eq('scope', 'global')
    }

    expect(reply.status).toBe(200)
    const frames = sseFrames(reply.text)
    expect(frames.at(0).type).toBe('text_delta')
    expect(frames.at(0).text).toBe('The demo is paused at the moment.')
    expect(frames.at(-1).type).toBe('done')
    expect(frames.at(-1).gateCategory).toBe('unsupported')
    // No status frame: nothing about the case changed.
    expect(frames.some((f) => f.type === 'status')).toBe(false)

    const messages = await rowsInOrder('messages', visitor.caseId)
    expect(messages.map((m) => [m.role, m.gate_category])).toEqual([
      ['customer', 'unsupported'],
      ['assistant', null],
    ])
    expect(messages[1].content).toBe('The demo is paused at the moment.')

    expect(await rows('facts', visitor.caseId)).toHaveLength(0)
    const events = await rowsInOrder('events', visitor.caseId)
    expect(events.some((e) => e.type === 'turn_tools' || e.type === 'context_captured')).toBe(false)
    const blocked = events.find((e) => e.type === 'request_blocked')
    expect(blocked.actor).toBe('system')
    expect(blocked.payload.reason).toBe('demo_paused')
    expect(blocked.payload.category).toBe('unsupported')
    expect(blocked.payload.request).toBe(FIRST)
  })

  it('refuses unauthenticated and unauthorised callers before anything runs', async () => {
    const visitor = await startVisitor(app)
    const stranger = await startVisitor(app)
    const partner = await addPartner(visitor.caseId)

    const none = await requestRaw(app, turnPath(visitor.caseId), { body: turn(FIRST) })
    expect(none.status).toBe(401)
    expect(JSON.parse(none.text).error.code).toBe('unauthorised')
    expect(none.headers.get('content-type')).toContain('application/json')

    const forged = await requestRaw(app, turnPath(visitor.caseId), {
      token: 'not-a-jwt',
      body: turn(FIRST),
    })
    expect(forged.status).toBe(401)

    // A stranger learns nothing about whether the case exists.
    const other = await requestRaw(app, turnPath(visitor.caseId), {
      token: stranger.user.token,
      body: turn(FIRST),
    })
    expect(other.status).toBe(404)
    expect(errorCode({ status: other.status, body: JSON.parse(other.text) })).toBe('not_found')

    // Invariant 7: a partner never drives the primary's conversation.
    const asPartner = await requestRaw(app, turnPath(visitor.caseId), {
      token: partner.user.token,
      body: turn(FIRST),
    })
    expect(asPartner.status).toBe(403)

    const missing = await requestRaw(app, turnPath(NO_SUCH_ID), {
      token: visitor.user.token,
      body: turn(FIRST),
    })
    expect(missing.status).toBe(404)

    const badBody = await requestRaw(app, turnPath(visitor.caseId), {
      token: visitor.user.token,
      body: { trigger: 'sing' },
    })
    expect(badBody.status).toBe(400)

    // None of it left a trace on the case.
    expect(await rowsInOrder('messages', visitor.caseId)).toHaveLength(0)
    expect((await rowsInOrder('events', visitor.caseId)).map((e) => e.type)).toEqual([
      'case_created',
    ])
  })
})
