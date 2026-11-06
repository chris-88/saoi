import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AppEnv } from '../../context.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'

/** Bank-form applications in the console (the Forms screen). */

const summarySchema = z
  .object({
    id: z.string(),
    caseId: z.string(),
    formId: z.string(),
    formVersion: z.string(),
    who: z.string().nullable(),
    answered: z.number().int(),
    reused: z.number().int(),
    updatedAt: z.string(),
  })
  .openapi('FormApplicationSummary')

const listSchema = z.object({ applications: z.array(summarySchema) }).openapi('FormApplicationList')

const rebuildSchema = z
  .object({
    cases: z.number().int(),
    forms: z.number().int(),
    answered: z.number().int(),
    failed: z.number().int(),
  })
  .openapi('FormRebuildResult')

// The packet and the answers are open-ended by design (the form definition decides them).
const inspectionSchema = z
  .object({
    id: z.string(),
    caseId: z.string(),
    updatedAt: z.string(),
    definition: z.object({
      formId: z.string(),
      version: z.string(),
      source: z.string(),
      retrievedAt: z.string(),
      sourceHash: z.string(),
      fieldCount: z.number().int(),
      activeCount: z.number().int(),
      questionCount: z.number().int(),
      requiredCount: z.number().int(),
    }),
    collected: z.array(
      z.object({
        fieldId: z.string(),
        label: z.string(),
        type: z.string(),
        toscana: z.string().nullable(),
        value: z.unknown(),
        reused: z.boolean(),
        givenDirectly: z.string().nullable(),
      }),
    ),
    outstanding: z.array(z.object({ fieldId: z.string(), label: z.string(), type: z.string() })),
    calculations: z.array(
      z.object({
        fieldId: z.string(),
        control: z.string(),
        label: z.string(),
        fidelity: z.enum(['source_faithful', 'fixture', 'unsupported']),
        note: z.string(),
        parameters: z.record(z.string(), z.union([z.string(), z.number()])),
        result: z.union([z.string(), z.number()]).nullable(),
      }),
    ),
    rateBasis: z.string().nullable(),
    limits: z.array(
      z.object({
        label: z.string(),
        comparedField: z.string(),
        operator: z.string(),
        limit: z.string(),
        actual: z.number(),
      }),
    ),
    consents: z.array(z.object({ fieldId: z.string(), wording: z.string(), agreedAt: z.string() })),
    documents: z.array(
      z.object({
        fieldId: z.string(),
        fileName: z.string(),
        sizeBytes: z.number().nullable(),
        attachedAt: z.string(),
        signatures: z.string(),
      }),
    ),
    submission: z
      .object({
        target: z.string(),
        method: z.string(),
        encoding: z.string(),
        formId: z.string(),
        formVersion: z.string(),
        entries: z.array(
          z.object({
            key: z.string(),
            value: z.string(),
            source: z.enum(['answer', 'reused', 'default', 'consent', 'derived', 'runtime']),
            fieldId: z.string().nullable(),
            label: z.string(),
            toscana: z.string().nullable(),
            sensitive: z.boolean(),
          }),
        ),
        generatedAt: z.string(),
        status: z.literal('GENERATED_NOT_SENT'),
        externalRequestMade: z.literal(false),
      })
      .openapi('FormSubmissionPacket'),
  })
  .openapi('FormInspection')

const list = createRoute({
  method: 'get',
  path: '/api/admin/form-applications',
  tags: ['admin'],
  summary: 'List form applications',
  description: 'The sixty most recently updated. Was `admin` action `list_form_applications`.',
  security,
  responses: {
    200: {
      description: 'The applications.',
      content: { 'application/json': { schema: listSchema } },
    },
    ...authenticatedErrors,
    403: errorResponse('Not an administrator.'),
  },
})

const inspect = createRoute({
  method: 'get',
  path: '/api/admin/form-applications/{formApplicationId}',
  tags: ['admin'],
  summary: 'Inspect a form application',
  description:
    'Recomputes the state, calculations and the (never sent) packet from the stored answers. ' +
    'Was `admin` action `inspect_form_application`.',
  security,
  request: { params: z.object({ formApplicationId: z.uuid() }) },
  responses: {
    200: {
      description: 'The application as the console reads it.',
      content: { 'application/json': { schema: inspectionSchema } },
    },
    ...authenticatedErrors,
    400: errorResponse('The id is not a uuid.'),
    403: errorResponse('Not an administrator.'),
    404: errorResponse('No such form application, or no definition snapshot for its form.'),
  },
})

const rebuild = createRoute({
  method: 'post',
  path: '/api/admin/form-applications/rebuild',
  tags: ['admin'],
  summary: 'Rebuild form applications from the cases',
  description:
    'Re-syncs every case (up to 500). One failing case does not stop the rest. ' +
    'Was `admin` action `rebuild_form_applications`.',
  security,
  responses: {
    200: {
      description: 'What was rebuilt.',
      content: { 'application/json': { schema: rebuildSchema } },
    },
    ...authenticatedErrors,
    403: errorResponse('Not an administrator.'),
  },
})

export const formsRoutes = new OpenAPIHono<AppEnv>()
  .openapi(rebuild, async (c) => c.json(await c.get('admin').forms.rebuild(), 200))
  .openapi(list, async (c) => c.json({ applications: await c.get('admin').forms.list() }, 200))
  .openapi(inspect, async (c) => {
    const { formApplicationId } = c.req.valid('param')
    return c.json(await c.get('admin').forms.inspect(formApplicationId), 200)
  })
