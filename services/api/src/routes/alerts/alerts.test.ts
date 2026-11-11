import { describe, expect, it } from 'vitest'
// The app first: it loads @hono/zod-openapi, which has to extend zod before any shared schema
// is built.
import { createApp } from '../../app.ts'
import { caseAlertsResponseSchema, reminderSchema } from '@shared/contracts/alerts.ts'
import type { PlanAlert, Reminder } from '@shared/contracts/alerts.ts'
import type {
  AlertDraft,
  ClaimedPlanRef,
  ProductChange,
  ReminderRef,
} from '@shared/domain/market/alerts.ts'
import { MARKET_FIXTURE } from '@shared/domain/market/fixture.ts'
import { normaliseMarket } from '@shared/domain/market/normalise.ts'
import { createLogger } from '../../log.ts'
import { createTokenVerifier } from '../../middleware/auth.ts'
import { type AlertStore, pairChanges } from '../../store/alerts.ts'
import { CASE_ID, OTHER_CASE_ID, SECRET, fakeStore, fakeStores, tokenFor } from '../../testing.ts'
import type { AlertPush } from './run.ts'

const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })
const KEY = 'internal-key-for-tests'
const NOW = Date.parse('2026-12-31T08:00:00Z')

/** An in-memory alert store with the database's idempotency rules. */
function fakeAlertStore(init: {
  changes?: ProductChange[]
  plans?: ClaimedPlanRef[]
  reminders?: ReminderRef[]
  lastThroughAt?: string | null
}) {
  const alerts: (PlanAlert & { caseId: string })[] = []
  const reminders: (Reminder & { caseId: string; deleted: boolean })[] = []
  const runs: string[] = []
  const sent: string[] = []
  let seq = 0
  const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
  const store: AlertStore = {
    lastThroughAt: () => Promise.resolve(runs.at(-1) ?? init.lastThroughAt ?? null),
    earliestClaimedAt: () => Promise.resolve('2026-11-01T00:00:00.000Z'),
    changesBetween: () => Promise.resolve(runs.length === 0 ? (init.changes ?? []) : []),
    claimedPlans: () => Promise.resolve(init.plans ?? []),
    openReminders: () => Promise.resolve(init.reminders ?? []),
    sentStages: () =>
      Promise.resolve(
        new Set(
          alerts.flatMap((a) =>
            a.reminderId === null ? [] : [`${a.reminderId}:${String(a.stage)}`],
          ),
        ),
      ),
    insertAlerts: (drafts: readonly AlertDraft[]) => {
      const inserted = drafts.flatMap((draft) => {
        const dup = alerts.some(
          (a) =>
            (draft.productVersion !== null &&
              a.caseId === draft.caseId &&
              a.data['version'] === draft.productVersion) ||
            (draft.reminderId !== null &&
              a.reminderId === draft.reminderId &&
              a.stage === draft.stage),
        )
        if (dup) return []
        const alert = {
          id: id(),
          caseId: draft.caseId,
          kind: draft.kind,
          productId: draft.productId,
          reminderId: draft.reminderId,
          stage: draft.stage,
          title: draft.title,
          body: draft.body,
          data: { ...draft.data, version: draft.productVersion },
          createdAt: new Date(NOW).toISOString(),
          sentAt: null,
          seenAt: null,
        }
        alerts.push(alert)
        return [{ caseId: draft.caseId, alert }]
      })
      return Promise.resolve(inserted)
    },
    markSent: (alertId) => {
      sent.push(alertId)
      return Promise.resolve()
    },
    recordRun: (throughAt) => {
      runs.push(throughAt)
      return Promise.resolve()
    },
    listForCase: (caseId) =>
      Promise.resolve({
        // Extra keys (caseId, deleted) are what the database row has too; the schema strips them.
        alerts: alerts.filter((a) => a.caseId === caseId),
        reminders: reminders.filter((r) => r.caseId === caseId && !r.deleted),
      }),
    markSeen: (caseId, ids) => {
      for (const a of alerts)
        if (a.caseId === caseId && ids.includes(a.id)) a.seenAt ??= new Date(NOW).toISOString()
      return Promise.resolve()
    },
    createReminder: (input) => {
      const reminder = {
        id: id(),
        caseId: input.caseId,
        kind: input.kind,
        label: input.label,
        dueOn: input.dueOn,
        productId: input.productId ?? null,
        createdAt: new Date(NOW).toISOString(),
        deleted: false,
      }
      reminders.push(reminder)
      return Promise.resolve(reminder)
    },
    deleteReminder: (caseId, reminderId) => {
      const found = reminders.find((r) => r.caseId === caseId && r.id === reminderId && !r.deleted)
      if (found) found.deleted = true
      return Promise.resolve(found !== undefined)
    },
  }
  return { store, alerts, runs, sent }
}

