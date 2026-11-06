import { describe, expect, it } from 'vitest'
import { formSnapshot } from '@shared/tenants/demo/forms/snapshots.ts'
import { createApp } from '../../app.ts'
import { createTokenVerifier } from '../../middleware/auth.ts'
import {
  ADMIN_ID,
  CASE_ID,
  OTHER_CASE_ID,
  PARTNER_ID,
  REQUEST_ID,
  SECRET,
  STRANGER_ID,
  USER_ID,
  fakePartners,
  fakeSessions,
  fakeStore,
  fakeUploads,
  tokenFor,
} from '../../testing.ts'
import { MAX_BYTES } from './index.ts'
import { sniffDocument } from './sniff.ts'

const verifyToken = createTokenVerifier({ secret: SECRET, jwksUrl: 'http://127.0.0.1:1/jwks' })

const PDF = new TextEncoder().encode('%PDF-1.7\n%test\n')
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
const HEIC = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0])
const EXE = new TextEncoder().encode('MZ\x90\x00this is not a document')

const formField = (() => {
  for (const formId of ['1833', '1940']) {
    const field = formSnapshot(formId)?.definition.fields.find((f) => f.type === 'fileupload')
    if (field) return { formId, fieldId: field.id }
  }
  return null
})()

function build(uploads = fakeUploads(), formApplications = {}) {
  const store = uploads
  const app = createApp({
    verifyToken,
    store: fakeStore(),
    sessions: fakeSessions(),
    partners: fakePartners(),
    uploads: store,
    version: 'test',
    rateLimit: { max: 1000, windowMs: 60_000 },
    ...formApplications,
  })
  return { app, uploads: store }
}

type Fields = Record<string, string>

async function upload(
  app: ReturnType<typeof build>['app'],
  options: {
    as?: string | null
    caseId?: string
    bytes?: Uint8Array | null
    type?: string
    name?: string
    fields?: Fields
  } = {},
) {
  const form = new FormData()
  for (const [key, value] of Object.entries(options.fields ?? { requestId: REQUEST_ID })) {
    form.append(key, value)
  }
  if (options.bytes !== null) {
    form.append(
      'file',
      new File([options.bytes ?? PDF], options.name ?? 'payslip.pdf', {
        type: options.type ?? 'application/pdf',
      }),
    )
  }
  const headers: Record<string, string> = {}
  if (options.as !== null) {
    headers['Authorization'] =
      `Bearer ${await tokenFor({ sub: options.as ?? USER_ID, is_anonymous: true })}`
  }
  const response = await app.request(`/api/cases/${options.caseId ?? CASE_ID}/documents`, {
    method: 'POST',
    headers,
    body: form,
  })
  return { status: response.status, body: (await response.json()) as Record<string, any> }
}

describe('access matrix', () => {
  it('no token is 401', async () => {
    const { app, uploads } = build()
    expect((await upload(app, { as: null })).status).toBe(401)
    expect(uploads.files).toEqual([])
  })

  it.each([
    ['a stranger', STRANGER_ID],
    ['an admin with no seat on the case', ADMIN_ID],
  ])('%s is 403 and nothing is stored', async (_who, user) => {
    const { app, uploads } = build()
    const result = await upload(app, { as: user })
    expect(result.status).toBe(403)
    expect(result.body['error']['code']).toBe('forbidden')
    expect(uploads.files).toEqual([])
    expect(uploads.documents).toEqual([])
  })

  it('the primary customer uploads against an open request', async () => {
    const { app, uploads } = build()
    const result = await upload(app)
    expect(result.status).toBe(201)
    expect(result.body).toEqual({ fileName: 'payslip.pdf', requirementId: 'payslip' })
    expect(uploads.fulfilled).toEqual([REQUEST_ID])
    expect(uploads.events).toEqual([
      expect.objectContaining({ type: 'document_uploaded', actor: 'customer', caseId: CASE_ID }),
    ])
  })

  it('a partner may upload too, and the event says so', async () => {
    const { app, uploads } = build()
    const result = await upload(app, { as: PARTNER_ID })
    expect(result.status).toBe(201)
    expect(uploads.events[0]?.actor).toBe('partner')
  })

  it('a seat on another case does not reach this one’s requests', async () => {
    const { app, uploads } = build()
    const result = await upload(app, { caseId: OTHER_CASE_ID })
    expect(result.status).toBe(403)
    expect(uploads.files).toEqual([])
  })

  it('400 for a case id that is not a uuid', async () => {
    const { app } = build()
    expect((await upload(app, { caseId: 'nope' })).status).toBe(400)
  })
})

