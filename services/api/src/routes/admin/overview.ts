import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  PERIODS,
  adminOverviewSchema,
  analyticsSchema,
  collaboratorListSchema,
  feedbackListSchema,
} from '@shared/contracts/admin.ts'
import type { AppEnv } from '../../context.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'

/** The console's read-only screens: overview, analytics, feedback and collaborators. */

const forbidden = errorResponse('Not an administrator.')
const badQuery = errorResponse('The query is not valid.')

const periodQuery = (fallback: (typeof PERIODS)[number]) =>
  z.object({
    period: z
      .enum(PERIODS)
      .default(fallback)
      .openapi({ description: 'The window to count over.', example: fallback }),
  })

const overviewRoute = createRoute({
  method: 'get',
  path: '/api/admin/overview',
  tags: ['admin'],
  summary: 'Headline numbers, cases and activity',
  description: 'Was `admin` action `overview`.',
  security,
  request: {
    query: periodQuery('all').extend({
      caseId: z.uuid().optional().openapi({ description: 'The case the console is pointed at.' }),
    }),
  },
  responses: {
    200: {
      description: 'The overview.',
      content: { 'application/json': { schema: adminOverviewSchema.openapi('AdminOverview') } },
    },
    ...authenticatedErrors,
    400: badQuery,
    403: forbidden,
  },
})

const analyticsRoute = createRoute({
  method: 'get',
  path: '/api/admin/analytics',
  tags: ['admin'],
  summary: 'Analytics over a period',
  description: 'Was `admin` action `analytics`.',
  security,
  request: { query: periodQuery('30d') },
  responses: {
    200: {
      description: 'The analytics.',
      content: { 'application/json': { schema: analyticsSchema.openapi('AdminAnalytics') } },
    },
    ...authenticatedErrors,
    400: badQuery,
    403: forbidden,
  },
})

const feedbackRoute = createRoute({
  method: 'get',
  path: '/api/admin/feedback',
  tags: ['admin'],
  summary: 'Feedback over a period',
  description: 'Newest first. Was `admin` action `list_feedback`.',
  security,
  request: { query: periodQuery('30d') },
  responses: {
    200: {
      description: 'The feedback.',
      content: { 'application/json': { schema: feedbackListSchema.openapi('AdminFeedbackList') } },
    },
    ...authenticatedErrors,
    400: badQuery,
    403: forbidden,
  },
})

const collaboratorsRoute = createRoute({
  method: 'get',
  path: '/api/admin/collaborators',
  tags: ['admin'],
  summary: 'People who asked to be contacted',
  description: 'Newest first. Was `admin` action `list_collaborators`.',
  security,
  request: {},
  responses: {
    200: {
      description: 'The collaborators.',
      content: {
        'application/json': { schema: collaboratorListSchema.openapi('AdminCollaboratorList') },
      },
    },
    ...authenticatedErrors,
    403: forbidden,
  },
})

export const overviewRoutes = new OpenAPIHono<AppEnv>()
  .openapi(overviewRoute, async (c) => {
    const { period, caseId } = c.req.valid('query')
    return c.json(await c.get('admin').overview.overview(period, caseId), 200)
  })
  .openapi(analyticsRoute, async (c) => {
    const { period } = c.req.valid('query')
    return c.json(await c.get('admin').overview.analytics(period), 200)
  })
  .openapi(feedbackRoute, async (c) => {
    const { period } = c.req.valid('query')
    return c.json({ items: await c.get('admin').overview.feedback(period) }, 200)
  })
  .openapi(collaboratorsRoute, async (c) => {
    return c.json({ items: await c.get('admin').overview.collaborators() }, 200)
  })
