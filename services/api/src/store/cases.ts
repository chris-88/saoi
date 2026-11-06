import { must, type Db } from './client.ts'
import { supabaseActionStore, type CaseActionStore } from './actions.ts'
import type { MessageRow } from '@shared/domain/card-state.ts'

/**
 * Everything the case read endpoints need from the database, as one seam.
 *
 * The routes talk to this interface; `supabaseStore` is the only implementation that touches
 * the service-role client, and tests supply an in-memory one. Rows come back as the table has
 * them: turning them into the response is `routes/cases/snapshotBuilder.ts`, which has no I/O.
 */

export type EventRow = {
  readonly id: string
  readonly type: string
  readonly payload: unknown
  readonly created_at: string
}

export type SnapshotRows = {
  readonly applications: readonly {
    id: string
    product: string
    state: string
    catalogue_id: string | null
  }[]
  readonly interests: readonly { product: string; status: string }[]
  readonly plans: readonly { id: string; status: string }[]
  readonly requests: readonly { id: string; status: string }[]
  readonly formAnswers: readonly { field_id: string; source: string }[]
  /** `application_id` of every `context_reused` event on the case. */
  readonly reusedApplicationIds: readonly (string | null)[]
  readonly linkedAccounts: readonly {
    id: string
    bank: string
    display_name: string
    consent_expires_at: string
    revoked_at: string | null
  }[]
  readonly transfers: readonly {
    to_application_id: string | null
    amount: number | string
    state: string
  }[]
  readonly notifications: readonly EventRow[]
}

/** Who a caller is on a case. `admin` is an `admin_users` row with no seat on the case. */
export const CASE_ROLES = ['primary', 'partner', 'admin'] as const
export type CaseRole = (typeof CASE_ROLES)[number]

/** A user's standing on a case: what `requireCaseAccess` puts on the context. */
export type CaseAccess = {
  readonly caseId: string
  /** The seat the caller holds. Null for an administrator, who sits on no case. */
  readonly participantId: string | null
  readonly role: CaseRole
}

export type CaseReadStore = {
  /**
   * The user's access to the case in one of `roles` (default: the primary customer only, which
   * is what RLS allowed the browser to read), or null.
   */
  caseAccess(
    userId: string,
    caseId: string,
    roles?: readonly CaseRole[],
  ): Promise<CaseAccess | null>
  loadSnapshotRows(caseId: string): Promise<SnapshotRows>
  /** The newest messages, oldest first. */
  loadMessages(caseId: string, limit: number): Promise<readonly MessageRow[]>
  /** Newest first. */
  recentEvents(caseId: string, limit: number): Promise<readonly EventRow[]>
  /** Events created at or after the instant, oldest first. */
  eventsSince(caseId: string, since: string, limit: number): Promise<readonly EventRow[]>
  /** The instant an event was written, for resuming from `Last-Event-ID`. */
  eventCreatedAt(caseId: string, eventId: string): Promise<string | null>
}

/** What the routes under `/api/cases/:caseId` use: the reads and the actions. */
export type CaseStore = CaseReadStore & CaseActionStore

export function supabaseStore(db: Db, options: { appBaseUrl?: string } = {}): CaseStore {
  return { ...supabaseReadStore(db), ...supabaseActionStore(db, options) }
}

