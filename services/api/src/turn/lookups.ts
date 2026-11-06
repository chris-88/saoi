import type { Db } from '@shared/db/case-repository.ts'

/** Reads of past cards and events that the turn decides things from. */

/** The catalogue ids (or products) on the most recent options card, from its stored payload. */
export async function lastOptionsOffered(admin: Db, caseId: string): Promise<ReadonlySet<string>> {
  const result = await admin
    .from('messages')
    .select('cards')
    .eq('case_id', caseId)
    .contains('cards', JSON.stringify([{ type: 'product_options' }]))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const cards = ((result.data as { cards?: unknown } | null)?.cards ?? []) as {
    type?: unknown
    options?: { product?: unknown; catalogueId?: unknown }[]
  }[]
  const card = cards.find((candidate) => candidate.type === 'product_options')
  return new Set(
    (card?.options ?? []).flatMap((option) => {
      const id = option.catalogueId ?? option.product
      return typeof id === 'string' ? [id] : []
    }),
  )
}

/** The most recent transfer card, from its stored payload: where it was to, and when. */
export async function lastTransferOffered(
  admin: Db,
  caseId: string,
): Promise<{ readonly toApplicationId: string | null; readonly createdAt: string } | null> {
  const result = await admin
    .from('messages')
    .select('cards, created_at')
    .eq('case_id', caseId)
    .contains('cards', JSON.stringify([{ type: 'transfer' }]))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = result.data as { cards?: unknown; created_at?: unknown } | null
  if (row === null || typeof row.created_at !== 'string') return null
  const cards = (row.cards ?? []) as { type?: unknown; toApplicationId?: unknown }[]
  const card = cards.find((candidate) => candidate.type === 'transfer')
  if (card === undefined) return null
  return {
    toApplicationId: typeof card.toApplicationId === 'string' ? card.toApplicationId : null,
    createdAt: row.created_at,
  }
}

export function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((item) => b.has(item))
}

export async function caseHasEvent(admin: Db, caseId: string, type: string): Promise<boolean> {
  const found = await admin
    .from('events')
    .select('id')
    .eq('case_id', caseId)
    .eq('type', type)
    .limit(1)
    .maybeSingle()
  return Boolean(found.data)
}
