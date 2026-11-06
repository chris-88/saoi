import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import {
  registerInterestBodySchema,
  registerInterestResponseSchema,
} from '@shared/contracts/session.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const DAILY_CAP = 50

const route = createRoute({
  method: 'post',
  path: '/api/interest',
  tags: ['session'],
  summary: 'Somebody who wants to work on this (§44)',
  description:
    'Not case activity, so no event and no case. Any visitor’s token will do. A filled `website` ' +
    'field is a honeypot: answered `ok`, stored nowhere. Was `session` action `register_interest`.',
  security,
  request: {
    body: {
      required: true,
      content: {
        'application/json': { schema: registerInterestBodySchema.openapi('RegisterInterest') },
      },
    },
  },
  responses: {
    200: {
      description: 'Registered (or taken for a bot, which looks the same).',
      content: {
        'application/json': {
          schema: registerInterestResponseSchema.openapi('RegisterInterestResponse'),
        },
      },
    },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    429: errorResponse('The daily cap is reached, or too many requests.'),
  },
})

export const interestRoutes = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  const interest = c.req.valid('json')

  // `ok` on purpose: a form that says "refused" to a bot tells it which field gave it away.
  if (interest.website !== undefined && interest.website.length > 0) {
    c.get('log').warn('register_interest: honeypot filled, nothing written')
    return c.json({ registered: true as const }, 200)
  }

  const sessions = c.get('sessions')
  const dayAgo = new Date(Date.now() - DAY_MS).toISOString()
  if ((await sessions.interestsSince(dayAgo)) >= DAILY_CAP) {
    throw new ApiError('rate_limited', 'A lot of people have registered today. Try again tomorrow.')
  }

  await sessions.addInterest({
    kind: interest.kind ?? 'collaborate',
    name: interest.name,
    email: interest.email,
    organisation: interest.organisation ?? null,
    role: interest.role ?? null,
    interest: interest.interest,
    consent: interest.consent,
    source: interest.source ?? null,
  })
  return c.json({ registered: true as const }, 200)
})
