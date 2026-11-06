import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { bodyLimit } from 'hono/body-limit'
import { formSnapshot } from '@shared/tenants/demo/forms/snapshots.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError, errorBody } from '../../errors.ts'
import { authenticatedErrors, errorResponse, security } from '../common.ts'
import { caseParams } from '../cases/params.ts'
import { ALLOWED_MIME, sniffDocument } from './sniff.ts'
import { settleInformationRequest } from './settle.ts'

/**
 * `POST /api/cases/:caseId/documents`: the only way a document enters a case (§6 Stage 7, §10).
 *
 * Multipart, so the bytes are never base64 in a body. The file goes to a private bucket under
 * the service role. The caller must hold a seat on the case in any role (a partner uploads too),
 * and the open request (or the form field) it names is what authorises the write.
 *
 * Mounted ahead of `caseRoutes`, so `requireCaseAccess`, which admits the primary customer
 * only, does not apply; the seat is checked here.
 */

/** Matches the bucket, so an oversized file is refused before it is read into memory. */
export const MAX_BYTES = 10 * 1024 * 1024
/** Multipart framing and the small text fields around the file. */
const FRAMING_BYTES = 64 * 1024

const fileSchema = z.instanceof(File).openapi({ type: 'string', format: 'binary' })

const formSchema = z
  .object({
    file: fileSchema.openapi({ description: 'PDF, PNG, JPEG or HEIC, up to 10 MB.' }),
    requestId: z.string().optional().openapi({
      description: 'The open document request this answers. Omit for a form document.',
    }),
    documentType: z.string().max(60).optional(),
    formApplicationId: z.string().optional().openapi({
      description: 'The form application whose upload control this answers.',
    }),
    fieldId: z.string().optional().openapi({ description: 'The form’s upload control.' }),
  })
  .openapi('UploadDocument')

const uploadedSchema = z
  .object({
    fileName: z.string(),
    requirementId: z.string().optional(),
    fieldId: z.string().optional(),
  })
  .openapi('UploadedDocument')

const route = createRoute({
  method: 'post',
  path: '/api/cases/{caseId}/documents',
  tags: ['documents'],
  summary: 'Attach a document to a request or to a form field',
  description:
    'The type is read from the file’s first bytes, not taken from the client: PDF, PNG, JPEG ' +
    'and HEIC are accepted and stored under the type found. Was the `upload` Edge Function.',
  security,
  middleware: [
    bodyLimit({
      maxSize: MAX_BYTES + FRAMING_BYTES,
      onError: (c) =>
        c.json(
          errorBody(
            new ApiError('bad_request', 'That file is larger than 10MB. Try a smaller one.'),
            c.get('requestId') as string,
          ),
          400,
        ),
    }),
  ],
  request: {
    params: caseParams,
    body: { required: true, content: { 'multipart/form-data': { schema: formSchema } } },
  },
  responses: {
    201: {
      description: 'Stored.',
      content: { 'application/json': { schema: uploadedSchema } },
    },
    ...authenticatedErrors,
    400: errorResponse('No usable file, or not a document type we accept.'),
    403: errorResponse('The caller has no seat on this case.'),
    404: errorResponse('No such request or form application on this case.'),
    409: errorResponse('The request has already been dealt with.'),
  },
})

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')
const asNumber = (value: unknown): number =>
  typeof value === 'number' || typeof value === 'string' ? Number(value) : 0

