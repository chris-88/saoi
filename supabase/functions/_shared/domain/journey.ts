import type { FactKey, ParticipantRole, ReusePolicy } from './facts.ts'

/**
 * A journey is the translated form of a recorded product application: what it asks, what it
 * requires, how it branches, which documents and declarations it needs, and which of those
 * belong to a second applicant (§8).
 *
 * Journeys are written in terms of ROLES. The requirement engine resolves a role to a
 * participant, which is what stops the primary's income satisfying the partner's requirement.
 */

export const PRODUCTS = [
  'mortgage',
  'current_account',
  'joint_account',
  'credit_card',
  'personal_loan',
  'protection',
  'savings',
] as const
export type Product = (typeof PRODUCTS)[number]

/** For reading a product back off an event payload, which is `unknown` until it is checked. */
export function isProduct(value: unknown): value is Product {
  return typeof value === 'string' && (PRODUCTS as readonly string[]).includes(value)
}

/** Who must supply a requirement. */
export type RequirementSubject = ParticipantRole | 'household'

export const DOCUMENT_TYPES = [
  'payslip',
  'bank_statement',
  'photo_id',
  'proof_of_address',
  'salary_certificate',
  /**
   * Whatever the bank asked for after the application went in (`bank-requests.ts`). Never in
   * a journey file, and never named by the model: the request row says what it is.
   */
  'bank_request',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

type RequirementBase = {
  /** Stable within a journey. Referenced by confirmations, documents and events. */
  readonly id: string
  readonly subject: RequirementSubject
  /** Shown in the admin inspector and used by the model to decide how to ask. */
  readonly label: string
  /** An optional requirement never blocks `ready`. */
  readonly optional?: boolean
}

/**
 * Requirements are an explicit discriminated union rather than inferring `kind` from the
 * presence of `fact`, so every consumer can switch exhaustively (Engineering standards).
 */
export type Requirement =
  | (RequirementBase & {
      readonly kind: 'fact'
      readonly fact: FactKey
      /**
       * Per-requirement override of the catalogue's reuse policy. It may only tighten:
       * a journey can demand a fresh answer for a normally-auto fact, never the reverse.
       */
      readonly reuse?: ReusePolicy
    })
  | (RequirementBase & {
      readonly kind: 'declaration'
      /** Declarations are always fresh per application (§11). */
      readonly fresh: true
    })
  | (RequirementBase & {
      readonly kind: 'document'
      readonly documentType: DocumentType
      /** Whether an uploaded document must be marked verified to satisfy this. */
      readonly requiresVerification?: boolean
    })
  | (RequirementBase & {
      readonly kind: 'confirmation'
      readonly fresh: true
    })

/** Reads facts during branch evaluation. Household facts ignore the role. */
export type FactReader = {
  readonly has: (key: FactKey, subject?: RequirementSubject) => boolean
  readonly get: (key: FactKey, subject?: RequirementSubject) => unknown
  readonly number: (key: FactKey, subject?: RequirementSubject) => number | null
  readonly boolean: (key: FactKey, subject?: RequirementSubject) => boolean | null
}

/** Whether a requirement has been confirmed or consented to for this application. */
export type ConfirmedReader = (requirementId: string) => boolean

/**
 * A conditional group of requirements (§8 branching).
 *
 * `when` also receives a confirmation reader, so a branch can be gated on explicit consent.
 * That is how protection health questions stay behind the consent form (Invariant 6, §7.5).
 */
export type Branch = {
  readonly id: string
  /** Plain-language form of the condition, for the admin inspector. */
  readonly describe: string
  readonly when: (facts: FactReader, confirmed: ConfirmedReader) => boolean
  readonly requirements: readonly Requirement[]
}

export type JourneyStatus = 'draft' | 'final'

export type Journey = {
  readonly product: Product
  /** `draft` until the definition has been matched against its recording (§8). */
  readonly status: JourneyStatus
  /** `recording: <file> @ mm:ss` once matched. */
  readonly source: string | null
  readonly displayName: string
  /** Whether this product can involve a second applicant (§7.2, §7.1). */
  readonly supportsPartner: boolean
  readonly requirements: readonly Requirement[]
  readonly branches: readonly Branch[]
}

export type JourneyInput = {
  readonly product: Product
  readonly status?: JourneyStatus
  readonly source?: string | null
  readonly displayName: string
  readonly supportsPartner?: boolean
  readonly requirements: readonly Requirement[]
  readonly branches?: readonly Branch[]
}

/**
 * Builds a journey and fails loudly on a definition mistake. Requirement ids must be unique
 * across the base requirements and every branch, because confirmations, documents and events
 * all reference a requirement by id.
 */
export function defineJourney(input: JourneyInput): Journey {
  const seen = new Set<string>()
  const all = [...input.requirements, ...(input.branches ?? []).flatMap((b) => b.requirements)]

  for (const requirement of all) {
    if (seen.has(requirement.id)) {
      throw new Error(
        `Journey ${input.product}: duplicate requirement id "${requirement.id}". Ids must be unique across base requirements and all branches.`,
      )
    }
    seen.add(requirement.id)
  }

  const branchIds = new Set<string>()
  for (const branch of input.branches ?? []) {
    if (branchIds.has(branch.id)) {
      throw new Error(`Journey ${input.product}: duplicate branch id "${branch.id}".`)
    }
    branchIds.add(branch.id)
  }

  if (!input.supportsPartner) {
    const partnerRequirement = all.find((r) => r.subject === 'partner')
    if (partnerRequirement) {
      throw new Error(
        `Journey ${input.product}: requirement "${partnerRequirement.id}" is for the partner, but the journey does not support a partner.`,
      )
    }
  }

  return {
    product: input.product,
    status: input.status ?? 'draft',
    source: input.source ?? null,
    displayName: input.displayName,
    supportsPartner: input.supportsPartner ?? false,
    requirements: input.requirements,
    branches: input.branches ?? [],
  }
}
