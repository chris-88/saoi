import { factCatalogue, type Fact, type FactKey, type FactSource } from './facts.ts'

/**
 * What the customer was never asked, as a thing they can read (§53).
 *
 * The product's central claim is that a fact is collected once and used everywhere, and for
 * weeks the only trace of it on the customer's screen was a sentence the model was told and
 * usually paraphrased away. The count was in the admin console and nowhere else.
 *
 * `context_reused` events are the record: one per requirement satisfied by a fact that was
 * bank-held or captured earlier. This turns those rows into something to show. Values come
 * from the facts table at render time, never from the event, because an events row is a
 * record of what happened and not a second home for personal data.
 */

/** The payload a `context_reused` event carries, as far as this needs it. */
export type ReuseEvent = {
  readonly key: string | null
  readonly source: string | null
  readonly applicationName: string
  /**
   * For a document the linked accounts stood in for (`source: 'account_data'`): there is no
   * fact behind it, so the event itself names the requirement and the bank it was seen at.
   */
  readonly requirementId?: string | null
  readonly label?: string | null
  readonly bank?: string | null
}

/** A fact's source, or the one thing that satisfies a requirement without being a fact. */
export type ReuseSource = FactSource | 'account_data'

export type ReusedFact = {
  /** A fact key, or `document:<requirementId>` for a document the account data covered. */
  readonly key: string
  readonly label: string
  readonly value: string
  readonly source: ReuseSource
  /** Where the bank got it, in the customer's terms. */
  readonly provenance: string
  /** The applications it satisfied something in, in the order they were started. */
  readonly usedFor: readonly string[]
}

/** Second person, because it is the customer reading it. */
export const PROVENANCE: Readonly<Record<ReuseSource, string>> = {
  bank_held: 'the bank already had it',
  customer_stated: 'you told me earlier',
  partner_stated: 'your partner told me',
  document_extracted: 'from a document you sent',
  document_verified: 'from a document you sent, checked',
  system_derived: 'from your account',
  account_data: 'seen in your linked account',
}

/** "seen in your linked AIB account" when the bank is known, the plain line when it is not. */
export function accountDataProvenance(bank: string | null | undefined): string {
  return bank ? `seen in your linked ${bank} account` : PROVENANCE.account_data
}

type KnownFact = Pick<Fact, 'key' | 'value' | 'source' | 'supersededBy'>

/**
 * One row per fact, however many applications it served.
 *
 * Income reused by a mortgage and a loan is one thing the customer did not have to say, not
 * two, so events are grouped by key and the applications are listed against it. Order is the
 * order the facts were first reused in, which is roughly the order they matter.
 */
export function describeReused(
  events: readonly ReuseEvent[],
  facts: readonly KnownFact[],
): readonly ReusedFact[] {
  const byKey = new Map<FactKey, { readonly usedFor: string[] }>()
  /*
   * A document the linked accounts covered has no fact to look up: the row is built from the
   * event alone, and a value is what the customer would otherwise have sent in. Grouped by
   * requirement so the payslip the mortgage and the loan both wanted is one row.
   */
  const byDocument = new Map<
    string,
    { readonly label: string; readonly bank: string | null; readonly usedFor: string[] }
  >()

  for (const event of events) {
    if (event.source === 'account_data' && typeof event.requirementId === 'string') {
      const entry = byDocument.get(event.requirementId) ?? {
        label: event.label ?? 'Document',
        bank: event.bank ?? null,
        usedFor: [],
      }
      if (!entry.usedFor.includes(event.applicationName)) entry.usedFor.push(event.applicationName)
      byDocument.set(event.requirementId, entry)
      continue
    }
    if (event.key === null || !(event.key in factCatalogue)) continue
    const key = event.key as FactKey
    const entry = byKey.get(key) ?? { usedFor: [] }
    if (!entry.usedFor.includes(event.applicationName)) entry.usedFor.push(event.applicationName)
    byKey.set(key, entry)
  }

  const described: ReusedFact[] = []

  for (const [key, entry] of byKey) {
    // The live value, not whatever it was when the event was written.
    const fact = facts.find((candidate) => candidate.key === key && candidate.supersededBy === null)
    if (fact === undefined) continue

    described.push({
      key,
      label: factCatalogue[key].label,
      value: formatFactValue(key, fact.value),
      source: fact.source,
      provenance: PROVENANCE[fact.source],
      usedFor: entry.usedFor,
    })
  }

  // After the facts: what was never typed comes before what was never sent in.
  for (const [requirementId, entry] of byDocument) {
    described.push({
      key: `document:${requirementId}`,
      label: entry.label,
      value: 'Not needed',
      source: 'account_data',
      provenance: accountDataProvenance(entry.bank),
      usedFor: entry.usedFor,
    })
  }

  return described
}

const MONEY = /amount|balance|income|price|target|rent|repayment|cover|saving/i

/**
 * A value as the card prints it.
 *
 * Money is money, booleans are words, and a PPS number shows its last two characters only:
 * the customer knows their own number, and a phone mirrored on a big screen does not need to
 * show the room.
 */
export function formatFactValue(key: FactKey, value: unknown): string {
  if (key === 'identity.ppsn' && typeof value === 'string') {
    return `${'•'.repeat(Math.max(0, value.length - 2))}${value.slice(-2)}`
  }
  if (typeof value === 'number') {
    return MONEY.test(key) ? `€${value.toLocaleString('en-IE')}` : value.toLocaleString('en-IE')
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

/**
 * How many things the customer never had to type, said once.
 *
 * `recordReuse` writes one `context_reused` event per requirement per application, which is
 * the right record (§53 counts questions avoided) and the wrong number to say out loud. Three
 * savings accounts started together each carried the same name and address, so the
 * confirmation line said "6 things carried over" while the reuse card beside it said two. One
 * fact is one thing, however many applications it served. Counted by key and subject, so the
 * primary's income and the partner's income are still two.
 */
export function countReusedFacts(
  items: readonly {
    readonly reused: boolean
    readonly fact: Pick<Fact, 'key' | 'subject'> | null
  }[],
): number {
  const seen = new Set<string>()
  for (const item of items) {
    if (!item.reused || item.fact === null) continue
    seen.add(`${item.fact.key}:${String(item.fact.subject)}`)
  }
  return seen.size
}
