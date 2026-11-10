import { z } from 'zod'

/**
 * `session` — attaches the caller's anonymous auth user to a participant on a case (§12, §28).
 *
 * One participant can span several auth users, because Safari and an installed PWA have
 * separate storage on iOS: the same person arrives twice and must land on the same case.
 */
/**
 * The registration form's fields, shared by the `session` action and `POST /api/interest`.
 * Anonymous, so a daily cap sits in front of it and `website` is a honeypot a person never
 * sees: anything in it is answered `ok` and stored nowhere.
 */
export const registerInterestBodySchema = z.object({
  /** An offer to work on this, or a question to answer. Absent means the former. */
  kind: z.enum(['collaborate', 'question']).optional(),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  organisation: z.string().trim().max(120).optional(),
  role: z.string().trim().max(120).optional(),
  interest: z.string().trim().min(5).max(2000),
  consent: z.literal(true),
  source: z.string().trim().max(40).optional(),
  website: z.string().max(200).optional(),
})

export const sessionRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    mode: z.enum(['new', 'known']).default('new'),
    /** Where they came in: `qr`, `poster`, `link`, or whatever the address carried. */
    source: z.string().trim().max(40).optional(),
  }),
  /** §29 — hands the case to the app. The code is opaque and single-use. */

  /**
   * The conversations this browser can open.
   *
   * A visitor sees their own. A presenter holding the key sees every case, because running a
   * demonstration means jumping back to a prepared conversation from the screen the audience
   * is looking at, not from a console on another tab.
   */
  z.object({ action: z.literal('list_cases'), presenterKey: z.string().max(200).optional() }),

  /** Move this browser onto another conversation. */
  z.object({
    action: z.literal('switch_case'),
    caseId: z.uuid(),
    presenterKey: z.string().max(200).optional(),
  }),

  /** Leave the current conversation where it is and begin a fresh one. */
  z.object({ action: z.literal('new_case'), mode: z.enum(['new', 'known']).default('new') }),

  /**
   * Somebody who wants to be contacted about working on this, from the public site. Anonymous,
   * so a daily cap sits in front of it and the `website` field is a honeypot a person never
   * sees: anything in it is refused as sent.
   */
  registerInterestBodySchema.extend({ action: z.literal('register_interest') }),

  /**
   * Carry the conversation across a change of auth user (§12, §28).
   *
   * Signing in does not always keep the user you had. An anonymous visitor who gives an
   * address Supabase has already seen cannot have it attached to the account they are on, so
   * they are signed into the existing one instead — a different `auth.uid()`, no row in
   * `participant_sessions`, and a conversation that has vanished at the exact moment it was
   * meant to be protected. One live case was orphaned this way: the anonymous user still held
   * it, and the person was standing in a new account looking at an empty screen.
   *
   * So the browser says who it was, and the server moves the participant onto who it is now.
   * `participant_sessions` is a many-to-one map already, for the same reason in a different
   * disguise: one person, several auth users.
   *
   * Which conversation then *opens* is a separate question, decided by `landingFor`: somebody
   * signing in is reaching for a conversation they already had, so the account's own wins over
   * the empty one they created by arriving. The arriving one is still attached when it has
   * anything in it, so it is in the switcher rather than gone.
   */
  z.object({ action: z.literal('claim_participant'), priorAuthUserId: z.uuid() }),
])

export type SessionRequest = z.infer<typeof sessionRequestSchema>

export const handoffResponseSchema = z.object({ code: z.string() })

export const sessionStartRequestSchema = z.object({
  action: z.literal('start'),
  source: z.string().trim().max(40).optional(),
  /**
   * `new` is somebody the bank has never met. `known` is an existing customer, signed in with
   * the details the bank already holds — the difference a real customer would feel, and where
   * §53 has anything to show.
   */
  mode: z.enum(['new', 'known']).default('new'),
})

export const sessionResponseSchema = z.object({
  caseId: z.uuid(),
  participantId: z.uuid(),
  role: z.enum(['primary', 'partner']),
  authLevel: z.enum(['anonymous', 'authenticated']),
  customerFirstName: z.string().nullable(),
  /** True when this call created the case rather than joining an existing one. */
  created: z.boolean(),
  /** §36 — something happened while they were away, so the next turn should be a return. */
  hasUpdates: z.boolean().default(false),
})

