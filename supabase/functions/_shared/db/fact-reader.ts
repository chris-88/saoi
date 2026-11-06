import { asApplicationId, asParticipantId } from '../domain/facts.ts'
import { createFactReader } from '../domain/requirements.ts'
import type { FactReader } from '../domain/journey.ts'
import type { LoadedCase } from './loaded-case.ts'

/**
 * A fact reader over a whole case rather than one application.
 *
 * The requirement engine's reader is built per application, because that is what decides which
 * facts count as captured for it. The needs, plans and goals engines all ask a different
 * question — what does the case know about this household — and all three were building the
 * same reader with the same placeholder application id. One of them, here, so a change to how
 * facts are read reaches all three.
 *
 * Null when there is no primary participant, which means the case has nothing to read about
 * anybody yet.
 */
export function caseFactReader(loaded: LoadedCase): FactReader | null {
  const primary = loaded.participants.find((participant) => participant.role === 'primary')
  const partner = loaded.participants.find((participant) => participant.role === 'partner')
  if (!primary) return null

  return createFactReader({
    // No application is in view, so nothing can be "captured for" one. The id is a placeholder
    // the reader never matches against.
    applicationId: asApplicationId('00000000-0000-4000-8000-000000000000'),
    participants: {
      primary: asParticipantId(String(primary.id)),
      partner: partner ? asParticipantId(String(partner.id)) : null,
    },
    facts: loaded.facts,
    confirmations: [],
    documents: [],
  })
}

/** Reads nothing. For a case with no participants, where every answer is honestly "we do not know". */
export const emptyFactReader: FactReader = {
  has: () => false,
  get: () => undefined,
  number: () => null,
  boolean: () => null,
}
