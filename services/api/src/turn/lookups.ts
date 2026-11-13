import type { Db } from '@shared/db/case-repository.ts'
import { loadHoldings } from '@shared/db/holdings.ts'
import { loadClaimedPlans } from '@shared/db/saved-plans.ts'
import { SIGNED_IN_ACTION, signInAnswered } from '@shared/llm/sign-in-prompt.ts'

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

/**
 * The case holds the customer's figures for the market: a plan claimed from their own AI, or
 * holdings. It is the one test for both `show_products` being offered and the gate letting a
 * question about other providers through (2026-11-12), so a customer with holdings and no plan
 * who asks how their account compares is not turned away. A holdings read that fails counts as
 * none; the claimed plans read is the turn's own and fails as it always has.
 */
export async function holdsMarketFigures(admin: Db, caseId: string): Promise<boolean> {
  const [claimed, held] = await Promise.all([
    loadClaimedPlans(admin, caseId),
    loadHoldings(admin, caseId).catch(() => []),
  ])
  return claimed.length > 0 || held.length > 0
}

/**
 * The "Signed in." message that already answered this case's sign-in, or null (`signInAnswered`).
 * A read that fails counts as not answered: a second greeting is a smaller harm than none.
 */
export async function signInAlreadyAnswered(admin: Db, caseId: string): Promise<string | null> {
  const [signedIn, said] = await Promise.all([
    admin
      .from('events')
      .select('created_at')
      .eq('case_id', caseId)
      .eq('type', 'customer_signed_in')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('messages')
      .select('id, created_at')
      .eq('case_id', caseId)
      .eq('role', 'system')
      .eq('content', SIGNED_IN_ACTION)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (said.error !== null) return null
  const event = signedIn.data as { created_at?: unknown } | null
  const message = said.data as { id?: unknown; created_at?: unknown } | null
  return signInAnswered(
    typeof event?.created_at === 'string' ? event.created_at : null,
    typeof message?.id === 'string' && typeof message.created_at === 'string'
      ? { id: message.id, createdAt: message.created_at }
      : null,
  )
}
