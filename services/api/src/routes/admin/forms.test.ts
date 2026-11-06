import { describe, expect, it } from 'vitest'
import { ApiError } from '../../errors.ts'
import type {
  AdminFormsStore,
  FormApplicationSummary,
  FormInspection,
} from '../../store/admin/forms.ts'
import { adminTestApp } from './testing.ts'

const ID = '22222222-2222-4222-8222-222222222222'
const CASE = '11111111-1111-4111-8111-111111111111'

const summary: FormApplicationSummary = {
  id: ID,
  caseId: CASE,
  formId: '1833',
  formVersion: 'SuperSaver 2.1',
  who: 'Chris Quinn',
  answered: 3,
  reused: 1,
  updatedAt: '2026-11-04T10:00:00.000Z',
}

const inspection: FormInspection = {
  id: ID,
  caseId: CASE,
  updatedAt: '2026-11-04T10:00:00.000Z',
  definition: {
    formId: '1833',
    version: '2.1',
    source: 'published',
    retrievedAt: '2026-10-01',
    sourceHash: 'abc',
    fieldCount: 499,
    activeCount: 10,
    questionCount: 5,
    requiredCount: 2,
  },
  collected: [
    {
      fieldId: '167',
      label: 'Name',
      type: 'text',
      toscana: null,
      value: 'Chris',
      reused: true,
      givenDirectly: null,
    },
  ],
  outstanding: [{ fieldId: '168', label: 'Address', type: 'text' }],
  calculations: [],
  rateBasis: null,
  limits: [],
  consents: [],
  documents: [],
  submission: {
    target: 'https://forms.example/',
    method: 'POST',
    encoding: 'multipart/form-data',
    formId: '1833',
    formVersion: '2.1',
    entries: [],
    generatedAt: '2026-11-04T10:00:00.000Z',
    status: 'GENERATED_NOT_SENT',
    externalRequestMade: false,
  },
}

function fake(overrides: Partial<AdminFormsStore> = {}): AdminFormsStore {
  return {
    rebuild: () => Promise.resolve({ cases: 4, forms: 2, answered: 7, failed: 1 }),
    list: () => Promise.resolve([summary]),
    inspect: () => Promise.resolve(inspection),
    ...overrides,
  }
}

const ROUTES = [
  ['GET', '/api/admin/form-applications'],
  ['GET', `/api/admin/form-applications/${ID}`],
  ['POST', '/api/admin/form-applications/rebuild'],
] as const

describe('admin form routes', () => {
  it.each(ROUTES)('%s %s: 403 for a non-admin, 401 anonymous', async (method, path) => {
    const { send } = adminTestApp({ forms: fake() })
    expect((await send('user', method, path)).status).toBe(403)
    expect((await send('anonymous', method, path)).status).toBe(401)
  })

  it('403 for a non-admin even with a malformed id', async () => {
    const { send } = adminTestApp({ forms: fake() })
    expect((await send('user', 'GET', '/api/admin/form-applications/nope')).status).toBe(403)
  })

  it('lists applications', async () => {
    const { send } = adminTestApp({ forms: fake() })
    const reply = await send('admin', 'GET', '/api/admin/form-applications')
    expect(reply.status).toBe(200)
    expect(await reply.json()).toEqual({ applications: [summary] })
  })

  it('inspects one', async () => {
    const { send } = adminTestApp({ forms: fake() })
    const reply = await send('admin', 'GET', `/api/admin/form-applications/${ID}`)
    expect(reply.status).toBe(200)
    expect(await reply.json()).toEqual(inspection)
  })

  it('400 for an id that is not a uuid', async () => {
    const { send } = adminTestApp({ forms: fake() })
    expect((await send('admin', 'GET', '/api/admin/form-applications/nope')).status).toBe(400)
  })

  it('404 with the message when there is no such application', async () => {
    const { send } = adminTestApp({
      forms: fake({
        inspect: () => Promise.reject(new ApiError('not_found', 'No such form application.')),
      }),
    })
    const reply = await send('admin', 'GET', `/api/admin/form-applications/${ID}`)
    expect(reply.status).toBe(404)
    expect(await reply.json()).toMatchObject({
      ok: false,
      error: { code: 'not_found', message: 'No such form application.' },
    })
  })

  it('rebuilds and reports the counts', async () => {
    const { send } = adminTestApp({ forms: fake() })
    const reply = await send('admin', 'POST', '/api/admin/form-applications/rebuild')
    expect(reply.status).toBe(200)
    expect(await reply.json()).toEqual({ cases: 4, forms: 2, answered: 7, failed: 1 })
  })

  it('a database failure is a 500 that does not leak the message', async () => {
    const { send } = adminTestApp({
      forms: fake({ list: () => Promise.reject(new Error('relation "form_applications" broke')) }),
    })
    const reply = await send('admin', 'GET', '/api/admin/form-applications')
    expect(reply.status).toBe(500)
    expect(JSON.stringify(await reply.json())).not.toContain('form_applications')
  })
})
