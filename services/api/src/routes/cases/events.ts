import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { streamSSE } from 'hono/streaming'
import { caseFeedReadySchema, caseFeedUpdateSchema } from '@shared/contracts/case-read.ts'
import type { AppEnv } from '../../context.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { caseFeed } from './feed.ts'
import { caseParams } from './params.ts'

const route = createRoute({
  method: 'get',
  path: '/api/cases/{caseId}/events',
  tags: ['cases'],
  summary: 'Change feed (Server-Sent Events)',
  description: [
    'A `text/event-stream` that stays open. Send the bearer token in `Authorization`, so use ' +
      '`fetch` and not `EventSource`. Resume with `Last-Event-ID`.',
    '',
    'Frames:',
    '- `event: ready`, once on open. `data` is `{ caseId, latest }` where `latest` is the newest ' +
      'narratable event (`{ id, text }`) or null. Clients take their baseline from it.',
    '- `event: update`, for each narratable event after that. `id:` is the event id and `data` is ' +
      '`{ id, type, text, at }`, `text` being the sentence from `describeEvent`.',
    '- `: keep-alive`, a comment line every 25 seconds, because Cloudflare cuts silent streams ' +
      'at about 100 seconds.',
    '',
    'The server closes the stream if the store keeps failing; reconnect with `Last-Event-ID`.',
  ].join('\n'),
  security,
  request: {
    params: caseParams,
    headers: z.object({
      'last-event-id': z
        .string()
        .optional()
        .openapi({ description: 'Resume after this event id.' }),
    }),
  },
  responses: {
    200: {
      description: 'The stream. Payloads: `ready` is CaseFeedReady, `update` is CaseFeedUpdate.',
      content: {
        'text/event-stream': {
          schema: z.string().openapi({
            example:
              'event: ready\ndata: {"caseId":"…","latest":null}\n\n: keep-alive\n\nid: 7\nevent: update\ndata: {"id":"7","type":"application_approved","text":"Credit card was approved.","at":"…"}\n\n',
          }),
        },
      },
    },
    ...authenticatedErrors,
    404: errorResponse('No such case, or the caller cannot see it.'),
  },
})

export const eventsRoutes = new OpenAPIHono<AppEnv>()

// The stream's two data frames are not response bodies, so they are named components.
eventsRoutes.openAPIRegistry.register('CaseFeedReady', caseFeedReadySchema)
eventsRoutes.openAPIRegistry.register('CaseFeedUpdate', caseFeedUpdateSchema)

eventsRoutes.openapi(route, (c) => {
  const { caseId } = c.get('caseAccess')
  const store = c.get('store')
  const options = { ...c.get('feedOptions'), lastEventId: c.req.header('Last-Event-ID') }

  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('X-Accel-Buffering', 'no')

  // The handler's declared type is the schema's `string`; the body is a stream.
  return streamSSE(c, async (stream) => {
    const controller = new AbortController()
    stream.onAbort(() => controller.abort())

    for await (const frame of caseFeed(store, caseId, options, controller.signal)) {
      if (frame.kind === 'keep-alive') {
        await stream.write(': keep-alive\n\n')
      } else if (frame.kind === 'ready') {
        await stream.writeSSE({ event: 'ready', data: JSON.stringify(frame.data) })
      } else {
        await stream.writeSSE({
          event: 'update',
          id: frame.data.id,
          data: JSON.stringify(frame.data),
        })
      }
    }
  })
})
