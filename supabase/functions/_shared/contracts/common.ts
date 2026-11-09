import { z } from 'zod'

/**
 * Every Edge Function returns this envelope (CLAUDE.md > Zod). Types are inferred from the
 * schemas, never hand-written alongside them.
 */

export const ERROR_CODES = [
  'bad_request',
  'unauthorised',
  'forbidden',
  'not_found',
  'conflict',
  /** A link or code that was valid once and has run out (a plan claim link past its TTL). */
  'expired',
  'illegal_transition',
  'rate_limited',
  'upstream_unavailable',
  'demo_paused',
  'internal',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export const apiErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string().min(1),
  /** Field-level problems, when the failure was validation. */
  details: z.array(z.string()).optional(),
  /** Correlates a failure with the function log. Present on errors produced by `serveJson`. */
  requestId: z.string().optional(),
})

export type ApiError = z.infer<typeof apiErrorSchema>

export function apiResultSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: apiErrorSchema }),
  ])
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data })

export const fail = (
  code: ErrorCode,
  message: string,
  details?: readonly string[],
): ApiResult<never> => ({
  ok: false,
  error: { code, message, ...(details === undefined ? {} : { details: [...details] }) },
})

/** HTTP status for an error code, so every function answers consistently. */
export function statusFor(code: ErrorCode): number {
  switch (code) {
    case 'bad_request':
      return 400
    case 'unauthorised':
      return 401
    case 'forbidden':
      return 403
    case 'not_found':
      return 404
    case 'conflict':
    case 'illegal_transition':
      return 409
    case 'expired':
      return 410
    case 'rate_limited':
      return 429
    case 'upstream_unavailable':
      return 502
    case 'demo_paused':
      return 503
    case 'internal':
      return 500
  }
}
