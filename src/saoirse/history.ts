import { fetchCaseHistory } from '@/lib/saoiApi'
import type { CaseHistory } from '@contracts/case-read.ts'
import type { HistoryEntry } from '@domain/card-state.ts'

export type { HistoryEntry } from '@domain/card-state.ts'

/**
 * Loads the conversation so far.
 *
 * Without this the model and the customer see different conversations: the model reads
 * persisted history and will refer to a card it showed last time, while the screen starts
 * empty. It read as Saoirse apologising for something the customer never saw.
 *
 * From `saoi-api`, which resolves each card against the case (Invariant 2 applied to history)
 * before it leaves the server.
 */
export async function loadHistory(caseId: string): Promise<readonly HistoryEntry[]> {
  return (await fetchCaseHistory(caseId)).entries.map(exact)
}

/**
 * The wire type has `x?: T | undefined`; the app's has `x?: T` under `exactOptionalPropertyTypes`.
 * Absent stays absent, which is what the service sends.
 */
function exact(entry: CaseHistory['entries'][number]): HistoryEntry {
  if (entry.kind === 'message') {
    return {
      kind: 'message',
      id: entry.id,
      author: entry.author,
      text: entry.text,
      ...(entry.messageId === undefined ? {} : { messageId: entry.messageId }),
    }
  }
  const { settled } = entry
  return {
    kind: 'card',
    id: entry.id,
    card: entry.card,
    ...(settled === undefined
      ? {}
      : {
          settled: {
            label: settled.label,
            ...(settled.note === undefined ? {} : { note: settled.note }),
          },
        }),
  }
}
