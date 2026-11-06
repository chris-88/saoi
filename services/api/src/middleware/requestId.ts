import { createMiddleware } from 'hono/factory'
import { randomUUID } from 'node:crypto'
import type { AppEnv } from '../context.ts'

export const REQUEST_ID_HEADER = 'X-Request-ID'

// Only a conservative shape is honoured, so a caller cannot inject lines into the logs.
const SAFE = /^[A-Za-z0-9._-]{1,128}$/

/** Honours a sane `X-Request-ID`, else generates one; echoes it on the response. */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header(REQUEST_ID_HEADER)
  const id = incoming !== undefined && SAFE.test(incoming) ? incoming : randomUUID()
  c.set('requestId', id)
  c.header(REQUEST_ID_HEADER, id)
  await next()
})
