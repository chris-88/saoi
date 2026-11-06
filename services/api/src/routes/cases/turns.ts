import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { saoirseTurnRequestSchema } from '@shared/contracts/saoirse-turn.ts'
import { streamEventSchema } from '@shared/contracts/stream.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { requireCaseSeat } from '../../middleware/requireCaseAccess.ts'
import { DEFAULT_KEEP_ALIVE_MS, SSE_HEADERS, eventStream, just } from '../../turn/stream.ts'
import type { TurnRunner } from '../../turn/turn.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { seatOf } from './actionKit.ts'
import { caseParams } from './params.ts'
import { requireTurnRole } from './policy.ts'

/** The path carries the case; the rest of the body is what `saoirse-turn` has always taken. */
const turnBody = saoirseTurnRequestSchema.omit({ caseId: true }).openapi('SaoirseTurnRequest')

const route = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/turns',
  tags: ['turns'],
  summary: 'One conversation turn (Server-Sent Events)',
  description: [
    'The port of the `saoirse-turn` Edge Function: gate, Saoirse with tools, stream, persist. Send the ' +
      'bearer token in `Authorization`, so read it with `fetch` and not `EventSource`. Only the ' +
      'primary customer may take a turn: a partner is refused (403) and a stranger gets 404.',
    '',
    'The response is `200 text/event-stream` once the request is admitted; a turn that fails ' +
      'after that point fails inside the stream, as an `error` frame, never as a status code. ' +
      'Every frame is `data: <json>` and a blank line, the JSON being a `SaoirseStreamEvent`:',
    '',
    '| `type` | Payload | When |',
    '| --- | --- | --- |',
    '| `text_delta` | `text` | Saoirse speaking, as it is written. |',
    '| `retract` | `length` | Takes the last `length` characters back: a round that spoke and then had a tool refused. |',
    '| `card` | `card` | A card to render. Held back until the text before it is finished. |',
    '| `status` | `caseId`, `invalidate` | The case changed; refetch. Absent on a blocked turn. |',
    '| `done` | `messageId`, `gateCategory` | The reply is saved. Always last on success. |',
    '| `error` | `error` | The turn failed. Always last on failure; nothing of the reply is saved. |',
    '',
    'Order: `text_delta`/`retract`, then `card`, then `status`, then `done`. A line starting ' +
      '`:` is a keep-alive comment, sent when 25 seconds pass without a write. The whole turn is ' +
      'limited to 85 seconds.',
  ].join('\n'),
  security,
  middleware: [requireCaseSeat, requireTurnRole] as const,
  request: {
    params: caseParams,
    body: { required: true, content: { 'application/json': { schema: turnBody } } },
  },
  responses: {
    200: {
      description: 'The stream. Each `data:` line is a `SaoirseStreamEvent`.',
      content: {
        'text/event-stream': {
          schema: z.string().openapi({
            example:
              'data: {"type":"text_delta","text":"First home with your wife."}\n\ndata: {"type":"status","caseId":"…","invalidate":["case","facts","applications"]}\n\ndata: {"type":"done","messageId":"…","gateCategory":"banking"}\n\n',
          }),
        },
      },
    },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    403: errorResponse('A partner or an administrator: only the primary customer takes turns.'),
    404: errorResponse('No such case for this caller.'),
  },
})

export type TurnRouteOptions = { readonly run: TurnRunner; readonly keepAliveMs?: number }

export function turnRoutes(options: TurnRouteOptions) {
  const routes = new OpenAPIHono<AppEnv>()
  routes.openAPIRegistry.register('SaoirseStreamEvent', streamEventSchema)

  routes.openapi(route, async (c) => {
    const { caseId, participantId } = seatOf(c.get('caseAccess'))
    const body = c.req.valid('json')
    const requestId = c.get('requestId')

    let events
    try {
      events = await options.run({ caseId, participantId, body: { ...body, caseId } })
    } catch (error) {
      // A missing case is a status the caller can act on; anything else would reach the browser
      // as a bare failure, so it becomes an `error` frame the chat can say. Detail stays in the log.
      if (error instanceof ApiError && error.status < 500) throw error
      c.get('log').error('turn failed before the stream opened', { requestId, error })
      events = just({
        type: 'error',
        error: {
          code: 'upstream_unavailable',
          message: `Saoirse could not answer just now. Request id ${requestId}.`,
        },
      })
    }

    const stream = eventStream(events, {
      keepAliveMs: options.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS,
    })
    return c.body(stream, 200, SSE_HEADERS)
  })

  return routes
}