export const documentRoutes = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  const { caseId } = c.req.valid('param')
  const form = c.req.valid('form')
  const uploads = c.get('uploads')

  const seat = await uploads.seat(c.get('user').id, caseId)
  if (!seat) throw new ApiError('forbidden', 'This is not your case.')
  const actor = seat.role === 'partner' ? 'partner' : 'customer'

  const file = form.file
  const requestId = asText(form.requestId)
  const formApplicationId = asText(form.formApplicationId)
  const fieldId = asText(form.fieldId)

  // Two kinds of document. A journey document answers a requirement Saoirse wrote and is tracked in
  // `documents` with a verification state the bank controls. A form document answers an upload
  // control on the bank's own published form, and is a reference in a packet.
  const toForm = formApplicationId.length > 0
  if (!toForm && requestId.length === 0) {
    throw new ApiError('bad_request', 'Which document is this for?')
  }
  if (file.size === 0) throw new ApiError('bad_request', 'That file is empty.')
  if (file.size > MAX_BYTES) {
    throw new ApiError('bad_request', 'That file is larger than 10MB. Try a smaller one.')
  }
  if (!ALLOWED_MIME.has(file.type)) throw new ApiError('bad_request', 'Send a PDF or a photo.')

  // The declared type is a claim. Store what the bytes are.
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = sniffDocument(bytes)
  if (!kind) throw new ApiError('bad_request', 'That file is not a PDF or a photo we can read.')

  if (toForm) {
    if (fieldId === '') throw new ApiError('bad_request', 'Which part of the form is this for?')

    const application = await uploads.findFormApplication(caseId, formApplicationId)
    if (!application) throw new ApiError('not_found', 'There is no such form application.')

    const field = formSnapshot(application.formId)?.definition.fields.find(
      (candidate) => candidate.id === fieldId,
    )
    if (!field || field.type !== 'fileupload') {
      throw new ApiError('bad_request', 'That is not a document this form asks for.')
    }

    // The form's own limits, not ours: the definition is the contract.
    const maxMb = asNumber(field.platform?.['maxFileSize'])
    if (Number.isFinite(maxMb) && maxMb > 0 && file.size > maxMb * 1024 * 1024) {
      throw new ApiError('bad_request', `That file is larger than ${String(maxMb)}MB.`)
    }

    const allowed = asText(field.platform?.['allowedExtensions'])
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
    const named = file.name.includes('.')
      ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
      : ''
    if (allowed.length > 0 && !allowed.includes(named)) {
      throw new ApiError('bad_request', `This one takes ${allowed.join(', ')}.`)
    }

    const storagePath = `${caseId}/form-${application.formId}-${fieldId}-${crypto.randomUUID()}.${kind.extension}`
    await uploads.putFile(storagePath, bytes, kind.mime)
    await uploads.recordFormFile({
      formApplicationId: application.id,
      fieldId,
      participantId: seat.participantId,
      // A reference, never the bytes and never a signature: a fabricated hash is a forged
      // credential, however synthetic the file it describes.
      value: { fileName: file.name, sizeBytes: file.size, mimeType: kind.mime, storagePath },
    })
    await uploads.writeEvent({
      caseId,
      type: 'document_uploaded',
      actor,
      payload: { form: application.formId, fieldId, fileName: file.name },
    })
    return c.json({ fileName: file.name, fieldId }, 201)
  }

  // The open request is the authorisation: it names the application on this case.
  const held = await uploads.findRequest(caseId, requestId)
  if (!held) throw new ApiError('not_found', 'There is no such request.')
  if (held.status !== 'open') throw new ApiError('conflict', 'That has already been dealt with.')

  // The path takes its extension from the bytes, never from the file name.
  const storagePath = `${caseId}/${crypto.randomUUID()}.${kind.extension}`
  await uploads.putFile(storagePath, bytes, kind.mime)

  await uploads.recordDocument({
    caseId,
    applicationId: held.application.id,
    requirementId: held.requirementId,
    participantId: seat.participantId,
    documentType: asText(form.documentType) || 'bank_statement',
    storagePath,
    fileName: file.name,
  })
  await uploads.fulfilRequest(held.id)
  await uploads.writeEvent({
    caseId,
    type: 'document_uploaded',
    actor,
    payload: { requirementId: held.requirementId, fileName: file.name },
  })
  await settleInformationRequest(uploads, {
    caseId,
    application: held.application,
    actor,
    requirementId: held.requirementId,
    fileName: file.name,
  })

  return c.json({ fileName: file.name, requirementId: held.requirementId }, 201)
})
