import { describe, expect, it } from 'vitest'
import { recordFormAnswers } from './record-form-answers.ts'
import type { Db } from './case-repository.ts'
import { resolveFormState } from '../domain/forms/state.ts'
import { formSnapshot } from '../tenants/demo/forms/snapshots.ts'

/**
 * Stands in for the database, so the rules can be tested without one.
 *
 * Only the four reads and one write this function makes, returning what the real tables would
 * for a savings application against the live SuperSaver definition.
 */
function stubClient(
  product: string,
  answers: Record<string, unknown> = {},
): { client: Db; written: Record<string, unknown>[] } {
  const written: Record<string, unknown>[] = []

  const from = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => {
        if (table === 'applications') {
          return await Promise.resolve({ data: { id: 'app-1', product }, error: null })
        }
        if (table === 'form_applications') {
          return await Promise.resolve({ data: { id: 'fa-1', answers }, error: null })
        }
        return await Promise.resolve({ data: null, error: null })
      },
      upsert: async (rows: Record<string, unknown>[]) => {
        written.push(...rows)
        return await Promise.resolve({ error: null })
      },
    }
    return chain
  }

  return { client: { from } as unknown as Db, written }
}

const run = async (
  product: string,
  answers: readonly { fieldId: string; value: string | number | boolean }[],
  existing: Record<string, unknown> = {},
) => {
  const { client, written } = stubClient(product, existing)
  const outcome = await recordFormAnswers(client, {
    caseId: 'case-1',
    applicationId: 'app-1',
    participantId: 'participant-1',
    answers,
  })
  return { outcome, written }
}

describe('answers the form will accept', () => {
  it('records a plain question', async () => {
    // 1174 is SuperSaver's first-name field, a plain text question on the first page.
    const { outcome, written } = await run('savings', [{ fieldId: '1174', value: 'Dave' }])

    expect(outcome.accepted).toEqual(['1174'])
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ field_id: '1174', value: 'Dave', source: 'customer' })
  })

  it('refuses a field the form does not have', async () => {
    const { outcome, written } = await run('savings', [{ fieldId: '999999', value: 'x' }])

    expect(outcome.accepted).toEqual([])
    expect(outcome.rejected[0]?.reason).toMatch(/no such field/)
    expect(written).toHaveLength(0)
  })

  it('refuses a product with no form behind it', async () => {
    const { outcome } = await run('mortgage', [{ fieldId: '1174', value: 'Dave' }])

    expect(outcome.accepted).toEqual([])
    expect(outcome.rejected[0]?.reason).toMatch(/no bank form/)
  })
})

/**
 * The refusals that are invariants rather than validation.
 *
 * A model that could record a declaration could manufacture consent, and one that could record
 * an upload could put a document in a packet that nobody sent. Neither is a matter of being
 * careful with the prompt: the server will not do it.
 */
describe('what a conversation can never record', () => {
  it('refuses a declaration, however clearly the customer agreed', async () => {
    const loan = await run('personal_loan', [{ fieldId: '48', value: 'Yes' }])

    expect(loan.outcome.accepted).toEqual([])
    expect(loan.outcome.rejected[0]?.reason).toMatch(/needs an explicit tap/)
    expect(loan.written).toHaveLength(0)
  })

  it('refuses a document', async () => {
    const loan = await run('personal_loan', [{ fieldId: '151', value: 'passport.pdf' }])

    expect(loan.outcome.accepted).toEqual([])
    expect(loan.outcome.rejected[0]?.reason).toMatch(/needs an upload/)
  })

  it('refuses a value the form does not offer', async () => {
    // 171 is living arrangements: parents, tenant or home, and nothing else.
    const loan = await run('personal_loan', [{ fieldId: '171', value: 'a houseboat' }], {
      363: 'No',
      207: 'New loan',
      500: 'Car purchase',
      179: 20000,
      70: 'monthly',
    })

    expect(loan.outcome.accepted).toEqual([])
    expect(loan.outcome.rejected[0]?.reason).toMatch(/must be one of/)
  })

  it('writes the form’s own spelling of a choice, not the customer’s', async () => {
    const loan = await run('personal_loan', [{ fieldId: '171', value: 'TENANT' }], {
      363: 'No',
      207: 'New loan',
      500: 'Car purchase',
      179: 20000,
      70: 'monthly',
    })

    expect(loan.outcome.accepted).toEqual(['171'])
    expect(loan.written[0]).toMatchObject({ field_id: '171', value: 'tenant' })
  })

  it('refuses a question that is not on this customer’s branch', async () => {
    // The student college question, with nothing answered: the student page is closed.
    const loan = await run('personal_loan', [{ fieldId: '372', value: 'Trinity' }])

    expect(loan.outcome.accepted).toEqual([])
    expect(loan.outcome.rejected[0]?.reason).toMatch(/does not apply/)
  })

  it('refuses something the form calculates for itself', async () => {
    const loan = await run('personal_loan', [{ fieldId: '255', value: 50000 }], {
      363: 'No',
      207: 'New loan',
      500: 'Car purchase',
      179: 20000,
    })

    expect(loan.outcome.accepted).toEqual([])
    expect(loan.outcome.rejected[0]?.reason).toMatch(/works that one out/)
  })
})

