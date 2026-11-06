import { z } from 'zod'

/**
 * The partner experience (§6 Stage 9, §33).
 *
 * Invariant 7: a partner never reads a table. Everything here is a scoped DTO — their own
 * tasks, their own answers, and the names and states of applications they are party to.
 * Never the primary customer's conversation, and never the primary's facts.
 */

export const partnerRequestSchema = z.discriminatedUnion('action', [
  /** Redeems the invite. Single-use, like every other token (§58). */
  z.object({ action: z.literal('join'), token: z.string().min(16).max(64) }),
  z.object({ action: z.literal('tasks') }),
  z.object({
    action: z.literal('submit'),
    answers: z
      .array(z.object({ id: z.string(), value: z.unknown() }))
      .min(1)
      .max(20),
  }),
])

export const partnerTaskSchema = z.object({
  id: z.string(),
  kind: z.enum(['fact', 'declaration', 'document']),
  label: z.string(),
  inputKind: z.enum(['text', 'number', 'boolean', 'date', 'select', 'none']),
  /** For `select`, the only answers the catalogue will accept. */
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  /**
   * The applications this one answer satisfies. This is the whole point of §6 Stage 9 — one
   * answer, several journeys — so it is carried to the screen rather than merely being true.
   */
  appliesTo: z.array(z.string()).min(1),
  done: z.boolean(),
})

export const partnerViewSchema = z.object({
  partnerName: z.string().nullable(),
  invitedBy: z.string().nullable(),
  applications: z.array(
    z.object({ displayName: z.string(), stateLabel: z.string(), waitingOnYou: z.boolean() }),
  ),
  tasks: z.array(partnerTaskSchema),
})

export type PartnerRequest = z.infer<typeof partnerRequestSchema>
export type PartnerTask = z.infer<typeof partnerTaskSchema>
export type PartnerView = z.infer<typeof partnerViewSchema>

/** `POST /api/partner/join`. */
export const partnerJoinBodySchema = z.object({ token: z.string().min(16).max(64) })
/** `POST /api/partner/submit`. */
export const partnerSubmitBodySchema = z.object({
  answers: z
    .array(z.object({ id: z.string(), value: z.unknown() }))
    .min(1)
    .max(20),
})