/** One row in the conversation switcher. Everything it needs and nothing it does not. */
export const caseSummarySchema = z.object({
  caseId: z.uuid(),
  /** What the presenter named it, when anything did. */
  label: z.string().nullable(),
  /** The first thing the customer said, which is what makes one conversation recognisable. */
  opening: z.string().nullable(),
  messages: z.number().int().nonnegative(),
  applications: z.number().int().nonnegative(),
  lastActivityAt: z.string().nullable(),
  /** True for the conversation this browser is in right now. */
  current: z.boolean(),
  /** True when this browser is already a participant, as opposed to reachable with the key. */
  mine: z.boolean(),
})

export const listCasesResponseSchema = z.object({
  cases: z.array(caseSummarySchema),
  /** Whether the key was accepted, so the menu can say which list it is showing. */
  presenter: z.boolean(),
})

export type CaseSummary = z.infer<typeof caseSummarySchema>
export type ListCasesResponse = z.infer<typeof listCasesResponseSchema>

export type SessionStartRequest = z.infer<typeof sessionStartRequestSchema>
export type SessionResponse = z.infer<typeof sessionResponseSchema>

/** `POST /api/sessions`: the `start` action without its discriminator. */
export const startSessionBodySchema = sessionStartRequestSchema.omit({ action: true })
/** `POST /api/cases`: the `new_case` action without its discriminator. */
export const newCaseBodySchema = z.object({ mode: z.enum(['new', 'known']).default('new') })
/** `POST /api/sessions/claim`: the `claim_participant` action without its discriminator. */
export const claimBodySchema = z.object({ priorAuthUserId: z.uuid() })
export const registerInterestResponseSchema = z.object({ registered: z.literal(true) })

/**
 * `POST /api/plans/claim`: open a plan made in the customer's own AI (`market-plan.ts`).
 *
 * The token is the one-time code from the claim link (`?plan=<token>`, or `#/plan/<token>` on
 * links made before 2026-11-10): 128 random bits,
 * base64url, stored only as its hash (Invariant 8).
 */
export const PLAN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

export const claimPlanBodySchema = z.object({
  token: z.string().regex(PLAN_TOKEN_PATTERN, 'not a plan link'),
})

/**
 * The conversation the plan is now in, which is the one this browser opens next.
 *
 * `reopened` is true when this browser had already claimed it: the same link opened twice in
 * one browser (a reload, a second tap) lands on the same conversation rather than an error.
 * Any other browser gets 409 `conflict`; an expired link 410 `expired`; a link nobody issued
 * 404 `not_found`.
 */
export const claimPlanResponseSchema = sessionResponseSchema.extend({
  planTitle: z.string(),
  reopened: z.boolean(),
})

/**
 * `POST /api/plans/preview`: what a saved comparison shows before it is opened (2026-11-10).
 * Reads without spending the token, so the app can welcome the customer with it and show the
 * data notice before anything is stored against them. Same errors as the claim.
 */
export const previewPlanResponseSchema = z.object({
  title: z.string(),
  /** "€25k saved · €800/mo · €90k · €350k": their figures in one line. */
  figures: z.string(),
  comparison: z
    .object({
      headline: z.string(),
      sortedBy: z.string(),
      filters: z.array(z.string()),
      total: z.number().int().nonnegative(),
      options: z
        .array(
          z.object({
            lender: z.string(),
            kind: z.string(),
            rate: z.string(),
            monthly: z.string(),
            fiveYear: z.string(),
            keys: z.string().nullable(),
            confirmed: z.boolean(),
          }),
        )
        .max(3),
    })
    .nullable(),
  /** For a plan with no home comparison: the first products in it, one line each. */
  products: z.array(z.object({ name: z.string(), provider: z.string(), line: z.string() })).max(3),
  expiresAt: z.string(),
})
export type PreviewPlanResponse = z.infer<typeof previewPlanResponseSchema>

export type ClaimPlanBody = z.infer<typeof claimPlanBodySchema>
export type ClaimPlanResponse = z.infer<typeof claimPlanResponseSchema>
