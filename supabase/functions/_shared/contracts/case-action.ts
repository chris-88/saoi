import { CONSENT_SCOPE, LINKABLE_BANK_IDS } from './cards.ts'
import { z } from 'zod'
import { PRODUCTS } from '../domain/journey.ts'
import { APPLICATION_STATES } from '../domain/state-machine.ts'

/**
 * `case-action` — everything the customer commits by tapping (Invariant 1, §27, §48).
 *
 * The model has no tool that reaches any of these. Each one validates session access, the
 * application's state, the information it requires, and the business rules, before anything
 * changes.
 */

const caseId = z.uuid()
const applicationId = z.uuid()

export const caseActionRequestSchema = z.discriminatedUnion('action', [
  /** §6 Stage 6 — the customer chooses, and several applications start at once. */
  z.object({
    action: z.literal('select_products'),
    caseId,
    /**
     * A kind, and optionally which product of that kind.
     *
     * Was a bare list of kinds, which could not express "SuperSaver and the notice account":
     * both are `savings`, so two choices arrived as one and one application was started.
     */
    products: z
      .array(
        z.object({
          product: z.enum(PRODUCTS),
          catalogueId: z.string().min(1).max(80).optional(),
        }),
      )
      .min(1)
      .max(5),
  }),

  /** §49 — declining must stick, so it is recorded rather than merely not chosen. */
  z.object({
    action: z.literal('decline_product'),
    caseId,
    product: z.enum(PRODUCTS),
  }),

  /** Confirming a reused value, a declaration, or a consent, for one application (§11). */
  z.object({
    action: z.literal('confirm_requirement'),
    applicationId,
    requirementId: z.string().min(1).max(80),
  }),

  /**
   * §48 — the only route out of `ready`, and only from the review card.
   *
   * The confirmations the customer ticked travel with it, so an application cannot end up
   * half-confirmed if the tap fails partway: either everything is agreed and it submits, or
   * nothing changes.
   */
  z.object({
    action: z.literal('submit_application'),
    applicationId,
    confirmations: z.array(z.string().min(1).max(80)).max(40).default([]),
  }),

  /** §6 Stage 8 — the customer decides to hold an application. */
  z.object({
    action: z.literal('pause_application'),
    applicationId,
  }),

  z.object({
    action: z.literal('resume_application'),
    applicationId,
  }),

  /**
   * §6 Stage 9 — invites the second applicant.
   *
   * Creates the partner participant and a single-use link. Nothing is sent anywhere: the
   * customer shares the link themselves, which keeps the prototype free of real delivery.
   */
  /**
   * §10, §37 — the customer takes the plan on, or changes their mind about it later. Keeping
   * and abandoning are the same kind of decision and go through the same door.
   */
  z.object({
    action: z.literal('decide_plan'),
    caseId: z.uuid(),
    planId: z.uuid(),
    decision: z.enum(['keep', 'not_now', 'pause', 'resume', 'abandon']),
  }),

  z.object({
    action: z.literal('invite_partner'),
    caseId,
    name: z.string().min(1).max(80),
  }),

  /**
   * §42 — this browser would like to be told when something moves.
   *
   * The values come from the browser's own Push API subscription and are only useful for
   * sending to it: the endpoint is the push service's URL for this browser, and the two keys
   * are what let a payload be encrypted so only it can open them. Stored, never read back to
   * a client.
   */
  z.object({
    action: z.literal('subscribe_push'),
    caseId,
    endpoint: z.url().max(2000),
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),

  /** §7.5 — explicit consent, recorded, before any sensitive question is asked. */
  z.object({
    action: z.literal('grant_consent'),
    applicationId,
    requirementId: z.string().min(1).max(80),
  }),

  /**
   * The declarations the bank's own form requires, each one ticked.
   *
   * Field ids rather than wording: the server reads the text out of the published definition
   * and stores what it showed, so what is recorded as agreed to cannot drift from what was on
   * screen, and a client cannot submit a declaration by inventing a nicer sentence.
   */
  z.object({
    action: z.literal('confirm_form_declarations'),
    applicationId,
    fieldIds: z.array(z.string().min(1).max(12)).min(1).max(20),
  }),

  /**
   * The structured health form (§7.5, Invariant 6).
   *
   * This is the only path by which special-category data enters the case, and the server
   * refuses it unless the matching consent is already recorded.
   */
  z.object({
    action: z.literal('submit_health_form'),
    applicationId,
    values: z
      .array(z.object({ key: z.string().min(1), value: z.unknown() }))
      .min(1)
      .max(20),
  }),

  /**
   * Open banking, simulated. Linking is the consent tap on the `connect_accounts` card: the
   * server generates the accounts and ninety days of transactions from the case's own facts.
   * Revoking removes the consent and everything read under it. A transfer is the tap on a
   * `transfer` card; the server initiates it and the console settles it.
   */
  z.object({
    action: z.literal('link_accounts'),
    caseId,
    bank: z.enum(LINKABLE_BANK_IDS),
    scope: z.array(z.enum(CONSENT_SCOPE)).min(1),
  }),
  z.object({ action: z.literal('revoke_accounts'), caseId }),

  /**
   * Feedback from the conversation (§44). A thumbs on one of Saoirse's replies, with an optional
   * line on a thumbs-down, or a rating of the whole thing from the menu with some words and
   * an address if they want a reply. Kept against the case and the message.
   */
  z.object({
    action: z.literal('give_feedback'),
    caseId,
    // One member, because a discriminated union cannot carry the same action twice. What
    // each kind requires (a message and a thumbs for `turn`, one to five for `session`) is
    // checked by the handler, which refuses with a reason rather than a schema error.
    kind: z.enum(['turn', 'session']),
    messageId: z.uuid().optional(),
    rating: z.number().int().min(-1).max(5),
    comment: z.string().trim().max(2000).optional(),
    replyTo: z.string().trim().email().max(200).optional(),
  }),
  z.object({
    action: z.literal('initiate_transfer'),
    caseId,
    fromAccountId: z.uuid(),
    /** Null means the current account they already hold here, which the case must know of. */
    toApplicationId: applicationId.nullable(),
    amount: z.number().positive().max(1_000_000),
    cadence: z.enum(['once', 'monthly']),
  }),
])

export type CaseActionRequest = z.infer<typeof caseActionRequestSchema>
export type CaseActionName = CaseActionRequest['action']

export const applicationSummarySchema = z.object({
  id: applicationId,
  product: z.enum(PRODUCTS),
  displayName: z.string(),
  state: z.enum(APPLICATION_STATES),
  stateLabel: z.string(),
  outstanding: z.array(z.string()),
  outstandingForPartner: z.array(z.string()),
  waitingOn: z.enum(['primary', 'partner']).nullable(),
  /** 0 to 1. Satisfied blocking requirements over total blocking requirements. */
  progress: z.number().min(0).max(1),
})

export const caseActionResponseSchema = z.object({
  applications: z.array(applicationSummarySchema),
  /** Present only after an invite: the link for the customer to share (§29, §58). */
  inviteUrl: z.string().optional(),
  /** What changed, in the customer's language, for the confirmation line. */
  summary: z.string(),
})

export type ApplicationSummary = z.infer<typeof applicationSummarySchema>
export type CaseActionResponse = z.infer<typeof caseActionResponseSchema>