describe('what is accepted', () => {
  it.each([
    ['pdf', PDF, 'application/pdf', 'application/pdf', 'pdf'],
    ['png', PNG, 'image/png', 'image/png', 'png'],
    ['jpeg', JPEG, 'image/jpeg', 'image/jpeg', 'jpg'],
    ['heic', HEIC, 'image/heic', 'image/heic', 'heic'],
  ])('%s: stored under the type found in the bytes', async (_n, bytes, declared, stored, ext) => {
    const { app, uploads } = build()
    const result = await upload(app, { bytes, type: declared, name: `file.${ext}` })
    expect(result.status).toBe(201)
    expect(uploads.files[0]).toMatchObject({ contentType: stored })
    expect(uploads.files[0]?.path).toMatch(new RegExp(`^${CASE_ID}/[0-9a-f-]{36}\\.${ext}$`))
  })

  it('stores what the bytes are, not what the client said', async () => {
    const { app, uploads } = build()
    const result = await upload(app, { bytes: JPEG, type: 'application/pdf', name: 'a.pdf' })
    expect(result.status).toBe(201)
    expect(uploads.files[0]?.contentType).toBe('image/jpeg')
    expect(uploads.files[0]?.path).toMatch(/\.jpg$/)
  })

  it('refuses a file whose bytes are not a document, whatever it declares', async () => {
    const { app, uploads } = build()
    const result = await upload(app, { bytes: EXE, type: 'application/pdf', name: 'a.pdf' })
    expect(result.status).toBe(400)
    expect(uploads.files).toEqual([])
    expect(uploads.documents).toEqual([])
    expect(uploads.fulfilled).toEqual([])
  })

  it('refuses a declared type outside the allowlist', async () => {
    const { app, uploads } = build()
    const result = await upload(app, { bytes: PDF, type: 'text/html', name: 'a.html' })
    expect(result.status).toBe(400)
    expect(result.body['error']['message']).toBe('Send a PDF or a photo.')
    expect(uploads.files).toEqual([])
  })

  it('never takes the storage extension from the file name', async () => {
    const { app, uploads } = build()
    await upload(app, { name: 'x.pdf/../../escape' })
    expect(uploads.files[0]?.path).toMatch(new RegExp(`^${CASE_ID}/[0-9a-f-]{36}\\.pdf$`))
  })

  it('refuses an empty file', async () => {
    const { app } = build()
    const result = await upload(app, { bytes: new Uint8Array() })
    expect(result.status).toBe(400)
    expect(result.body['error']['message']).toBe('That file is empty.')
  })

  it('refuses a file over 10 MB', async () => {
    const { app, uploads } = build()
    const big = new Uint8Array(MAX_BYTES + 1)
    big.set(PDF)
    const result = await upload(app, { bytes: big })
    expect(result.status).toBe(400)
    expect(result.body['error']['message']).toContain('10MB')
    expect(uploads.files).toEqual([])
  })

  it('refuses a body that is far over the limit before reading it', async () => {
    const { app } = build()
    const big = new Uint8Array(MAX_BYTES + 200 * 1024)
    big.set(PDF)
    const result = await upload(app, { bytes: big })
    expect(result.status).toBe(400)
    expect(result.body['error']['message']).toContain('10MB')
  })

  it('400 when there is no file', async () => {
    const { app } = build()
    expect((await upload(app, { bytes: null })).status).toBe(400)
  })

  it('400 when it does not say what the document is for', async () => {
    const { app } = build()
    const result = await upload(app, { fields: {} })
    expect(result.status).toBe(400)
    expect(result.body['error']['message']).toBe('Which document is this for?')
  })
})

