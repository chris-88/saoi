import { asApplicationId, type Fact, type ParticipantId } from './facts.ts'
import type { Product } from './journey.ts'
import { journeyFor } from './journeys/index.ts'
import { evaluateJourney, type OutstandingReason } from './requirements.ts'

/**
 * What applying for something would involve, before anybody has applied (§8, §53).
 *
 * A customer who has just been shown what a mortgage costs will ask what applying takes. Until
 * now the digest had no answer: `outstanding` is computed for applications that exist, so for a
 * product merely being discussed the model had nothing to work from and would have improvised
 * the requirements of an Irish mortgage from whatever it happened to know. Inventing a bank's
 * paperwork is the same class of mistake as inventing its rates (§51).
 *
 * So the same requirement engine runs against a hypothetical: the real journey, the facts the
 * case already holds, and no application. What comes back is honest in both directions — what
 * would be needed, and what would not be asked for again, which is the reuse story (§53) told
 * before an application exists rather than after.
 */

/** A placeholder id, because a prospect has no application and the engine asks for one. */
const NO_APPLICATION = asApplicationId('00000000-0000-4000-8000-000000000000')

/**
 * Split by what the customer would actually have to do, not by whether a box is ticked.
 *
 * The engine reports a fact we already hold as outstanding when the journey wants it confirmed,
 * and a model told only "these are outstanding" asks for an income it was told last week. So
 * `known` covers everything the case can already answer — including what needs a tick at review
 * — and `toAsk` is only what nobody has said yet.
 */
export type ProspectView = {
  readonly product: Product
  /** Already answerable from the case. Some need a tick at review; none need asking. */
  readonly known: readonly string[]
  /** Everything still outstanding, in journey order. */
  readonly needed: readonly string[]
  /** Nobody has said it yet. The only group that is a question. */
  readonly toAsk: readonly string[]
  /** Known, but the journey wants it said again or confirmed on the review card. */
  readonly toConfirm: readonly string[]
  readonly toUpload: readonly string[]
  readonly toDeclare: readonly string[]
  /** Only the second applicant can answer these. */
  readonly forPartner: readonly string[]
}

export function wouldInvolve(
  product: Product,
  input: {
    readonly facts: readonly Fact[]
    readonly primary: ParticipantId
    readonly partner: ParticipantId | null
  },
): ProspectView {
  const evaluation = evaluateJourney(journeyFor(product), {
    applicationId: NO_APPLICATION,
    participants: { primary: input.primary, partner: input.partner },
    facts: input.facts,
    /*
     * Nothing confirmed and nothing uploaded, because none of it would carry over. A
     * declaration signed for the mortgage does not satisfy the credit card, and this is asking
     * what a fresh application would involve.
     */
    confirmations: [],
    documents: [],
  })

  const blocking = evaluation.outstanding.filter((item) => item.blocking)
  const labels = (reason: OutstandingReason): readonly string[] =>
    blocking.filter((item) => item.reason === reason).map((item) => item.requirement.label)

  const toConfirm = [...labels('needs_confirmation'), ...labels('needs_fresh')]

  return {
    product,
    known: [...evaluation.satisfied.map((item) => item.requirement.label), ...toConfirm],
    needed: blocking.map((item) => item.requirement.label),
    toAsk: labels('missing'),
    toConfirm,
    toUpload: [...labels('awaiting_document'), ...labels('awaiting_verification')],
    toDeclare: labels('awaiting_declaration'),
    forPartner: labels('awaiting_partner'),
  }
}

/**
 * The same thing as digest lines.
 *
 * Leads with what is already known, because "you would not have to tell us that again" is the
 * most convincing thing Saoirse can say at this point and it is only true because facts are shared
 * across applications rather than collected per form (§53).
 *
 * Counts first, then the list. A mortgage has nineteen requirements and a customer asking what
 * is involved wants the shape of it, not an inventory — but the full list has to be here anyway,
 * because "do you need my PPS number?" has to be answerable with something better than a guess.
 * So the model gets all of it and is told plainly not to read it out.
 */
export function describeProspect(view: ProspectView, displayName: string): readonly string[] {
  const lines: string[] = [`${displayName} — what applying would involve:`]
  const count = (items: readonly string[], noun: string): string =>
    `${String(items.length)} ${noun}${items.length === 1 ? '' : 's'}`

  if (view.known.length > 0) {
    /*
     * Satisfied and needs-confirming together. The difference is a tick on the review card, not
     * another question, and listing them separately said the same names twice.
     */
    lines.push(
      `  ${count(view.known, 'thing')} already known, so they would not be asked for again: ` +
        `${view.known.join(', ')}.`,
    )
  }

  if (view.toAsk.length > 0) {
    lines.push(
      `  ${count(view.toAsk, 'thing')} still to find out. Here in full so you can answer about ` +
        `any one of them — do not read the list out: ${view.toAsk.join(', ')}.`,
    )
  }

  if (view.toUpload.length > 0) {
    /*
     * The caveat travels with the list rather than being left to the model to remember. A
     * document list stated flatly reads as the complete set, and an underwriter who later asks
     * for a second payslip has made Saoirse look like it was wrong rather than being thorough.
     */
    lines.push(
      `  ${count(view.toUpload, 'document')} to send in as photos: ${view.toUpload.join(', ')}. ` +
        'Say that every case is assessed individually and this list is not exhaustive — more ' +
        'may be asked for once the team looks at it.',
    )
  }

  if (view.toDeclare.length > 0) {
    lines.push(
      `  ${count(view.toDeclare, 'declaration')}, made on the review card rather than in chat: ` +
        `${view.toDeclare.join(', ')}.`,
    )
  }

  if (view.forPartner.length > 0) {
    lines.push(
      `  ${count(view.forPartner, 'thing')} only the second applicant can answer: ` +
        `${view.forPartner.join(', ')}.`,
    )
  }

  if (view.needed.length === 0) {
    lines.push('  Nothing outstanding — they could start it now.')
  }

  return lines
}
