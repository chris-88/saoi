/**
 * Notifications against a real database. Needs the harness to configure a (dummy) VAPID key;
 * with no subscriptions nothing is sent, so no network is touched.
 */
import { describe, expect, it } from 'vitest'
import { anonymousUser, buildApp, emailUser, request, rows, startVisitor } from '../harness.ts'

const app = buildApp()

describe('admin notification route', () => {
  it('refuses a non-administrator', async () => {
    const visitor = await startVisitor(app)
    const stranger = await anonymousUser()
    for (const token of [visitor.user.token, stranger.token]) {
      const reply = await request(app, 'POST', `/api/admin/cases/${visitor.caseId}/notifications`, {
        token,
        body: {},
      })
      expect(reply.status).toBe(403)
    }
  })

  it('writes a single-use link and an event, and delivers to nobody when nobody subscribed', async () => {
    const admin = await emailUser({ admin: true })
    const visitor = await startVisitor(app)
    const reply = await request(app, 'POST', `/api/admin/cases/${visitor.caseId}/notifications`, {
      token: admin.token,
      body: { title: 'Hello', body: 'Something changed.' },
    })
    expect(reply.status).toBe(200)
    expect(reply.body).toMatchObject({
      message: 'Something changed.',
      subscriptions: 0,
      delivered: 0,
    })
    expect(reply.body.url).toMatch(/\/#\/\?n=[0-9a-f]{32}$/)

    const tokens = await rows('tokens', visitor.caseId)
    expect(tokens.filter((token) => token.kind === 'notification')).toHaveLength(1)
    const events = await rows('events', visitor.caseId)
    expect(events.find((event) => event.type === 'notification_sent')?.payload).toMatchObject({
      channel: 'push',
      subscriptions: 0,
      delivered: 0,
      title: 'Hello',
    })
  })
})
