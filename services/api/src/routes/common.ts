import { z } from '@hono/zod-openapi'
import { ERROR_CODES } from '../errors.ts'

/** The envelope every failure uses. Registered once, so clients get one `ErrorResponse` type. */
export const errorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z.object({
      code: z.enum(ERROR_CODES),
      message: z.string(),
      details: z.array(z.string()).optional(),
      requestId: z
        .string()
        .optional()
        .openapi({ description: 'Quote this when reporting a problem.' }),
    }),
  })
  .openapi('ErrorResponse')

export const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: errorResponseSchema } },
})

export const security = [{ bearerAuth: [] }]

/** Responses every authenticated route can give; spread into `responses`. */
export const authenticatedErrors = {
  401: errorResponse('Missing or invalid token.'),
  429: errorResponse('Too many requests. See `Retry-After`.'),
}
