import type { CaseSnapshot } from '@shared/contracts/case-read.ts'
import type { SnapshotRows } from '../../store/cases.ts'

/** Table rows to the wire shape. No I/O; the card derivation itself is `settledState`. */
export function buildSnapshot(caseId: string, signedIn: boolean, rows: SnapshotRows): CaseSnapshot {
  const reusedBy: Record<string, number> = {}
  for (const applicationId of rows.reusedApplicationIds) {
    if (applicationId === null) continue
    reusedBy[applicationId] = (reusedBy[applicationId] ?? 0) + 1
  }

  return {
    caseId,
    signedIn,
    applications: [...rows.applications],
    interests: [...rows.interests],
    plans: [...rows.plans],
    requests: [...rows.requests],
    formAnswers: [...rows.formAnswers],
    reusedBy,
    linkedAccounts: rows.linkedAccounts.map((row) => ({
      id: row.id,
      bank: row.bank,
      displayName: row.display_name,
      consentExpiresAt: row.consent_expires_at,
      revokedAt: row.revoked_at,
    })),
    // `numeric` columns can arrive as strings; a card compares its amount as a number.
    transfers: rows.transfers.map((row) => ({ ...row, amount: Number(row.amount) })),
    notifications: rows.notifications.map((row) => {
      const payload =
        typeof row.payload === 'object' && row.payload !== null
          ? (row.payload as Record<string, unknown>)
          : {}
      return {
        id: row.id,
        title: typeof payload['title'] === 'string' ? payload['title'] : 'Saoirse',
        // Older notifications predate the copy being recorded, so they say what is known.
        body:
          typeof payload['body'] === 'string'
            ? payload['body']
            : 'An update about something you are working on.',
        at: row.created_at,
      }
    }),
  }
}
