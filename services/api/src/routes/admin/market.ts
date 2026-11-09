import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { marketProductListSchema } from '@shared/contracts/market.ts'
import type { AppEnv } from '../../context.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'

/** Market data the console lets a person verify. Read-only, so nothing here is audited. */

const marketProductsRoute = createRoute({
  method: 'get',
  path: '/api/admin/market-products',
  tags: ['admin'],
  summary: 'Market data read from provider websites and the CCPC comparison tables',
  description:
    'The current version of every provider product, or every version with `history=true`. Ordered by provider and product, newest version first.',
  security,
  request: {
    query: z.object({
      history: z
        .enum(['true', 'false'])
        .default('false')
        .transform((value) => value === 'true')
        .openapi({
          type: 'string',
          enum: ['true', 'false'],
          description: 'Include superseded versions.',
        }),
      provider: z
        .string()
        .regex(/^[a-z0-9_]+$/)
        .optional()
        .openapi({ description: 'Only this provider.', example: 'boi' }),
      source: z.enum(['bank', 'ccpc']).optional().openapi({
        description: 'Only rows read from this source: the provider site, or CCPC.',
        example: 'ccpc',
      }),
      productId: z
        .string()
        .regex(/^[a-z_]+(\.[a-z0-9_]+)+$/)
        .optional()
        .openapi({
          description: 'Only this product (all its versions are returned).',
          example: 'savings.supersaver',
        }),
    }),
  },
  responses: {
    200: {
      description: 'The market products.',
      content: {
        'application/json': { schema: marketProductListSchema.openapi('AdminMarketProductList') },
      },
    },
    ...authenticatedErrors,
    400: errorResponse('The query is not valid.'),
    403: errorResponse('Not an administrator.'),
  },
})

export const marketRoutes = new OpenAPIHono<AppEnv>().openapi(marketProductsRoute, async (c) => {
  const { history, provider, source, productId } = c.req.valid('query')
  // A product filter is a request for its history: a single current row would hide what changed.
  const all = history || productId !== undefined
  return c.json(
    await c.get('admin').market.list({ history: all, provider, source, productId }),
    200,
  )
})
