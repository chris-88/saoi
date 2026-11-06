import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../context.ts'
import { ApiError } from '../errors.ts'

export type RateLimitOptions = {
  readonly max: number
  readonly windowMs: number
  /** For tests. */
  readonly now?: () => number
}

const SWEEP_AT = 10_000

/**
 * Fixed-window limit per authenticated user, held in this process. It is the hook: one
 * replica, one counter. A shared store replaces `windows` when the service scales out. Mount it
 * after `requireAuth`, which is what puts the user on the context.
 */
export function rateLimit({ max, windowMs, now = Date.now }: RateLimitOptions) {
  const windows = new Map<string, { resetAt: number; count: number }>()

  return createMiddleware<AppEnv>(async (c, next) => {
    const at = now()
    if (windows.size > SWEEP_AT) {
      for (const [key, entry] of windows) if (entry.resetAt <= at) windows.delete(key)
    }
    const key = c.get('user').id
    let entry = windows.get(key)
    if (entry === undefined || entry.resetAt <= at) {
      entry = { resetAt: at + windowMs, count: 0 }
      windows.set(key, entry)
    }
    entry.count += 1
    if (entry.count > max) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - at) / 1000))))
      throw new ApiError('rate_limited', 'Too many requests. Try again shortly.')
    }
    await next()
  })
}
