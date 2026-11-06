import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../context.ts'
import { ApiError } from '../errors.ts'

/**
 * The admin API's guard. After the JWT check, the caller must have a row in `admin_users`,
 * else 403. It runs before any body is validated: the Edge Function parsed the body first, so a
 * stranger could tell a valid request shape from an invalid one. Here a non-admin learns
 * nothing but 403, whatever they send.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const allowed = await c.get('admin').access.isAdmin(c.get('user').id)
  if (!allowed) throw new ApiError('forbidden', 'You are not an administrator.')
  await next()
})
