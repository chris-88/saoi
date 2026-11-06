import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CASE_ID } from '../../testing.ts'
import { PLAN_ID, writesOf } from '../../testing.actions.ts'
import { world } from './actions.fixture.ts'

describe('POST /plans/:planId/decisions', () => {
  it('keeping a plan agrees its target as a fact', async () => {
    const { call, actions } = world()
    const got = await call('primary', `/plans/${PLAN_ID}/decisions`, { decision: 'keep' })
    expect(got.body).toMatchObject({ summary: 'Kept "First home" as a plan.' })
    expect(writesOf(actions)).toMatchObject([
      {
        name: 'savePlanDecision',
        args: {
          caseId: CASE_ID,
          status: 'active',
          keep: true,
          goalTarget: 40000,
          primaryId: 'participant-primary',
          partnerId: null,
          eventType: 'plan_created',
        },
      },
    ])
  })

  it.each([
    ['abandon', 'abandoned', 'plan_abandoned', 'Dropped "First home".'],
    ['not_now', 'abandoned', 'plan_abandoned', 'Dropped "First home".'],
  ] as const)('%s drops it and records no fact', async (decision, status, eventType, summary) => {
    const { call, actions } = world()
    const got = await call('primary', `/plans/${PLAN_ID}/decisions`, { decision })
    expect(got.body).toMatchObject({ summary })
    expect(writesOf(actions)).toMatchObject([
      { args: { status, eventType, keep: false, goalTarget: null } },
    ])
  })

  it('pauses and resumes along the plan transition table', async () => {
    const { call, actions } = world()
    if (actions.plan) actions.plan = { ...actions.plan, status: 'active' }
    const paused = await call('primary', `/plans/${PLAN_ID}/decisions`, { decision: 'pause' })
    expect(paused.body).toMatchObject({ summary: 'Paused "First home".' })

    if (actions.plan) actions.plan = { ...actions.plan, status: 'paused' }
    const resumed = await call('primary', `/plans/${PLAN_ID}/decisions`, { decision: 'resume' })
    expect(resumed.body).toMatchObject({ summary: 'Picked "First home" back up.' })
    expect(writesOf(actions).map((c) => (c.args as { eventType: string }).eventType)).toEqual([
      'plan_paused',
      'plan_resumed',
    ])
  })

  it('refuses a move the table forbids: an abandoned plan cannot be paused', async () => {
    const { call, actions } = world()
    if (actions.plan) actions.plan = { ...actions.plan, status: 'abandoned' }
    const got = await call('primary', `/plans/${PLAN_ID}/decisions`, { decision: 'pause' })
    expect(got.status).toBe(409)
    expect(got.body).toMatchObject({ error: { message: 'That plan cannot move from abandoned.' } })
    expect(writesOf(actions)).toEqual([])
  })

  it('404s a plan that is not on the case and 400s a decision it does not know', async () => {
    const { call, actions } = world()
    actions.plan = null
    expect(
      (await call('primary', `/plans/${PLAN_ID}/decisions`, { decision: 'keep' })).status,
    ).toBe(404)
    expect(
      (await call('primary', `/plans/${PLAN_ID}/decisions`, { decision: 'sell' })).status,
    ).toBe(400)
  })
})

describe('POST /invites', () => {
  it('mints a link whose hash is what the store keeps, and never sends it anywhere', async () => {
    const { call, actions } = world()
    const got = await call('primary', '/invites', { name: 'Emma' })
    expect(got.status).toBe(201)

    const body = got.body as { inviteUrl: string; summary: string }
    const token = body.inviteUrl.split('/#/join/')[1] ?? ''
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    expect(body.summary).toBe('Here is a link to pass to Emma. Nothing is sent until you share it.')
    // The store never sees the token itself (Invariant 8).
    expect(writesOf(actions)).toEqual([
      {
        name: 'invitePartner',
        args: {
          caseId: CASE_ID,
          name: 'Emma',
          tokenHash: createHash('sha256').update(token).digest('hex'),
        },
      },
    ])
  })

  it('inviting again gives a different link', async () => {
    const { call } = world()
    const first = (await call('primary', '/invites', { name: 'Emma' })).body as {
      inviteUrl: string
    }
    const second = (await call('primary', '/invites', { name: 'Emma' })).body as {
      inviteUrl: string
    }
    expect(second.inviteUrl).not.toBe(first.inviteUrl)
  })

  it('rejects an empty or very long name', async () => {
    const { call, actions } = world()
    expect((await call('primary', '/invites', { name: '' })).status).toBe(400)
    expect((await call('primary', '/invites', { name: 'x'.repeat(81) })).status).toBe(400)
    expect(actions.calls).toEqual([])
  })
})
