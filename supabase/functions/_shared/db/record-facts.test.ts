import { describe, expect, it } from 'vitest'
import { recordFacts, type Db } from './case-repository.ts'

/**
 * Captures what would have been written, so the rules can be tested without a database.
 *
 * `existing` stands for the facts already live on the case, which is what decides whether a
 * write is a correction, a duplicate, or new.
 */
type LiveFact = { id: string; key: string; participant_id: string | null; value: unknown }

function stubClient(existing: readonly LiveFact[] = []): {
  client: Db
  inserted: Record<string, unknown>[]
  superseded: string[]
} {
  const inserted: Record<string, unknown>[] = []
  const superseded: string[] = []

  const from = () => {
    let mode: 'read' | 'insert' | 'update' = 'read'
    let rows: Record<string, unknown>[] = []

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      in: (_column: string, values: string[]) => {
        if (mode === 'update') superseded.push(...values)
        return chain
      },
      insert: (payload: Record<string, unknown>[]) => {
        mode = 'insert'
        rows = payload
        inserted.push(...payload)
        return chain
      },
      update: () => {
        mode = 'update'
        return chain
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (mode === 'insert') {
          return resolve({
            data: rows.map((row, index) => ({ ...row, id: `new-${String(index)}` })),
            error: null,
          })
        }
        if (mode === 'update') return resolve({ data: null, error: null })
        return resolve({ data: existing, error: null })
      },
    }

    return chain
  }

  return { client: { from } as unknown as Db, inserted, superseded }
}

const participants = { primary: 'p-primary', partner: 'p-partner' }

const write = (
  facts: Parameters<typeof recordFacts>[1]['facts'],
  existing: readonly LiveFact[] = [],
) => {
  const { client, inserted, superseded } = stubClient(existing)
  return recordFacts(client, {
    caseId: 'c-1',
    facts,
    participants,
    source: 'customer_stated',
  }).then((outcome) => ({ outcome, inserted, superseded }))
}

describe('the catalogue decides whose fact it is, not the model', () => {
  it('stores a household key against the household even when the model says primary', async () => {
    const { outcome, inserted } = await write([
      { key: 'household.buyingWith', subject: 'primary', value: 'partner' },
    ])

    expect(outcome.accepted).toEqual(['household.buyingWith'])
    expect(inserted[0]?.subject_kind).toBe('household')
    expect(inserted[0]?.participant_id).toBeNull()
  })

  it('defaults a personal key to the primary customer when no subject is given', async () => {
    const { outcome, inserted } = await write([{ key: 'income.annualBasic', value: 92_000 }])

    expect(outcome.accepted).toEqual(['income.annualBasic'])
    expect(inserted[0]?.participant_id).toBe('p-primary')
  })

  it('honours an explicit partner subject', async () => {
    const { inserted } = await write([
      { key: 'income.annualBasic', subject: 'partner', value: 54_000 },
    ])

    expect(inserted[0]?.participant_id).toBe('p-partner')
  })

  it('refuses a partner fact before the partner exists, and says what to do instead', async () => {
    /*
     * "There is no partner on this case yet" was true and not enough. The model read it as a
     * passing failure and sent the same write on the next five turns, refused every time,
     * while the figure the customer gave was kept nowhere. The refusal has to close the loop.
     */
    const { client } = stubClient()
    const outcome = await recordFacts(client, {
      caseId: 'c-1',
      facts: [{ key: 'income.annualBasic', subject: 'partner', value: 54_000 }],
      participants: { primary: 'p-primary', partner: null },
      source: 'customer_stated',
    })

    expect(outcome.accepted).toEqual([])
    const reason = outcome.rejected[0]?.reason ?? ''
    expect(reason).toMatch(/no partner on this case yet/i)
    expect(reason).toContain('income.annualBasic is asked of them directly when they join')
    expect(reason).toMatch(/do not try again/i)
    expect(reason).toContain(
      'Record what the customer said about it as income.partnerAnnualStated instead.',
    )
  })

  it('offers the hearsay key for income only, because only income has one', async () => {
    const { client } = stubClient()
    const outcome = await recordFacts(client, {
      caseId: 'c-1',
      facts: [{ key: 'employment.status', subject: 'partner', value: 'employed_full_time' }],
      participants: { primary: 'p-primary', partner: null },
      source: 'customer_stated',
    })

    const reason = outcome.rejected[0]?.reason ?? ''
    expect(reason).toContain('employment.status is asked of them directly when they join')
    expect(reason).toMatch(/do not try again/i)
    expect(reason).not.toContain('income.partnerAnnualStated')
  })

  it("keeps what the customer said about their partner's income before the partner exists", async () => {
    const { client, inserted } = stubClient()
    const outcome = await recordFacts(client, {
      caseId: 'c-1',
      facts: [{ key: 'income.partnerAnnualStated', value: 100_000 }],
      participants: { primary: 'p-primary', partner: null },
      source: 'customer_stated',
    })

    expect(outcome.accepted).toEqual(['income.partnerAnnualStated'])
    expect(inserted[0]?.subject_kind).toBe('household')
    expect(inserted[0]?.participant_id).toBeNull()
  })
})

