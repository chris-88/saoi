import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../context.ts'
import { ApiError } from '../errors.ts'

/** The caller must hold a partner seat; the case it is on is theirs and nobody else's. */
export const requirePartner = createMiddleware<AppEnv>(async (c, next) => {
  const seat = await c.get('partners').partnerSession(c.get('user').id)
  if (seat === null) throw new ApiError('forbidden', 'This is not your invitation.')
  c.set('partner', seat)
  await next()
})
