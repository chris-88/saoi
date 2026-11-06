import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../context.ts'

export const healthSchema = z.object({ ok: z.literal(true), version: z.string() }).openapi('Health')

const route = (path: '/health' | '/api/health') =>
  createRoute({
    method: 'get',
    path,
    tags: ['meta'],
    summary: path === '/health' ? 'Liveness' : 'Liveness (alias under /api)',
    description:
      path === '/health'
        ? 'Reports the version the image was built with.'
        : 'The same as `/health`, so a reverse proxy that forwards `/api/*` needs no rewrite.',
    responses: {
      200: {
        description: 'The service is up.',
        content: { 'application/json': { schema: healthSchema } },
      },
    },
  })

/** Both paths are mounted ahead of the auth middleware: a liveness check carries no token. */
export const healthRoutes = (version: string) =>
  new OpenAPIHono<AppEnv>()
    .openapi(route('/health'), (c) => c.json({ ok: true as const, version }, 200))
    .openapi(route('/api/health'), (c) => c.json({ ok: true as const, version }, 200))