const PLAN: ClaimedPlanRef = {
  caseId: CASE_ID,
  builtAt: '2026-11-01T10:00:00.000Z',
  products: [
    {
      provider: 'boi',
      source: 'bank',
      productId: 'savings.supersaver',
      providerName: 'Bank of Ireland',
      productName: 'SuperSaver',
      ratePct: 3,
    },
  ],
}
const CHANGE: ProductChange = {
  provider: 'boi',
  source: 'bank',
  productId: 'savings.supersaver',
  previousVersionId: 41,
  currentVersionId: 57,
  previousRate: 3,
  currentRate: 2.75,
  effectiveFrom: '2026-11-10',
  changedAt: '2026-11-11T07:00:00.000Z',
  sourceUrl: 'https://personalbanking.bankofireland.com/savings',
  checkedAt: '2026-11-11T07:00:00.000Z',
  withdrawn: false,
}
const REMINDER: ReminderRef = {
  id: '9f8b0c7e-0000-4000-8000-000000000001',
  caseId: CASE_ID,
  kind: 'fixed_rate_ends',
  label: 'AIB fixed rate',
  dueOn: '2027-03-01',
}

function appWith(
  fake: ReturnType<typeof fakeAlertStore>,
  options: { key?: string; push?: AlertPush } = {},
) {
  return createApp({
    verifyToken,
    store: fakeStore(),
    ...fakeStores(),
    version: 'test',
    log: createLogger(() => undefined),
    alerts: {
      store: fake.store,
      market: () => Promise.resolve(normaliseMarket(MARKET_FIXTURE)),
      internalKey: options.key ?? KEY,
      now: () => NOW,
      ...(options.push === undefined ? {} : { push: options.push }),
    },
  })
}

const run = (app: ReturnType<typeof appWith>, key?: string) =>
  app.request('/api/internal/alerts/run', {
    method: 'POST',
    headers: key === undefined ? {} : { 'X-Internal-Key': key },
  })

describe('the alerts run', () => {
  it('is not there without a key configured, and refuses a wrong key', async () => {
    const fake = fakeAlertStore({})
    expect((await run(appWith(fake, { key: '' }), 'anything')).status).toBe(404)
    expect((await run(appWith(fake))).status).toBe(401)
    expect((await run(appWith(fake), 'wrong-key-wrong-key')).status).toBe(401)
    expect(fake.runs).toEqual([])
  })

  it('raises rate and reminder alerts once, pushes them, and records the run', async () => {
    const fake = fakeAlertStore({ changes: [CHANGE], plans: [PLAN], reminders: [REMINDER] })
    const pushes: string[] = []
    const app = appWith(fake, {
      push: ({ title }) => {
        pushes.push(title)
        return Promise.resolve({ delivered: title.startsWith('Your') ? 1 : 0 })
      },
    })
    const first = await run(app, KEY)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({
      throughAt: new Date(NOW).toISOString(),
      changes: 1,
      plans: 1,
      rateAlerts: 1,
      reminderAlerts: 1,
      pushed: 1,
      pushFailed: 1,
    })
    expect(pushes).toEqual(['A rate in your plan changed', 'Your fixed rate ends in 60 days'])
    expect(fake.sent).toHaveLength(1)
    expect(fake.alerts.map((alert) => alert.body)).toEqual([
      'Bank of Ireland SuperSaver: 3.00% to 2.75% from 10 Nov 2026 (bank’s site, read 11 Nov). Your plan counted 3.00%.',
      expect.stringMatching(
        /^On 1 Mar 2027, as you told Saoirse\. Today \d+ lenders list fixed mortgage rates from /,
      ),
    ])

    const second = await run(app, KEY)
    expect(await second.json()).toMatchObject({ rateAlerts: 0, reminderAlerts: 0, pushed: 0 })
    expect(fake.alerts).toHaveLength(2)
    expect(fake.runs).toHaveLength(2)
  })

  it('never fails the run on a push failure', async () => {
    const fake = fakeAlertStore({ changes: [CHANGE], plans: [PLAN] })
    const app = appWith(fake, { push: () => Promise.reject(new Error('push service down')) })
    const response = await run(app, KEY)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ rateAlerts: 1, pushed: 0, pushFailed: 1 })
    expect(fake.sent).toEqual([])
    expect(fake.runs).toHaveLength(1)
  })
})

