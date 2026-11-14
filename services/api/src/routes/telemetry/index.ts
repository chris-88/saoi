import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { mcpCallBodySchema } from '@shared/contracts/telemetry.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError, errorBody } from '../../errors.ts'
import type { TelemetryStore } from '../../store/telemetry.ts'
import { INTERNAL_KEY_HEADER } from '../alerts/index.ts'
import { isPresenter as sameKey } from '../session/presenter.ts'

/**
 * `POST /api/telemetry/mcp`: the Saoi MCP server records one call (design
 * `2026-11-14-saoi-ai-usage-analytics-design`). A machine route, like the alerts run: not in the
 * OpenAPI document, no user token, the internal key in `X-Internal-Key`, and 404 when no key is
 * set. One insert, no reads.
 */

export const TELEMETRY_ROUTE_PREFIX = '/api/telemetry/'
const TELEMETRY_MAX_BYTES = 16 * 1024

export type TelemetryRouteOptions = {
  readonly store: TelemetryStore
  /** `INTERNAL_JOB_KEY`. Empty: the route answers 404. */
  readonly internalKey: string
}

export function telemetryRoutes(options: TelemetryRouteOptions) {
  const routes = new Hono<AppEnv>()

  routes.post(
    `${TELEMETRY_ROUTE_PREFIX}mcp`,
    async (c, next) => {
      if (options.internalKey.length === 0) throw new ApiError('not_found', 'No such route.')
      if (!sameKey(options.internalKey, c.req.header(INTERNAL_KEY_HEADER))) {
        throw new ApiError('unauthorised', 'The internal key is missing or wrong.')
      }
      await next()
    },
    bodyLimit({
      maxSize: TELEMETRY_MAX_BYTES,
      onError: (c) =>
        c.json(
          errorBody(
            new ApiError('bad_request', 'The record is too large.'),
            c.get('requestId') as string | undefined,
          ),
          413,
        ),
    }),
    async (c) => {
      const raw: unknown = await c.req.json().catch(() => undefined)
      const parsed = mcpCallBodySchema.safeParse(raw)
      if (!parsed.success) {
        throw new ApiError('bad_request', 'The record is not valid.', {
          details: parsed.error.issues.map(
            (issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`,
          ),
        })
      }
      await options.store.record(parsed.data)
      return c.body(null, 204)
    },
  )

  return routes
}
