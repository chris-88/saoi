import { loadCase, mustWrite, writeEvent, type Insert } from '@shared/db/case-repository.ts'
import { recomputeApplications } from '@shared/db/applications.ts'
import type { LoadedCase } from '@shared/db/loaded-case.ts'
import type { Db } from './client.ts'

/**
 * What the partner routes need from the database. A partner never reads a table (invariant 7):
 * the routes turn what comes back into scoped DTOs and nothing else leaves.
 */

export type Invite = {
  readonly caseId: string
  readonly participantId: string
  readonly expiresAt: string | null
  readonly consumedAt: string | null
}

export type PartnerSession = {
  readonly participantId: string
  readonly caseId: string
  readonly displayName: string | null
}

export type PartnerFactRow = Insert<'facts'>

export type PartnerStore = {
  /** Whether the auth user still exists (a purge leaves live tokens behind). */
  userExists(userId: string): Promise<boolean>
  findInvite(tokenHash: string): Promise<Invite | null>
  hasSession(participantId: string, userId: string): Promise<boolean>
  /** Attaches the browser to the partner participant and writes `partner_joined`. */
  join(invite: Invite, userId: string): Promise<void>
  /** The user's seat as a partner, or null. */
  partnerSession(userId: string): Promise<PartnerSession | null>
  loadCase(caseId: string): Promise<LoadedCase | null>
  /** Writes the answers, `partner_completed`, and recomputes every application. */
  recordAnswers(input: {
    caseId: string
    rows: readonly PartnerFactRow[]
    partnerName: string
  }): Promise<void>
}

type SeatRow = {
  participant_id: string
  participants: { id: string; case_id: string; role: string; display_name: string | null } | null
}

export function supabasePartnerStore(db: Db): PartnerStore {
  return {
    async userExists(userId) {
      const result = await db.auth.admin.getUserById(userId)
      return !result.error && result.data.user !== null
    },

    async findInvite(tokenHash) {
      const found = await db
        .from('tokens')
        .select('id, case_id, participant_id, expires_at, consumed_at')
        .eq('token_hash', tokenHash)
        .eq('kind', 'partner_invite')
        .maybeSingle()
      const row = found.data
      if (!row || row.case_id === null || row.participant_id === null) return null
      return {
        caseId: row.case_id,
        participantId: row.participant_id,
        expiresAt: row.expires_at,
        consumedAt: row.consumed_at,
      }
    },

    async hasSession(participantId, userId) {
      const known = await db
        .from('participant_sessions')
        .select('id')
        .eq('participant_id', participantId)
        .eq('auth_user_id', userId)
        .maybeSingle()
      return known.data !== null
    },

    async join(invite, userId) {
      mustWrite(
        await db
          .from('participant_sessions')
          .insert({ participant_id: invite.participantId, auth_user_id: userId }),
        'the session',
      )
      // Once per browser, not once per tap: reopening a link is not joining again.
      await writeEvent(db, {
        caseId: invite.caseId,
        type: 'partner_joined',
        actor: 'partner',
        payload: {},
      })
    },

    async partnerSession(userId) {
      const sessions = await db
        .from('participant_sessions')
        .select('participant_id, participants!inner(id, case_id, role, display_name)')
        .eq('auth_user_id', userId)
        .limit(10)
      const seat = (sessions.data as unknown as SeatRow[] | null)?.find(
        (row) => row.participants?.role === 'partner',
      )
      if (!seat?.participants) return null
      return {
        participantId: seat.participant_id,
        caseId: seat.participants.case_id,
        displayName: seat.participants.display_name,
      }
    },

    loadCase: (caseId) => loadCase(db, caseId),

    async recordAnswers({ caseId, rows, partnerName }) {
      if (rows.length > 0) mustWrite(await db.from('facts').insert([...rows]), 'the answers')

      await writeEvent(db, {
        caseId,
        type: 'partner_completed',
        actor: 'partner',
        payload: { answered: rows.length, partnerName },
      })

      // One partner answer can complete several applications at once (§6 Stage 9).
      const loaded = await loadCase(db, caseId)
      if (loaded) await recomputeApplications(db, loaded)
    },
  }
}
