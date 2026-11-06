/**
 * `POST /api/cases/:caseId/documents` against a real database and the private `documents`
 * bucket: who may upload, what is stored, and that a settled information request moves the
 * application on through the state machine.
 */
import { describe, expect, it } from 'vitest'
import {
  addPartner,
  anonymousUser,
  buildApp,
  errorCode,
  rows,
  serviceClient,
  startVisitor,
  type App,
} from './harness.ts'

const app = buildApp()

const PDF = new TextEncoder().encode('%PDF-1.7\n%integration\n')
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])
const EXE = new TextEncoder().encode('MZ\x90\x00 not a document')

async function upload(
  target: App,
  caseId: string,
  token: string | null,
  fields: Record<string, string>,
  file: { bytes: Uint8Array; type: string; name: string } | null = {
    bytes: PDF,
    type: 'application/pdf',
    name: 'payslip.pdf',
  },
) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  if (file) form.append('file', new File([file.bytes], file.name, { type: file.type }))
  const response = await target.request(`/api/cases/${caseId}/documents`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  return { status: response.status, body: (await response.json()) as any }
}

/** A case with an application and one open document request against it. */
async function withRequest(state = 'in_progress', resumeTo: string | null = null) {
  const owner = await startVisitor(app)
  const service = serviceClient()
  const application = await service
    .from('applications')
    .insert({ case_id: owner.caseId, product: 'personal_loan', state, resume_to: resumeTo })
    .select('id')
    .single()
  if (application.error) throw new Error(application.error.message)
  const request = await service
    .from('application_requests')
    .insert({
      application_id: application.data.id,
      kind: 'document',
      requirement_id: 'payslip',
      status: 'open',
    })
    .select('id')
    .single()
  if (request.error) throw new Error(request.error.message)
  return {
    owner,
    applicationId: application.data.id as string,
    requestId: request.data.id as string,
  }
}

describe('POST /api/cases/:caseId/documents', () => {
  it('stores the file, records the document, fulfils the request and writes the event', async () => {
    const { owner, applicationId, requestId } = await withRequest()
    const reply = await upload(app, owner.caseId, owner.user.token, { requestId })
    expect(reply.status).toBe(201)
    expect(reply.body).toEqual({ fileName: 'payslip.pdf', requirementId: 'payslip' })

    const documents = await rows('documents', owner.caseId)
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({
      application_id: applicationId,
      participant_id: owner.participantId,
      file_name: 'payslip.pdf',
      verified: false,
    })
    expect(documents[0].storage_path).toMatch(new RegExp(`^${owner.caseId}/.+\\.pdf$`))

    const stored = await serviceClient()
      .storage.from('documents')
      .download(documents[0].storage_path)
    expect(stored.error).toBeNull()
    expect(new Uint8Array(await stored.data!.arrayBuffer())).toEqual(PDF)

    const fulfilled = await serviceClient()
      .from('application_requests')
      .select('status')
      .eq('id', requestId)
      .single()
    expect(fulfilled.data?.status).toBe('fulfilled')
    const events = await rows('events', owner.caseId)
    expect(events.find((e) => e.type === 'document_uploaded')).toMatchObject({ actor: 'customer' })

    // Once fulfilled it is dealt with.
    const again = await upload(app, owner.caseId, owner.user.token, { requestId })
    expect(again.status).toBe(409)
    expect(errorCode({ status: again.status, body: again.body })).toBe('conflict')
  })

  it('is 401 without a token and 403 for a stranger, storing nothing', async () => {
    const { owner, requestId } = await withRequest()
    expect((await upload(app, owner.caseId, null, { requestId })).status).toBe(401)
    const stranger = await anonymousUser()
    const refused = await upload(app, owner.caseId, stranger.token, { requestId })
    expect(refused.status).toBe(403)
    expect(await rows('documents', owner.caseId)).toEqual([])
  })

  it('a partner on the case may upload, and the event says so', async () => {
    const { owner, requestId } = await withRequest()
    const partner = await addPartner(owner.caseId)
    const reply = await upload(app, owner.caseId, partner.user.token, { requestId })
    expect(reply.status).toBe(201)
    const events = await rows('events', owner.caseId)
    expect(events.find((e) => e.type === 'document_uploaded')).toMatchObject({ actor: 'partner' })
  })

  it('a seat on another case does not reach this one’s requests', async () => {
    const { owner, requestId } = await withRequest()
    const elsewhere = await startVisitor(app)
    // Their own case, someone else's request: no such request there.
    const reply = await upload(app, elsewhere.caseId, elsewhere.user.token, { requestId })
    expect(reply.status).toBe(404)
    // Someone else's case: no seat.
    expect((await upload(app, owner.caseId, elsewhere.user.token, { requestId })).status).toBe(403)
  })

  it('stores what the bytes are, and refuses what is not a document', async () => {
    const { owner, requestId } = await withRequest()
    const refused = await upload(
      app,
      owner.caseId,
      owner.user.token,
      { requestId },
      { bytes: EXE, type: 'application/pdf', name: 'payslip.pdf' },
    )
    expect(refused.status).toBe(400)
    expect(await rows('documents', owner.caseId)).toEqual([])

    const html = await upload(
      app,
      owner.caseId,
      owner.user.token,
      { requestId },
      { bytes: PDF, type: 'text/html', name: 'a.html' },
    )
    expect(html.status).toBe(400)

    // A JPEG declared as a PDF is stored as the JPEG it is.
    const mislabelled = await upload(
      app,
      owner.caseId,
      owner.user.token,
      { requestId },
      { bytes: JPEG, type: 'application/pdf', name: 'photo.pdf' },
    )
    expect(mislabelled.status).toBe(201)
    const [document] = await rows('documents', owner.caseId)
    expect(document.storage_path).toMatch(/\.jpg$/)
    const listing = await serviceClient().storage.from('documents').list(owner.caseId)
    const object = (listing.data ?? []).find((o) => document.storage_path.endsWith(o.name))
    expect(object?.metadata?.['mimetype']).toBe('image/jpeg')
  })

  it('refuses a file over 10 MB and a request that is not for this case', async () => {
    const { owner, requestId } = await withRequest()
    const big = new Uint8Array(10 * 1024 * 1024 + 1)
    big.set(PDF)
    const tooBig = await upload(
      app,
      owner.caseId,
      owner.user.token,
      { requestId },
      { bytes: big, type: 'application/pdf', name: 'big.pdf' },
    )
    expect(tooBig.status).toBe(400)
    expect(await rows('documents', owner.caseId)).toEqual([])

    const ghost = await upload(app, owner.caseId, owner.user.token, {
      requestId: '00000000-0000-4000-8000-0000000000aa',
    })
    expect(ghost.status).toBe(404)
    expect((await upload(app, owner.caseId, owner.user.token, {}, null)).status).toBe(400)
  })

  it('the last document for an application in info_required moves it on', async () => {
    const { owner, applicationId, requestId } = await withRequest('info_required')
    const reply = await upload(app, owner.caseId, owner.user.token, { requestId })
    expect(reply.status).toBe(201)
    const application = await serviceClient()
      .from('applications')
      .select('state')
      .eq('id', applicationId)
      .single()
    expect(application.data?.state).toBe('under_review')
    const types = (await rows('events', owner.caseId)).map((e) => e.type)
    expect(types).toContain('document_received')
  })
})
