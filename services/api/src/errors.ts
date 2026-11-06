import { ERROR_CODES, statusFor, type ErrorCode } from '@shared/contracts/common.ts'

export { ERROR_CODES }
export type { ErrorCode }

/**
 * The only way a handler or middleware reports a failure. `message` is written to be shown to
 * the caller, so never put a table name, query or upstream message in it; those go in `cause`,
 * which is logged and never returned.
 */
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details: readonly string[] | undefined

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: readonly string[]; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ApiError'
    this.code = code
    this.status = statusFor(code)
    this.details = options.details
  }
}

export type ErrorBody = {
  readonly ok: false
  readonly error: {
    readonly code: ErrorCode
    readonly message: string
    readonly details?: string[]
    readonly requestId?: string
  }
}

export function errorBody(error: ApiError, requestId: string | undefined): ErrorBody {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: [...error.details] }),
      ...(requestId === undefined ? {} : { requestId }),
    },
  }
}
