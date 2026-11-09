import { createApp, type AppDeps } from '../../app.ts'
import { createLogger } from '../../log.ts'
import { createTokenVerifier } from '../../middleware/auth.ts'
import type { AdminStores } from '../../store/admin/index.ts'
import { ADMIN_ID, SECRET, USER_ID, fakeStore, fakeStores, tokenFor } from '../../testing.ts'

export { ADMIN_ID, USER_ID }

/** A store that fails loudly when a test did not mean to touch it. */
const unmocked = <T extends object>(name: string): T =>
  new Proxy({} as T, {
    get: (_target, key) => () => {
      throw new Error(`admin.${name}.${String(key)} was called but not faked`)
    },
  })

/**
 * The app with the admin API mounted over fake stores. Pass only the stores a test uses; the
 * rest throw if touched. `ADMIN_ID` is an administrator, everyone else is not.
 *
 *   const { send } = adminTestApp({ config: { ...fake } })
 *   await send('admin', 'POST', '/api/admin/...', body)   // 'admin' | 'user' | 'anonymous'
 */
export function adminTestApp(stores: Partial<AdminStores> = {}, overrides: Partial<AppDeps> = {}) {
  const admin: AdminStores = {
    access: { isAdmin: (userId) => Promise.resolve(userId === ADMIN_ID) },
    cases: unmocked('cases'),
    catalogue: unmocked('catalogue'),
    config: unmocked('config'),
    forms: unmocked('forms'),
    inspect: unmocked('inspect'),
    market: unmocked('market'),
    overview: unmocked('overview'),
    push: unmocked('push'),
    simulate: unmocked('simulate'),
    ...stores,
  }
  const app = createApp({
    verifyToken: createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' }),
    store: fakeStore(),
    ...fakeStores(),
    admin,
    version: 'test',
    log: createLogger(() => undefined),
    ...overrides,
  })

  const send = async (
    as: 'admin' | 'user' | 'anonymous',
    method: string,
    path: string,
    body?: unknown,
  ) => {
    const headers: Record<string, string> = {}
    if (as !== 'anonymous') {
      const sub = as === 'admin' ? ADMIN_ID : USER_ID
      headers['Authorization'] = `Bearer ${await tokenFor({ sub })}`
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    return app.request(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  return { app, admin, send }
}
