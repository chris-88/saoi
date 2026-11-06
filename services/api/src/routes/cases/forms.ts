import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Insert } from '@shared/db/case-repository.ts'
import { factCatalogue, isFactKey, parseFactValue } from '@shared/domain/facts.ts'
import { resolveFormState } from '@shared/domain/forms/state.ts'
import { formForProduct } from '@shared/tenants/demo/forms/mapping.ts'
import { formSnapshot } from '@shared/tenants/demo/forms/snapshots.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'
import { security } from '../common.ts'
import {
  actionErrors,
  applicationOn,
  applicationParams,
  loadOrThrow,
  outcome,
  resultResponse,
  seatOf,
} from './actionKit.ts'
import { requireRole } from './policy.ts'

/** The bank's own forms and the one structured door for special-category data. */

const declarationsBody = z
  .object({
    /**
     * Field ids rather than wording: the server reads the text out of the published definition
     * and stores what it showed, so what is recorded as agreed to cannot drift from what was on
     * screen, and a client cannot submit a declaration by inventing a nicer sentence.
     */
    fieldIds: z.array(z.string().min(1).max(12)).min(1).max(20),
  })
  .openapi('FormDeclarations')

const healthBody = z
  .object({
    values: z
      .array(z.object({ key: z.string().min(1), value: z.unknown() }))
      .min(1)
      .max(20),
  })
  .openapi('HealthAnswers')

const declarations = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/applications/{applicationId}/form-declarations',
  tags: ['forms'],
  summary: 'Tick the declarations the bank’s form requires',
  description:
    'Each field must be a declaration on this form and active on this customer’s branch (§10). ' +
    'Was `case-action` `confirm_form_declarations`.',
  security,
  middleware: [requireRole('confirm_form_declarations')],
  request: {
    params: applicationParams,
    body: { required: true, content: { 'application/json': { schema: declarationsBody } } },
  },
  responses: { 200: resultResponse('Recorded.'), ...actionErrors },
})

const health = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/applications/{applicationId}/health-answers',
  tags: ['forms'],
  summary: 'Submit the structured health form',
  description:
    'The only path by which special-category data enters the case (§7.5, Invariant 6): refused ' +
    '(403) unless the consent is already recorded on this application. Was `case-action` ' +
    '`submit_health_form`.',
  security,
  middleware: [requireRole('submit_health_form')],
  request: {
    params: applicationParams,
    body: { required: true, content: { 'application/json': { schema: healthBody } } },
  },
  responses: { 200: resultResponse('Thanks.'), ...actionErrors },
})

export const formRoutes = new OpenAPIHono<AppEnv>()
  .openapi(declarations, async (c) => {
    const { applicationId } = c.req.valid('param')
    const { fieldIds } = c.req.valid('json')
    const store = c.get('store')
    const { caseId, participantId } = seatOf(c.get('caseAccess'))

    const loaded = await loadOrThrow(store, caseId)
    const application = applicationOn(loaded, applicationId)

    const mapping = formForProduct(application.product)
    const snapshot = mapping ? formSnapshot(mapping.formId) : undefined
    if (!snapshot) throw new ApiError('bad_request', 'That application has no form behind it.')

    const form = await store.formApplication(caseId, snapshot.formId)
    if (!form) throw new ApiError('not_found', 'Nothing has been collected for that form.')

    const state = resolveFormState(snapshot.definition, form.answers)
    const active = new Set(state.active.map((field) => field.id))
    const byId = new Map(snapshot.definition.fields.map((field) => [field.id, field]))

    const writes = fieldIds.map((fieldId) => {
      const field = byId.get(fieldId)
      if (!field || field.type !== 'checkbox' || !active.has(fieldId)) {
        throw new ApiError('bad_request', 'That is not a declaration on this form.')
      }
      return {
        form_application_id: form.id,
        field_id: fieldId,
        // A checkbox submits the value its own choice declares, which is the form's business.
        value: field.choices?.[0]?.value ?? 'Yes',
        // What was on screen, stored beside the agreement to it.
        wording: field.label.slice(0, 2000),
        participant_id: participantId,
      }
    })

    await store.saveDeclarations({ caseId, applicationId, formId: snapshot.formId, writes })
    const summary = `${String(writes.length)} ${writes.length === 1 ? 'declaration' : 'declarations'} recorded.`
    return c.json(await outcome(store, caseId, await store.applicationNamer(), summary), 200)
  })
  .openapi(health, async (c) => {
    const { applicationId } = c.req.valid('param')
    const { values } = c.req.valid('json')
    const store = c.get('store')
    const { caseId, participantId } = seatOf(c.get('caseAccess'))

    const loaded = await loadOrThrow(store, caseId)
    applicationOn(loaded, applicationId)

    // Invariant 6 at the only door: the consent must already be recorded for THIS application.
    const consented = loaded.confirmations.some(
      (confirmation) =>
        String(confirmation.applicationId) === applicationId &&
        confirmation.requirementId.includes('health-consent'),
    )
    if (!consented) {
      throw new ApiError('forbidden', 'Health questions cannot be answered before consent.')
    }

    const rows: Insert<'facts'>[] = []
    const problems: string[] = []
    for (const entry of values) {
      if (!isFactKey(entry.key)) {
        problems.push(`${entry.key} is not something we collect.`)
        continue
      }
      // This form exists for special-category data. Anything else belongs elsewhere, and
      // accepting it here would route ordinary facts around the normal checks.
      if (factCatalogue[entry.key].sensitivity !== 'special') {
        problems.push(`${entry.key} does not belong on this form.`)
        continue
      }
      const parsed = parseFactValue(entry.key, entry.value)
      if (!parsed.ok) {
        problems.push(`${factCatalogue[entry.key].label}: ${parsed.issues.join('; ')}`)
        continue
      }
      rows.push({
        case_id: caseId,
        key: entry.key,
        participant_id: participantId,
        subject_kind: 'participant',
        value: parsed.value as Insert<'facts'>['value'],
        source: 'customer_stated',
        verified: false,
        captured_for: applicationId,
      })
    }
    if (problems.length > 0) throw new ApiError('bad_request', problems.join(' '))

    await store.saveHealthFacts({ caseId, applicationId, rows })
    const summary = 'Thanks, that is everything I needed from you on the health side.'
    return c.json(await outcome(store, caseId, await store.applicationNamer(), summary), 200)
  })