function supabaseReadStore(db: Db): CaseReadStore {
  return {
    async caseAccess(userId, caseId, roles = ['primary']) {
      /*
       * Exactly the check `case-action` makes (a participant session on the case), narrowed to
       * the roles asked for. The read routes ask for the primary customer only, because the
       * browser read this data under `can_read_case`, which a partner never satisfied
       * (invariant 7). An administrator holds no seat: the roster is the evidence.
       */
      const seatRoles = roles.filter((role) => role !== 'admin')
      if (seatRoles.length > 0) {
        const result = await db
          .from('participant_sessions')
          .select('participant_id, participants!inner(case_id, role)')
          .eq('auth_user_id', userId)
          .eq('participants.case_id', caseId)
          .in('participants.role', seatRoles)
          .limit(5)
        const rows = must(result, 'access') as unknown as {
          participant_id: string
          participants: { role: string } | null
        }[]
        // The primary seat wins if a browser somehow holds both.
        const seat = rows.find((row) => row.participants?.role === 'primary') ?? rows[0]
        if (seat) {
          const role: CaseRole = seat.participants?.role === 'partner' ? 'partner' : 'primary'
          return { caseId, participantId: seat.participant_id, role }
        }
      }

      if (roles.includes('admin')) {
        const admin = await db
          .from('admin_users')
          .select('auth_user_id')
          .eq('auth_user_id', userId)
          .maybeSingle()
        if (must(admin, 'admin') !== null) return { caseId, participantId: null, role: 'admin' }
      }
      return null
    },

    async loadSnapshotRows(caseId) {
      const [
        applications,
        interests,
        plans,
        forms,
        reused,
        linkedAccounts,
        transfers,
        notifications,
      ] = await Promise.all([
        db.from('applications').select('id, product, state, catalogue_id').eq('case_id', caseId),
        db.from('product_interests').select('product, status').eq('case_id', caseId),
        db.from('plans').select('id, status').eq('case_id', caseId),
        db.from('form_applications').select('id').eq('case_id', caseId),
        db
          .from('events')
          .select('application_id')
          .eq('case_id', caseId)
          .eq('type', 'context_reused'),
        db
          .from('linked_accounts')
          .select('id, bank, display_name, consent_expires_at, revoked_at')
          .eq('case_id', caseId)
          .order('created_at', { ascending: true }),
        db.from('transfers').select('to_application_id, amount, state').eq('case_id', caseId),
        db
          .from('events')
          .select('id, type, payload, created_at')
          .eq('case_id', caseId)
          .eq('type', 'notification_sent')
          .order('created_at', { ascending: false })
          .limit(20),
      ])

      const applicationRows = must(applications, 'applications')
      const applicationIds = applicationRows.map((row) => row.id)
      const formIds = must(forms, 'form applications').map((row) => row.id)

      // These hang off the case through another table, so they need the ids first. The browser
      // asked for every request RLS allowed; here they are scoped to this case explicitly.
      const [requests, formAnswers] = await Promise.all([
        applicationIds.length === 0
          ? Promise.resolve([])
          : db
              .from('application_requests')
              .select('id, status')
              .in('application_id', applicationIds)
              .then((result) => must(result, 'requests')),
        formIds.length === 0
          ? Promise.resolve([])
          : db
              .from('form_answers')
              .select('field_id, source')
              .in('form_application_id', formIds)
              .then((result) => must(result, 'form answers')),
      ])

      return {
        applications: applicationRows,
        interests: must(interests, 'product interests'),
        plans: must(plans, 'plans'),
        requests,
        formAnswers,
        reusedApplicationIds: must(reused, 'events').map((row) => row.application_id),
        linkedAccounts: must(linkedAccounts, 'linked accounts'),
        transfers: must(transfers, 'transfers'),
        notifications: must(notifications, 'notifications'),
      }
    },

    async loadMessages(caseId, limit) {
      const result = await db
        .from('messages')
        .select('id, role, content, cards')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(limit)
      return must(result, 'messages')
        .map((row): MessageRow => ({
          id: row.id,
          role: row.role === 'customer' || row.role === 'system' ? row.role : 'assistant',
          content: row.content,
          cards: Array.isArray(row.cards) ? (row.cards as readonly unknown[]) : [],
        }))
        .reverse()
    },

    async recentEvents(caseId, limit) {
      const result = await db
        .from('events')
        .select('id, type, payload, created_at')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(limit)
      return must(result, 'events')
    },

    async eventsSince(caseId, since, limit) {
      const result = await db
        .from('events')
        .select('id, type, payload, created_at')
        .eq('case_id', caseId)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .limit(limit)
      return must(result, 'events')
    },

    async eventCreatedAt(caseId, eventId) {
      const result = await db
        .from('events')
        .select('created_at')
        .eq('case_id', caseId)
        .eq('id', eventId)
        .maybeSingle()
      return must(result, 'event')?.created_at ?? null
    },
  }
}
