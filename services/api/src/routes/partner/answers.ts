import type { Insert } from '@shared/db/case-repository.ts'
import { factCatalogue, isFactKey, parseFactValue } from '@shared/domain/facts.ts'

export type Answer = { readonly id: string; readonly value: unknown }

/**
 * Turns the partner's answers into fact rows, or says what is wrong with them.
 *
 * Only `fact:` tasks take an answer here. A partner cannot be asked for special-category data
 * this way (Invariant 6), and the provenance is `partner_stated`: the partner said this, not the
 * customer (§10).
 */
export function factRowsFor(
  answers: readonly Answer[],
  caseId: string,
  partnerId: string,
): { rows: Insert<'facts'>[]; problems: string[] } {
  const rows: Insert<'facts'>[] = []
  const problems: string[] = []

  for (const answer of answers) {
    if (!answer.id.startsWith('fact:')) continue
    const key = answer.id.slice('fact:'.length)

    if (!isFactKey(key)) {
      problems.push(`${key} is not something we collect.`)
      continue
    }
    if (factCatalogue[key].sensitivity === 'special') {
      problems.push(`${factCatalogue[key].label} is collected through its own form.`)
      continue
    }

    const value = parseFactValue(key, answer.value)
    if (!value.ok) {
      problems.push(`${factCatalogue[key].label}: ${value.issues.join('; ')}`)
      continue
    }

    rows.push({
      case_id: caseId,
      key,
      participant_id: partnerId,
      subject_kind: factCatalogue[key].subject === 'household' ? 'household' : 'participant',
      value: value.value as Insert<'facts'>['value'],
      source: 'partner_stated',
      verified: false,
    })
  }
  return { rows, problems }
}
