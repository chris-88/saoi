import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../context.ts'

/** One log line per request: method, path (never the query string), status, duration. */
export const accessLog = createMiddleware<AppEnv>(async (c, next) => {
  const started = performance.now()
  await next()
  c.get('log').info('request', {
    requestId: c.get('requestId'),
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Math.round(performance.now() - started),
    userId: c.get('user')?.id,
  })
})
