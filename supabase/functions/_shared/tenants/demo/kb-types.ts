/**
 * The shape of the generated product knowledge base.
 *
 * Hand-written against the pack's own schema, which only requires eight fields; every object in
 * the pack carries all twenty-one, so they are all required here. If a future pack drops one,
 * `deno check` fails on the generated file rather than something reading `undefined.join()` at
 * the point a customer asked a question.
 */

/** How much of this can be stated without checking something live first. */
export const FRESHNESS_CLASSES = [
  'semi_static',
  'dynamic',
  'expiry_sensitive',
  'requires_internal_live_data',
] as const

export type FreshnessClass = (typeof FRESHNESS_CLASSES)[number]

/**
 * What has to happen before this product can actually be taken up.
 *
 * The useful field in the whole pack. Anything that is not `information_or_self_serve` ends in
 * a regulated process that Saoirse is not part of, and saying so is the difference between helping
 * somebody and advising them.
 */
export const ADVICE_MODELS = [
  'information_or_self_serve',
  'regulated_credit_assessment',
  'advice_and_underwriting',
  'insurance_quote_and_underwriting',
  'regulated_investment_advice',
  'regulated_pension_advice',
  'regulated_retirement_advice',
  'relationship_service',
] as const

export type AdviceModel = (typeof ADVICE_MODELS)[number]

export type KnowledgeProduct = {
  readonly id: string
  readonly name: string
  readonly family: string
  readonly subfamily: string
  readonly product_type: string
  /**
   * Anything other than `active_public` means do not put it in front of a customer until
   * somebody has checked it. The pack flags three such objects.
   */
  readonly catalogue_status: string
  readonly source_confidence: string
  readonly customer_job: string
  readonly best_for: readonly string[]
  readonly features: readonly string[]
  readonly benefits: readonly string[]
  readonly eligibility: readonly string[]
  readonly constraints_and_cautions: readonly string[]
  readonly pricing_and_rates: Readonly<Record<string, unknown>>
  readonly application_channels: readonly string[]
  readonly advice_model: string
  readonly related_products: readonly string[]
  /**
   * Per-product guidance from the pack, the most useful part of it.
   *
   * `must_not_say` is the one worth having: four of the six are the protection products saying
   * not to infer health or use a diagnosis as a trigger, which is Invariant 6 written again by
   * somebody who arrived at it independently.
   */
  readonly assistant_usage: {
    readonly surface_when?: readonly string[]
    readonly clarify?: readonly string[]
    readonly must_not_say?: readonly string[]
    readonly suppress_when?: readonly string[]
    readonly defer_when?: readonly string[]
    readonly positioning?: readonly string[] | string
  }
  readonly freshness_class: string
  readonly last_verified: string
  readonly source_urls: readonly string[]
}

export type KnowledgeBase = {
  readonly metadata: Readonly<Record<string, unknown>>
  readonly knowledge_policy: {
    readonly freshness_classes: Readonly<Record<string, unknown>>
    readonly saoirse_rules: readonly string[]
  }
  readonly products: readonly KnowledgeProduct[]
}
