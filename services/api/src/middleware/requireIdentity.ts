import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../context.ts'
import { ApiError } from '../errors.ts'

/**
 * Loads the caller's account record. A token outlives the user it was minted for (purging the
 * project's auth users leaves every open tab holding one that still verifies), so a user who
 * no longer exists is a 401 here, which is what tells the browser to start again as somebody new.
 */
export const requireIdentity = createMiddleware<AppEnv>(async (c, next) => {
  const identity = await c.get('sessions').identity(c.get('user').id)
  if (identity === null) throw new ApiError('unauthorised', 'No session.')
  c.set('identity', identity)
  await next()
})
