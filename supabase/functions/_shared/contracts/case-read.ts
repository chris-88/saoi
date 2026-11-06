import { z } from 'zod'
import { cardSchema } from './cards.ts'

/**
 * The read side of a case, as `saoi-api` serves it (`GET /api/cases/:caseId/...`).
 *
 * These replace the direct table reads the public app used to make under RLS: the browser asks
 * the service for the snapshot, the transcript and the change feed, and never sees a table.
 * Schemas only; compiles under Node, Deno and Vite.
 */

export const settledSchema = z.object({
  label: z.string(),
  note: z.string().optional(),
})

export const caseSnapshotSchema = z.object({
  caseId: z.uuid(),
  /** False for an anonymous session; read from the caller's token, not the database. */
  signedIn: z.boolean(),
  applications: z.array(
    z.object({
      id: z.string(),
      product: z.string(),
      state: z.string(),
      catalogue_id: z.string().nullable(),
    }),
  ),
  interests: z.array(z.object({ product: z.string(), status: z.string() })),
  plans: z.array(z.object({ id: z.string(), status: z.string() })),
  requests: z.array(z.object({ id: z.string(), status: z.string() })),
  formAnswers: z.array(z.object({ field_id: z.string(), source: z.string() })),
  /** Requirements satisfied without asking, per application id (§53). */
  reusedBy: z.record(z.string(), z.number()),
  /** Every consent on the case, revoked included, so a card can say "stopped sharing". */
  linkedAccounts: z.array(
    z.object({
      id: z.string(),
      bank: z.string(),
      displayName: z.string(),
      consentExpiresAt: z.string(),
      revokedAt: z.string().nullable(),
    }),
  ),
  transfers: z.array(
    z.object({
      to_application_id: z.string().nullable(),
      amount: z.number(),
      state: z.string(),
    }),
  ),
  /** The newest notifications sent to this customer, newest first. */
  notifications: z.array(
    z.object({ id: z.string(), title: z.string(), body: z.string(), at: z.string() }),
  ),
})
export type CaseSnapshot = z.infer<typeof caseSnapshotSchema>

export const historyEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    id: z.string(),
    author: z.enum(['assistant', 'customer']),
    text: z.string(),
    messageId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('card'),
    id: z.string(),
    card: cardSchema,
    settled: settledSchema.optional(),
  }),
])

export const caseHistorySchema = z.object({
  caseId: z.uuid(),
  entries: z.array(historyEntrySchema),
})
export type CaseHistory = z.infer<typeof caseHistorySchema>

/** `event: ready`, sent once when a stream opens. `latest` is the newest narratable event. */
export const caseFeedReadySchema = z.object({
  caseId: z.uuid(),
  latest: z.object({ id: z.string(), text: z.string() }).nullable(),
})

/** `event: update`, sent for each narratable event after the stream opened. `id` is the SSE id. */
export const caseFeedUpdateSchema = z.object({
  id: z.string(),
  type: z.string(),
  text: z.string(),
  at: z.string(),
})
export type CaseFeedReady = z.infer<typeof caseFeedReadySchema>
export type CaseFeedUpdate = z.infer<typeof caseFeedUpdateSchema>
