import { createApp } from '../../app.ts'
import { createTokenVerifier } from '../../middleware/auth.ts'
import {
  ADMIN_ID,
  CASE_ID,
  PARTNER_ID,
  SECRET,
  STRANGER_ID,
  USER_ID,
  fakeStore,
  fakeStores,
  tokenFor,
} from '../../testing.ts'
import {
  APP_ID,
  LINKED_ID,
  MESSAGE_ID,
  PLAN_ID,
  application,
  loadedCase,
} from '../../testing.actions.ts'

/** What the case action route tests share: an app with the fake stores, and a populated case. */

const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })

export const PROTECTION_APP_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
export const LOAN_APP_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

/** A case the primary, a partner and an administrator all have a seat or a role on. */
export function world() {
  const store = fakeStore({
    access: { [USER_ID]: [CASE_ID] },
    partners: { [PARTNER_ID]: [CASE_ID] },
    admins: [ADMIN_ID],
  })
  const actions = store.actions
  actions.loaded = loadedCase(CASE_ID, {
    applications: [
      application('current_account', 'waiting_customer', APP_ID),
      application('protection', 'waiting_customer', PROTECTION_APP_ID),
    ],
    linkedAccounts: [
      {
        id: LINKED_ID,
        bank: 'aib',
        displayName: 'Current',
        accountType: 'current',
        iban: 'IE00AIBK00000000000000',
        balance: 1000,
        consentScope: ['balances', 'payments'],
        consentExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        createdAt: '2026-11-01T10:00:00.000Z',
        transactions: [],
      },
    ],
  })
  actions.plan = { id: PLAN_ID, status: 'draft', title: 'First home', targetAmount: 40000 }
  const app = createApp({ verifyToken, store, ...fakeStores(), version: 'test' })

  const call = async (
    who: 'none' | 'primary' | 'partner' | 'admin' | 'stranger',
    path: string,
    body?: unknown,
  ) => {
    const sub = { primary: USER_ID, partner: PARTNER_ID, admin: ADMIN_ID, stranger: STRANGER_ID }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (who !== 'none') headers['Authorization'] = `Bearer ${await tokenFor({ sub: sub[who] })}`
    const response = await app.request(`/api/cases/${CASE_ID}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
    })
    const text = await response.text()
    return { status: response.status, body: (text ? JSON.parse(text) : null) as unknown }
  }

  return { app, store, actions, call }
}

export { APP_ID, LINKED_ID, MESSAGE_ID, PLAN_ID }