describe('a case’s alerts and reminders', () => {
  const auth = async () => ({ Authorization: `Bearer ${await tokenFor()}` })

  it('lists alerts and reminders, marking the alerts seen', async () => {
    const fake = fakeAlertStore({ changes: [CHANGE], plans: [PLAN] })
    const app = appWith(fake)
    await run(app, KEY)
    const response = await app.request(`/api/cases/${CASE_ID}/alerts`, { headers: await auth() })
    expect(response.status).toBe(200)
    const body = caseAlertsResponseSchema.parse(await response.json())
    expect(body.alerts).toHaveLength(1)
    expect(fake.alerts[0]?.seenAt).not.toBeNull()
  })

  it('sets and deletes a reminder, refusing a past date and a stranger’s case', async () => {
    const fake = fakeAlertStore({})
    const app = appWith(fake)
    const post = async (caseId: string, body: unknown) =>
      app.request(`/api/cases/${caseId}/reminders`, {
        method: 'POST',
        headers: { ...(await auth()), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const created = await post(CASE_ID, {
      kind: 'fixed_rate_ends',
      label: 'AIB fixed rate',
      dueOn: '2027-03-01',
    })
    expect(created.status).toBe(201)
    const reminder = reminderSchema.parse(await created.json())

    expect((await post(CASE_ID, { kind: 'other', label: 'x', dueOn: '2026-12-30' })).status).toBe(
      400,
    )
    expect(
      (await post(CASE_ID, { kind: 'other', label: 'x'.repeat(121), dueOn: '2027-01-01' })).status,
    ).toBe(400)
    expect(
      (await post(OTHER_CASE_ID, { kind: 'other', label: 'x', dueOn: '2027-01-01' })).status,
    ).toBe(404)

    const listed = caseAlertsResponseSchema.parse(
      await (await app.request(`/api/cases/${CASE_ID}/alerts`, { headers: await auth() })).json(),
    )
    expect(listed.reminders.map((r) => r.id)).toEqual([reminder.id])

    const del = (id: string) =>
      app.request(`/api/cases/${CASE_ID}/reminders/${id}`, { method: 'DELETE', headers: {} })
    expect((await del(reminder.id)).status).toBe(401)
    const deleted = await app.request(`/api/cases/${CASE_ID}/reminders/${reminder.id}`, {
      method: 'DELETE',
      headers: await auth(),
    })
    expect(deleted.status).toBe(204)
    const again = await app.request(`/api/cases/${CASE_ID}/reminders/${reminder.id}`, {
      method: 'DELETE',
      headers: await auth(),
    })
    expect(again.status).toBe(404)
  })
})

describe('pairing market versions', () => {
  const row = (over: Partial<Parameters<typeof pairChanges>[0][number]>) => ({
    id: 1,
    provider: 'boi',
    source: 'bank',
    product_id: 'savings.supersaver',
    rates: { kind: 'deposit', aerPct: 3, basis: 'fixed' },
    source_url: 'https://personalbanking.bankofireland.com/savings',
    effective_from: null,
    first_seen_at: '2026-11-01T07:00:00+00:00',
    checked_at: '2026-11-04T07:00:00+00:00',
    superseded_at: null,
    ...over,
  })

  it('pairs a superseded version with its successor, and marks one with none withdrawn', () => {
    const changes = pairChanges(
      [
        row({ id: 41, superseded_at: '2026-11-11T07:00:00+00:00' }),
        row({
          id: 42,
          product_id: 'savings.goalsaver',
          superseded_at: '2026-11-11T07:05:00+00:00',
        }),
      ],
      [
        row({
          id: 57,
          rates: { kind: 'deposit', aerPct: 2.75, basis: 'fixed' },
          effective_from: '2026-11-10',
          first_seen_at: '2026-11-11T07:00:00+00:00',
          checked_at: '2026-11-11T07:00:00+00:00',
        }),
      ],
    )
    expect(changes).toEqual([
      expect.objectContaining({
        previousVersionId: 41,
        currentVersionId: 57,
        previousRate: 3,
        currentRate: 2.75,
        effectiveFrom: '2026-11-10',
        withdrawn: false,
      }),
      expect.objectContaining({
        productId: 'savings.goalsaver',
        currentVersionId: null,
        currentRate: null,
        withdrawn: true,
      }),
    ])
  })
})
