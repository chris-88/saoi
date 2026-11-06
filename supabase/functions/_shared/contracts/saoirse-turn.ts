import { z } from 'zod'
import { MAX_INPUT_LENGTH } from '../llm/gate.ts'

/** The request body for `saoirse-turn`. Validated before anything else happens. */
export const saoirseTurnRequestSchema = z.object({
  caseId: z.uuid(),
  /**
   * Why this turn is running.
   *
   * `return` makes the digest include everything that changed since the customer was last here
   * (§36). `action` is the customer having tapped something — started applications, kept a plan,
   * uploaded a document — which Saoirse has to respond to but which nobody typed.
   */
  trigger: z.enum(['message', 'opening', 'return', 'action']).default('message'),
  /**
   * For `message`, what the customer typed. For `action`, what the interface did on their
   * behalf, in the server's words. Absent for `opening` and `return`.
   */
  message: z.string().max(MAX_INPUT_LENGTH).optional(),
  /**
   * For `action`: what Saoirse should do about it.
   *
   * Separate from `message` because only `message` is recorded. A note telling Saoirse how to
   * respond is direction, not something that happened, and it has no business in the transcript
   * a person reads before phoning the customer.
   */
  note: z.string().max(400).optional(),
})

export type SaoirseTurnRequest = z.infer<typeof saoirseTurnRequestSchema>
