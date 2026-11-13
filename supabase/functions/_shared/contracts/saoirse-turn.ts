import { z } from 'zod'
import { MAX_INPUT_LENGTH } from '../llm/gate.ts'
import { PRODUCT_SELECTION_MAX, productSelectionSchema } from './cards.ts'

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
  /**
   * The products the customer has selected on the cards, sent with their message (Chris,
   * 2026-11-13: select products from any card, then compare them). Each is a row's `id` and
   * `lead` as the card showed them, in the order they were selected. The turn hands them to the
   * model with the message; only this turn's selection is current.
   */
  selection: z.array(productSelectionSchema).max(PRODUCT_SELECTION_MAX).optional(),
})

export type SaoirseTurnRequest = z.infer<typeof saoirseTurnRequestSchema>
