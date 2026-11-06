import { sweepUsers } from '@shared/db/purge-users.ts'
import type { Json } from '@shared/db/database.types.ts'
import { canonicalCase } from '@shared/domain/seed/canonical.ts'
import { ApiError } from '../../errors.ts'
import type { Db } from '../client.ts'

/**
 * The destructive case actions. Reset, delete and purge each run as ONE Postgres function
 * (`admin_reset_case`, `admin_delete_case`, `admin_purge_cases`, migration
 * `20261104150000_admin_audit.sql`) called through RPC, so the work and its `admin_audit` row
 * commit together or not at all. supabase-js cannot hold a transaction across calls and this
 * service has no direct Postgres connection, so a function is the transaction boundary.
 */
export interface AdminCasesStore {
  /** Replaces the named case with the canonical presenter case. 404 when there is no such case. */
  resetCase(caseId: string, adminUserId: string): Promise<{ caseId: string; facts: number }>
  /** Deletes the case and everything under it. 404 when there is no such case. */
  deleteCase(caseId: string, adminUserId: string): Promise<{ deleted: string }>
  /** Deletes every case, then every auth user except administrators. */
  purgeCases(adminUserId: string): Promise<{ purged: number; usersRemoved: number }>
  /** Takes a probe's case out of the capacity count by making it `kind = 'test'`. */
  tagTestCase(caseId: string): Promise<{ caseId: string; kind: 'test' }>
}

const customer = canonicalCase.customer

export function supabaseAdminCasesStore(db: Db): AdminCasesStore {
  return {
    async resetCase(caseId, adminUserId) {
      const result = await db.rpc('admin_reset_case', {
        p_case: caseId,
        p_admin: adminUserId,
        p_label: canonicalCase.label,
        p_first_name: customer.firstName,
        p_customer: {
          bank_reference: customer.bankReference,
          full_name: customer.fullName,
          date_of_birth: customer.dateOfBirth,
          email: customer.email,
          mobile: customer.mobile,
          existing_products: [...customer.existingProducts],
        },
        p_facts: canonicalCase.bankHeldFacts.map((fact) => ({
          key: fact.key,
          household: fact.subject === 'household',
          value: fact.value as Json,
          source: fact.source,
          verified: fact.verified,
        })),
      })
      if (result.error) throw new Error(`Could not reset the case: ${result.error.message}`)
      const created = result.data as { caseId: string; facts: number } | null
      if (created === null) throw new ApiError('not_found', 'No case with that id.')
      return { caseId: created.caseId, facts: created.facts }
    },

    async deleteCase(caseId, adminUserId) {
      const result = await db.rpc('admin_delete_case', { p_case: caseId, p_admin: adminUserId })
      if (result.error) throw new Error(`Could not delete the case: ${result.error.message}`)
      if (result.data !== true) throw new ApiError('not_found', 'No case with that id.')
      return { deleted: caseId }
    },

    async purgeCases(adminUserId) {
      const purge = await db.rpc('admin_purge_cases', { p_admin: adminUserId })
      if (purge.error) throw new Error(`Could not purge the cases: ${purge.error.message}`)
      const { purged, auditId } = purge.data as { purged: number; auditId: string }

      // The visitors themselves: deleting every case leaves every auth user behind, so a
      // browser that had been here before would still resolve to a real account. Administrators
      // are kept, since purging yourself out of the console is a lockout, not a reset. This
      // is GoTrue, outside the database, so it cannot join the transaction above; the count is
      // noted on the audit row once known.
      const admins = await db.from('admin_users').select('auth_user_id')
      if (admins.error) throw new Error(`Could not read admin_users: ${admins.error.message}`)
      const keep = new Set(admins.data.map((row) => row.auth_user_id))

      const sweep = await sweepUsers(
        {
          list: async () => {
            const listed = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
            if (listed.error) return { users: [], error: { message: listed.error.message } }
            return { users: listed.data.users.map((user) => ({ id: user.id })), error: null }
          },
          remove: async (id) => {
            const removed = await db.auth.admin.deleteUser(id)
            return { error: removed.error ? { message: removed.error.message } : null }
          },
        },
        keep,
      )
      if (sweep.error) throw new Error(`Could not sweep the users: ${sweep.error}`)

      await db.rpc('admin_audit_note', {
        p_audit: auditId,
        p_detail: { usersRemoved: sweep.removed },
      })
      return { purged, usersRemoved: sweep.removed }
    },

    async tagTestCase(caseId) {
      const tagged = await db
        .from('cases')
        .update({ kind: 'test' })
        .eq('id', caseId)
        .select('id')
        .maybeSingle()
      if (tagged.error) throw new Error(`Could not tag the case: ${tagged.error.message}`)
      if (!tagged.data) throw new ApiError('not_found', 'No case with that id.')
      return { caseId, kind: 'test' }
    },
  }
}