/**
 * The model copies the id from the digest; when it does not, the label is the next best key.
 *
 * Every answer to the bank's form was lost for two days because the digest showed labels and
 * this only knew ids. The id is still the key, and an id copied with its brackets still counts.
 * A label is accepted when exactly one live question carries it, and a refusal now says which
 * ids would have worked, so the model can put it right on the next round instead of guessing.
 */
describe('an answer named by label rather than id', () => {
  it('accepts an id copied with its brackets from the digest', async () => {
    const { outcome, written } = await run('savings', [{ fieldId: '[id 1174]', value: 'Dave' }])

    expect(outcome.accepted).toEqual(['1174'])
    expect(written[0]).toMatchObject({ field_id: '1174', value: 'Dave' })
  })

  it('resolves a label that exactly one live question carries', async () => {
    const { outcome, written } = await run('savings', [{ fieldId: 'Title', value: 'Ms' }])

    expect(outcome.accepted).toEqual(['380'])
    expect(written[0]).toMatchObject({ field_id: '380', value: 'Ms', source: 'customer' })
  })

  it('matches the label trimmed, whatever the case, with or without the digest’s full stop', async () => {
    const { outcome, written } = await run('savings', [
      { fieldId: '  country of RESIDENCE. ', value: 'Ireland' },
    ])

    expect(outcome.accepted).toEqual(['478'])
    expect(written[0]).toMatchObject({ field_id: '478', value: 'Ireland' })
  })

  it('still checks a choice reached by label against what the form offers', async () => {
    const { outcome, written } = await run('savings', [{ fieldId: 'Title', value: 'Captain' }])

    expect(outcome.accepted).toEqual([])
    expect(outcome.rejected[0]?.reason).toMatch(/must be one of: Mr, Mrs, Ms/)
    expect(written).toHaveLength(0)
  })

  it('refuses a label that several live questions share, and names them', async () => {
    // SuperSaver asks the US citizen question once per applicant, and both are live.
    const { outcome, written } = await run('savings', [
      { fieldId: 'Are you a US citizen?', value: 'No' },
    ])

    expect(outcome.accepted).toEqual([])
    expect(outcome.rejected[0]?.reason).toBe(
      'ambiguous; use one of: 36: Are you a US citizen?, 426: Are you a US citizen?',
    )
    expect(written).toHaveLength(0)
  })

  it('lists the open questions when nothing matches, so the next round can be right', async () => {
    const { outcome, written } = await run('savings', [{ fieldId: 'Shoe size', value: '42' }])

    expect(outcome.accepted).toEqual([])
    const reason = outcome.rejected[0]?.reason ?? ''
    expect(reason).toMatch(/^no such field on this form; the questions still open are: /)
    expect(reason).toContain('1147: Do you use online banking?')
    expect(reason).toContain('380: Title')
    // Up to eight, counted by the id-colon pairs rather than the commas a label may contain.
    expect(reason.match(/\b\d{1,4}: /g)).toHaveLength(8)
    expect(written).toHaveLength(0)
  })

  it('refuses a declaration reached by its label, exactly as by its id', async () => {
    // The loan's declarations carry their wording as the label; SuperSaver's first few do not.
    const snapshot = formSnapshot('1940')
    const consent = snapshot
      ? resolveFormState(snapshot.definition, {}).active.find(
          (field) => field.type === 'checkbox' && field.label.trim() !== '',
        )
      : undefined
    expect(consent).toBeDefined()

    const { outcome, written } = await run('personal_loan', [
      { fieldId: consent?.label ?? '', value: 'Yes' },
    ])

    expect(outcome.accepted).toEqual([])
    expect(outcome.rejected[0]?.reason).toMatch(/needs an explicit tap/)
    expect(written).toHaveLength(0)
  })
})
