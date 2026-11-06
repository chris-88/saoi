import { mustWrite } from './case-repository.ts'
import { caseFactReader } from './fact-reader.ts'
import { evaluateNeeds } from '../domain/needs/engine.ts'
import type { NeedCandidate, NeedContext, RecordedNeedState } from '../domain/needs/types.ts'
import type { LoadedCase } from './loaded-case.ts'
import type { Db } from './case-repository.ts'

/**
 * The case as the needs engine sees it.
 *
 * Household-scoped, unlike a requirement evaluation, which is always about one application —
 * a need belongs to the customer's situation, not to a journey. The application ids passed to
 * the reader are therefore nominal; nothing here is captured for an application.
 */
export function needsFor(
  loaded: LoadedCase,
  options: { readonly sensitiveDisclosure: boolean },
): readonly NeedCandidate[] {
  const context = needContextFor(loaded, options)
  return context === null ? [] : evaluateNeeds(context, loaded.needs)
}

/** The same context, for callers that need more than the verdict — the plan builder. */
export function needContextFor(
  loaded: LoadedCase,
  options: { readonly sensitiveDisclosure: boolean },
): NeedContext | null {
  const facts = caseFactReader(loaded)
  if (facts === null) return null

  return {
    facts,
    sensitiveDisclosure: options.sensitiveDisclosure,
    applications: loaded.applications.map((application) => ({
      product: application.product,
      state: application.state,
    })),
    decisions: decisionsFrom(loaded),
  }
}

/**
 * §27 — park a need, with the thing that would make it worth raising again.
 *
 * "Leave it for now" is only kind if something remembers. The condition is stored in a form
 * the engine can evaluate, so coming back is a fact about the case rather than a note in a
 * transcript nobody rereads.
 */
export async function deferNeed(
  client: Db,
  caseId: string,
  input: {
    readonly needId: string
    readonly revisitWhen:
      'mortgage_completed' | 'plan_completed' | 'savings_target_reached' | 'date'
    readonly revisitOn?: string
    readonly reason: string
  },
): Promise<void> {
  // One current decision per need; superseded ones keep their history.
  mustWrite(
    await client
      .from('need_decisions')
      .update({ revisited_at: new Date().toISOString() })
      .eq('case_id', caseId)
      .eq('need_id', input.needId)
      .is('revisited_at', null),
    'the need decision',
  )

  const written = await client.from('need_decisions').insert({
    case_id: caseId,
    need_id: input.needId,
    state: 'deferred',
    revisit_when: input.revisitWhen,
    revisit_on: input.revisitOn ?? null,
    reason: input.reason,
  })

  if (written.error) throw new Error(`need_decisions: ${written.error.message}`)
}

/**
 * Needs whose moment has come back round.
 *
 * Evaluated from the case, so "when the mortgage is done" means the mortgage is actually done
 * — not that enough time has passed for it to be a reasonable guess.
 */
export async function revivableNeeds(
  client: Db,
  caseId: string,
  loaded: LoadedCase,
): Promise<readonly { needId: string; reason: string }[]> {
  const rows = await client
    .from('need_decisions')
    .select('need_id, revisit_when, revisit_on, reason')
    .eq('case_id', caseId)
    .eq('state', 'deferred')
    .is('revisited_at', null)

  if (rows.error) throw new Error(`need_decisions: ${rows.error.message}`)

  const today = new Date().toISOString().slice(0, 10)
  const mortgageDone = loaded.applications.some(
    (application) =>
      application.product === 'mortgage' &&
      (application.state === 'completed' || application.state === 'approved'),
  )

  return (
    (rows.data ?? []) as {
      need_id: string
      revisit_when: string | null
      revisit_on: string | null
      reason: string | null
    }[]
  )
    .filter((row) => {
      switch (row.revisit_when) {
        case 'mortgage_completed':
          return mortgageDone
        case 'date':
          return row.revisit_on !== null && row.revisit_on <= today
        // Handled by the plan and savings paths, which write their own events.
        case 'plan_completed':
        case 'savings_target_reached':
          return false
        // A deferral with no condition never comes back by itself, which is the honest
        // outcome: nothing was agreed about when to raise it again.
        case null:
        default:
          return false
      }
    })
    .map((row) => ({
      needId: row.need_id,
      reason: row.reason ?? 'you asked me to come back to it',
    }))
}

/**
 * What has already been settled, derived from product interest.
 *
 * `product_interests` predates the needs engine and records decisions against a product rather
 * than a need. Until a need has its own record, a decision about the product a need leads to
 * is the closest honest proxy — and it is the one the customer actually made, by tapping
 * something (Invariant 1).
 */
function decisionsFrom(loaded: LoadedCase): NeedContext['decisions'] {
  const byProduct = new Map<string, RecordedNeedState>()

  for (const interest of loaded.productInterests) {
    if (interest.status === 'declined') byProduct.set(interest.product, 'declined')
    else if (interest.status === 'accepted') byProduct.set(interest.product, 'accepted')
    else if (interest.status === 'deferred') byProduct.set(interest.product, 'deferred')
  }

  // An application that exists settles the question regardless of what was recorded earlier.
  for (const application of loaded.applications) byProduct.set(application.product, 'accepted')

  return evaluateNeeds({
    facts: { has: () => false, get: () => undefined, number: () => null, boolean: () => null },
    sensitiveDisclosure: false,
    applications: [],
    decisions: [],
  })
    .filter((candidate) => candidate.need.products.some((product) => byProduct.has(product)))
    .map((candidate) => ({
      needId: candidate.need.id,
      state: byProduct.get(
        candidate.need.products.find((product) => byProduct.has(product)) ?? '',
      ) as RecordedNeedState,
    }))
}