describe('Invariant 6 — health data is unreachable from conversation', () => {
  it('refuses a non-extractable key and explains why', async () => {
    const { outcome, inserted } = await write([
      { key: 'protection.health.smoker', value: true },
      { key: 'income.annualBasic', value: 92_000 },
    ])

    expect(outcome.accepted).toEqual(['income.annualBasic'])
    expect(outcome.rejected[0]?.key).toBe('protection.health.smoker')
    expect(outcome.rejected[0]?.reason).toMatch(/form with consent/i)
    expect(inserted).toHaveLength(1)
  })
})

describe('values are validated against the catalogue schema', () => {
  it('refuses a value of the wrong shape', async () => {
    const { outcome } = await write([
      { key: 'income.annualBasic', value: 'about ninety two thousand' },
    ])

    expect(outcome.accepted).toEqual([])
    expect(outcome.rejected).toHaveLength(1)
  })

  it('refuses a negative salary', async () => {
    const { outcome } = await write([{ key: 'income.annualBasic', value: -1 }])
    expect(outcome.accepted).toEqual([])
  })

  it('accepts the good facts in a batch and reports only the bad ones', async () => {
    const { outcome } = await write([
      { key: 'income.annualBasic', value: 92_000 },
      { key: 'household.dependantCount', value: 'one' },
      { key: 'housing.firstTimeBuyer', value: true },
    ])

    expect([...outcome.accepted].sort()).toEqual(['housing.firstTimeBuyer', 'income.annualBasic'])
    expect(outcome.rejected.map((r) => r.key)).toEqual(['household.dependantCount'])
  })

  it('writes nothing at all when every fact is refused', async () => {
    const { inserted } = await write([{ key: 'protection.health.smoker', value: true }])
    expect(inserted).toEqual([])
  })
})

describe('a new answer replaces the old one', () => {
  it('supersedes the previous value for the same person', async () => {
    const { inserted, superseded } = await write(
      [{ key: 'income.annualBasic', value: 150_000 }],
      [{ id: 'old-1', key: 'income.annualBasic', participant_id: 'p-primary', value: 92_000 }],
    )

    expect(inserted).toHaveLength(1)
    expect(superseded).toEqual(['old-1'])
  })

  it('does not write the same value twice', async () => {
    // Restating something is not a correction. Written again it inflated the captured count
    // and left the inspector showing the same number several times over.
    const { inserted, superseded } = await write(
      [{ key: 'income.annualBasic', value: 92_000 }],
      [{ id: 'old-1', key: 'income.annualBasic', participant_id: 'p-primary', value: 92_000 }],
    )

    expect(inserted).toHaveLength(0)
    expect(superseded).toEqual([])
  })

  it('leaves the other applicant alone', async () => {
    // The partner's salary and the customer's are the same key on different people, so one
    // must never supersede the other.
    const { superseded } = await write(
      [{ key: 'income.annualBasic', subject: 'partner', value: 100_000 }],
      [{ id: 'old-1', key: 'income.annualBasic', participant_id: 'p-primary', value: 150_000 }],
    )

    expect(superseded).toEqual([])
  })
})
