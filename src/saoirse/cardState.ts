import { fetchCaseSnapshot } from '@/lib/saoiApi'
import { caseStateFromSnapshot, type CaseState } from '@domain/card-state.ts'

/**
 * What became of a card is decided in `@domain/card-state.ts`, which `saoi-api` runs too. This
 * file is the browser's way of getting the rows to feed it: from the service's case snapshot.
 */
export { settledState, settledTransfer, type CaseState, type Settled } from '@domain/card-state.ts'

/** Everything a card might need to know about, in one request. */
export async function loadCaseState(caseId: string): Promise<CaseState> {
  return caseStateFromSnapshot(await fetchCaseSnapshot(caseId))
}
