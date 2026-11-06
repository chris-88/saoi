import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { guardrailTestSchema, personaPreviewSchema } from '@shared/contracts/admin.ts'
import type { AppEnv } from '../../context.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { actionBody } from './schemas.ts'

/** Persona, the kill switch (domain config) and the guardrail test (§38, §39, §56). */

const forbidden = errorResponse('Not an administrator.')
const unavailable = errorResponse('The model is not configured or did not answer.')

const killSwitchBody = actionBody('set_kill_switch').openapi('SetKillSwitch')
const personaBody = actionBody('set_persona').openapi('SetPersona')
const previewBody = actionBody('preview_persona').openapi('PreviewPersona')
const guardrailBody = actionBody('test_guardrail').openapi('TestGuardrail')

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
})

const setKillSwitch = createRoute({
  method: 'put',
  path: '/api/admin/kill-switch',
  tags: ['admin'],
  summary: 'Pause or resume the demo',
  description: 'While on, the gate answers every turn with “demo paused”. Was `set_kill_switch`.',
  security,
  request: { body: jsonBody(killSwitchBody) },
  responses: {
    200: {
      description: 'The setting now in force.',
      content: {
        'application/json': {
          schema: z.object({ killSwitch: z.boolean() }).openapi('KillSwitchState'),
        },
      },
    },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    403: forbidden,
  },
})

const setPersona = createRoute({
  method: 'put',
  path: '/api/admin/persona',
  tags: ['admin'],
  summary: 'Set the persona preset and/or sliders',
  description:
    'Explicit sliders win over a preset, so a preset can be nudged (preset becomes `custom` ' +
    'unless named). Was `set_persona`.',
  security,
  request: { body: jsonBody(personaBody) },
  responses: {
    200: {
      description: 'What was written.',
      content: {
        'application/json': { schema: z.record(z.string(), z.unknown()).openapi('PersonaWritten') },
      },
    },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid, or sets nothing.'),
    403: forbidden,
  },
})

const previewPersona = createRoute({
  method: 'post',
  path: '/api/admin/persona/preview',
  tags: ['admin'],
  summary: 'Hear a persona',
  description:
    'Runs the real prompt composer with the draft sliders against the live model. Nothing is ' +
    'stored. Was `preview_persona`.',
  security,
  request: { body: jsonBody(previewBody) },
  responses: {
    200: {
      description: 'The model’s reply.',
      content: { 'application/json': { schema: personaPreviewSchema.openapi('PersonaPreview') } },
    },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    403: forbidden,
    502: unavailable,
  },
})

const testGuardrail = createRoute({
  method: 'post',
  path: '/api/admin/guardrails/test',
  tags: ['admin'],
  summary: 'Run a message through the gate',
  description:
    'The real classifier and deterministic checks, so the answer cannot drift from what a ' +
    'customer would meet. Nothing is written. Was `test_guardrail`.',
  security,
  request: { body: jsonBody(guardrailBody) },
  responses: {
    200: {
      description: 'What the gate decided.',
      content: { 'application/json': { schema: guardrailTestSchema.openapi('GuardrailTest') } },
    },
    ...authenticatedErrors,
    400: errorResponse('The body is not valid.'),
    403: forbidden,
    502: unavailable,
  },
})

export const configRoutes = new OpenAPIHono<AppEnv>()
  .openapi(setKillSwitch, async (c) => {
    const { enabled } = c.req.valid('json')
    return c.json(await c.get('admin').config.setKillSwitch(enabled), 200)
  })
  .openapi(setPersona, async (c) => {
    const { preset, sliders } = c.req.valid('json')
    return c.json(await c.get('admin').config.setPersona({ preset, sliders }), 200)
  })
  .openapi(previewPersona, async (c) => {
    const { sliders, message } = c.req.valid('json')
    return c.json(await c.get('admin').config.previewPersona(sliders, message), 200)
  })
  .openapi(testGuardrail, async (c) => {
    const { message } = c.req.valid('json')
    return c.json(await c.get('admin').config.testGuardrail(message), 200)
  })