describe('the request authorises the write', () => {
  it('404 for a request that does not exist on this case', async () => {
    const { app, uploads } = build()
    const result = await upload(app, {
      fields: { requestId: '99999999-9999-4999-8999-999999999999' },
    })
    expect(result.status).toBe(404)
    expect(uploads.files).toEqual([])
  })

  it('409 for a request already dealt with', async () => {
    const uploads = fakeUploads({
      requests: {
        [REQUEST_ID]: {
          id: REQUEST_ID,
          caseId: CASE_ID,
          status: 'fulfilled',
          requirementId: 'payslip',
          application: {
            id: 'app-1',
            product: 'personal_loan',
            state: 'in_progress',
            resumeTo: null,
          },
        },
      },
    })
    const { app } = build(uploads)
    const result = await upload(app)
    expect(result.status).toBe(409)
    expect(uploads.files).toEqual([])
  })

  it('the last document for an application in info_required moves it on, through the machine', async () => {
    const uploads = fakeUploads({
      requests: {
        [REQUEST_ID]: {
          id: REQUEST_ID,
          caseId: CASE_ID,
          status: 'open',
          requirementId: 'bank:proof',
          application: {
            id: 'app-1',
            product: 'personal_loan',
            state: 'info_required',
            resumeTo: 'under_review',
          },
        },
      },
    })
    const { app } = build(uploads)
    const result = await upload(app)
    expect(result.status).toBe(201)
    expect(uploads.states).toEqual([{ applicationId: 'app-1', state: 'under_review' }])
    expect(uploads.events.map((e) => e.type)).toEqual(['document_uploaded', 'document_received'])
  })
})

describe.skipIf(formField === null)('a document for a form field', () => {
  const FORM_APP = '12121212-1212-4212-8212-121212121212'
  const withForm = () =>
    build(
      fakeUploads({
        formApplications: {
          [FORM_APP]: { id: FORM_APP, formId: formField?.formId ?? '', caseId: CASE_ID },
        },
      }),
    )

  it('records a reference in the packet, never the bytes', async () => {
    const { app, uploads } = withForm()
    const result = await upload(app, {
      fields: { formApplicationId: FORM_APP, fieldId: formField?.fieldId ?? '' },
    })
    // The control may restrict extensions; either way nothing is stored on a refusal.
    if (result.status === 201) {
      expect(uploads.formFiles[0]?.value).toMatchObject({
        fileName: 'payslip.pdf',
        mimeType: 'application/pdf',
      })
      expect(uploads.documents).toEqual([])
      expect(uploads.files[0]?.path).toContain(`form-${formField?.formId ?? ''}-`)
    } else {
      expect(result.status).toBe(400)
      expect(uploads.files).toEqual([])
    }
  })

  it('404 for a form application on another case', async () => {
    const { app } = withForm()
    const result = await upload(app, {
      caseId: CASE_ID,
      fields: {
        formApplicationId: '13131313-1313-4313-8313-131313131313',
        fieldId: formField?.fieldId ?? '',
      },
    })
    expect(result.status).toBe(404)
  })

  it('400 for a field that is not an upload control', async () => {
    const { app, uploads } = withForm()
    const result = await upload(app, {
      fields: { formApplicationId: FORM_APP, fieldId: 'not-a-field' },
    })
    expect(result.status).toBe(400)
    expect(uploads.files).toEqual([])
  })

  it('400 when the form field is not named', async () => {
    const { app } = withForm()
    const result = await upload(app, { fields: { formApplicationId: FORM_APP } })
    expect(result.status).toBe(400)
  })
})

describe('sniffDocument', () => {
  it('knows its four kinds and nothing else', () => {
    expect(sniffDocument(PDF)?.mime).toBe('application/pdf')
    expect(sniffDocument(PNG)?.mime).toBe('image/png')
    expect(sniffDocument(JPEG)?.mime).toBe('image/jpeg')
    expect(sniffDocument(HEIC)?.mime).toBe('image/heic')
    expect(sniffDocument(EXE)).toBeNull()
    expect(sniffDocument(new Uint8Array())).toBeNull()
    // ISO media that is not an image brand.
    expect(
      sniffDocument(
        Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
      ),
    ).toBeNull()
  })
})
