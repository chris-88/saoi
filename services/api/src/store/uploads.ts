import { mustWrite, writeEvent } from '@shared/db/case-repository.ts'
import type { Json } from '@shared/db/database.types.ts'
import type { Product } from '@shared/domain/journey.ts'
import type { ApplicationState } from '@shared/domain/state-machine.ts'
import type { Db } from './client.ts'

/** What the document route needs from the database and the private `documents` bucket. */

/** The application a request belongs to, as far as the state machine needs it. */
export type HeldApplication = {
  readonly id: string
  readonly product: Product
  readonly state: ApplicationState
  readonly resumeTo: ApplicationState | null
}

export type HeldRequest = {
  readonly id: string
  readonly status: string
  readonly requirementId: string
  readonly application: HeldApplication
}

export type Seat = { readonly participantId: string; readonly role: string }

export type EventInput = {
  caseId: string
  type: string
  actor: 'customer' | 'partner'
  applicationId?: string
  payload: Record<string, unknown>
}

export type UploadStore = {
  /** The user's seat on the case in any role: a partner uploads too. */
  seat(userId: string, caseId: string): Promise<Seat | null>
  /** A request on this case, or null. */
  findRequest(caseId: string, requestId: string): Promise<HeldRequest | null>
  findFormApplication(caseId: string, id: string): Promise<{ id: string; formId: string } | null>
  /** Throws when the object was not stored. */
  putFile(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  recordDocument(input: {
    caseId: string
    applicationId: string
    requirementId: string
    participantId: string
    documentType: string
    storagePath: string
    fileName: string
  }): Promise<void>
  fulfilRequest(requestId: string): Promise<void>
  openRequestCount(applicationId: string): Promise<number>
  setApplicationState(
    applicationId: string,
    state: ApplicationState,
    resumeTo: ApplicationState | null,
  ): Promise<void>
  recordFormFile(input: {
    formApplicationId: string
    fieldId: string
    participantId: string
    value: Record<string, unknown>
  }): Promise<void>
  writeEvent(input: EventInput): Promise<void>
}

export function supabaseUploadStore(db: Db): UploadStore {
  return {
    async seat(userId, caseId) {
      const result = await db
        .from('participant_sessions')
        .select('participant_id, participants!inner(case_id, role)')
        .eq('auth_user_id', userId)
        .eq('participants.case_id', caseId)
        .limit(1)
      const row = (
        result.data as unknown as
          { participant_id: string; participants: { role: string } | null }[] | null
      )?.[0]
      return row?.participants
        ? { participantId: row.participant_id, role: row.participants.role }
        : null
    },

    async findRequest(caseId, requestId) {
      const result = await db
        .from('application_requests')
        .select(
          'id, status, requirement_id, application_id, ' +
            'applications!inner(id, case_id, product, state, resume_to)',
        )
        .eq('id', requestId)
        .eq('applications.case_id', caseId)
        .maybeSingle()
      const row = result.data as unknown as {
        id: string
        status: string
        requirement_id: string
        applications: {
          id: string
          product: Product
          state: ApplicationState
          resume_to: ApplicationState | null
        }
      } | null
      if (!row) return null
      return {
        id: row.id,
        status: row.status,
        requirementId: row.requirement_id,
        application: {
          id: row.applications.id,
          product: row.applications.product,
          state: row.applications.state,
          resumeTo: row.applications.resume_to,
        },
      }
    },

    async findFormApplication(caseId, id) {
      const result = await db
        .from('form_applications')
        .select('id, form_id')
        .eq('id', id)
        .eq('case_id', caseId)
        .maybeSingle()
      return result.data ? { id: result.data.id, formId: result.data.form_id } : null
    },

    async putFile(path, bytes, contentType) {
      const stored = await db.storage
        .from('documents')
        .upload(path, bytes, { contentType, upsert: false })
      if (stored.error) throw new Error(`Storage upload failed: ${stored.error.message}`)
    },

    async recordDocument(input) {
      mustWrite(
        await db.from('documents').insert({
          case_id: input.caseId,
          application_id: input.applicationId,
          requirement_id: input.requirementId,
          participant_id: input.participantId,
          document_type: input.documentType,
          storage_path: input.storagePath,
          file_name: input.fileName,
          // Nothing has checked it. A requirement marked requiresVerification stays
          // outstanding until the bank says otherwise, which is the truthful state (§14).
          verified: false,
        }),
        'the document',
      )
    },

    async fulfilRequest(requestId) {
      mustWrite(
        await db
          .from('application_requests')
          .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() })
          .eq('id', requestId),
        'the request',
      )
    },

    async openRequestCount(applicationId) {
      const open = await db
        .from('application_requests')
        .select('id', { count: 'exact', head: true })
        .eq('application_id', applicationId)
        .eq('status', 'open')
      // Thrown rather than skipped: skipping leaves the application waiting for a document
      // that has just arrived.
      if (open.error) throw new Error(`Could not read the open requests: ${open.error.message}`)
      return open.count ?? 0
    },

    async setApplicationState(applicationId, state, resumeTo) {
      mustWrite(
        await db
          .from('applications')
          .update({ state, resume_to: resumeTo })
          .eq('id', applicationId),
        'the application',
      )
    },

    async recordFormFile(input) {
      mustWrite(
        await db.from('form_answers').upsert(
          {
            form_application_id: input.formApplicationId,
            field_id: input.fieldId,
            value: input.value as unknown as Json,
            source: 'document',
            participant_id: input.participantId,
          },
          { onConflict: 'form_application_id,field_id' },
        ),
        'the document reference',
      )
    },

    async writeEvent(input) {
      await writeEvent(db, {
        caseId: input.caseId,
        type: input.type,
        actor: input.actor,
        ...(input.applicationId === undefined ? {} : { applicationId: input.applicationId }),
        payload: input.payload,
      })
    },
  }
}
