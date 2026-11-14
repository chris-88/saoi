import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { PERIODS, aiUsageSchema } from '@shared/contracts/admin.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'

/** The console's AI usage screen: calls to the Saoi MCP server and the link funnel. */

const aiUsageRoute = createRoute({
  method: 'get',
  path: '/api/admin/ai-usage',
  tags: ['admin'],
  summary: 'AI usage over a period',
  description:
    'Calls to the Saoi MCP server by assistant (claude, chatgpt, gemini, cursor, other) over the ' +
    'period, with the window before it: the link funnel from a call to a product chosen in the ' +
    'app, calls a day, the tools, what the home calculator’s gate held back, the unrecognised ' +
    'user agents and the recent calls, fifty a page (`cursor` from `nextCursor` for the next).',
  security,
  request: {
    query: z.object({
      period: z
        .enum(PERIODS)
        .default('7d')
        .openapi({ description: 'The window to count over.', example: '7d' }),
      cursor: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .openapi({ description: 'The `nextCursor` of the page before, for the recent calls.' }),
    }),
  },
  responses: {
    200: {
      description: 'The AI usage.',
      content: { 'application/json': { schema: aiUsageSchema.openapi('AdminAiUsage') } },
    },
    ...authenticatedErrors,
    400: errorResponse('The query is not valid, or the cursor is not one this route gave out.'),
    403: errorResponse('Not an administrator.'),
  },
})

export const aiUsageRoutes = new OpenAPIHono<AppEnv>().openapi(aiUsageRoute, async (c) => {
  const { period, cursor } = c.req.valid('query')
  const usage = await c.get('admin').aiUsage.aiUsage(period, cursor)
  if (usage === null) throw new ApiError('bad_request', 'The cursor is not valid.')
  return c.json(usage, 200)
})
