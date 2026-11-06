import type { Journey } from './journey.ts'
import type { JourneyEvaluation, OutstandingItem } from './requirements.ts'

/**
 * What the bank asks for after an application has gone in (§41).
 *
 * A journey says what a product needs before submission. Once the bank has the application
 * its assessors can ask for more, and that ask is not in any journey file: it is a row in
 * `application_requests` whose requirement id no journey knows. The console simulates one;
 * this is what turns it into something the requirement engine, the status card and
 * `request_upload` can all see, so the customer is told what is wanted and has somewhere to
 * send it. Before this, Saoirse read the event, said "the team asked for one more payslip",
 * offered the upload, and the handler answered that nothing was outstanding.
 */

/** The slice of an `application_requests` row this needs. Shared with the loaded case. */
export type OpenRequest = {
  readonly id: string
  readonly requirementId: string
  readonly status: 'open' | 'fulfilled' | 'cancelled'
  readonly detail: string | null
}

/**
 * Prefix for the requirement id of a bank request, so it can never collide with a journey's
 * own ids, which are plain words like `payslip`.
 */
export const BANK_REQUEST_PREFIX = 'bank:'

/** The document type a bank request is recorded under: whatever the bank asked for. */
export const BANK_REQUEST_DOCUMENT_TYPE = 'bank_request' as const

/** When the request row carries no wording at all. */
const UNLABELLED = 'What the bank asked for'

/**
 * The requirement id for a request, from its wording: `bank:one-more-payslip`.
 *
 * Deterministic, so asking for the same thing twice finds the same open row rather than
 * opening a second one.
 */
export function bankRequirementId(detail: string): string {
  const slug = detail
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return `${BANK_REQUEST_PREFIX}${slug.length === 0 ? 'request' : slug}`
}

function journeyRequirementIds(journey: Journey): ReadonlySet<string> {
  return new Set(
    [...journey.requirements, ...journey.branches.flatMap((branch) => branch.requirements)].map(
      (requirement) => requirement.id,
    ),
  )
}

/** A request the journey did not ask for, so it must have come from the bank. */
export function isBankRequest(
  journey: Journey,
  request: Pick<OpenRequest, 'requirementId'>,
): boolean {
  return !journeyRequirementIds(journey).has(request.requirementId)
}

/** "one more payslip" reads as a label once it starts with a capital. */
function labelFor(detail: string | null): string {
  const trimmed = detail?.trim() ?? ''
  if (trimmed.length === 0) return UNLABELLED
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

/**
 * Adds every open bank request against an application to its evaluation, as an outstanding,
 * blocking document the customer must supply.
 *
 * Pure, and returns the same evaluation object when there is nothing to add, so the common
 * case costs nothing. A request that answers one of the journey's own requirements is left
 * to the journey: it is already outstanding or satisfied there, and listing it again would
 * be the same document asked for twice.
 */
export function withBankRequests(
  journey: Journey,
  evaluation: JourneyEvaluation,
  requests: readonly OpenRequest[],
): JourneyEvaluation {
  const journeyIds = journeyRequirementIds(journey)
  const seen = new Set<string>()
  const items: OutstandingItem[] = []

  for (const request of requests) {
    if (request.status !== 'open') continue
    if (journeyIds.has(request.requirementId)) continue
    // The same ask opened twice is one thing the customer has to do, not two.
    if (seen.has(request.requirementId)) continue
    seen.add(request.requirementId)

    items.push({
      requirement: {
        kind: 'document',
        id: request.requirementId,
        subject: 'primary',
        label: labelFor(request.detail),
        documentType: BANK_REQUEST_DOCUMENT_TYPE,
      },
      reason: 'awaiting_document',
      // The bank asks the applicant. A second applicant's documents come through their own tasks.
      waitingOn: 'primary',
      blocking: true,
      knownFact: null,
      requestId: request.id,
    })
  }

  if (items.length === 0) return evaluation

  return {
    ...evaluation,
    outstanding: [...evaluation.outstanding, ...items],
    complete: false,
    // The customer has something to do, which comes before anything waiting on the partner.
    waitingOn: 'primary',
  }
}
