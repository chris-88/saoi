import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { formDefinitionSchema } from '../../../domain/forms/definition.ts'
import { activeFields } from '../../../domain/forms/logic.ts'
import { resolveFormState } from '../../../domain/forms/state.ts'
import {
  SUPERSAVER_PREFILL,
  addressPart,
  fillFromFacts,
  namePart,
  resolvePrefill,
} from './prefill.ts'
import { formForProduct, productsWithForms } from './mapping.ts'
import { formSnapshot } from './snapshots.ts'

const snapshot = JSON.parse(
  readFileSync('supabase/functions/_shared/tenants/demo/forms/form-1833.json', 'utf8'),
) as { definition: unknown }
const definition = formDefinitionSchema.parse(snapshot.definition)

/**
 * Every product with a form, checked against the definition it claims to fill.
 *
 * Written over the registry rather than over SuperSaver, because this is a platform feature
 * and not a SuperSaver one: adding a product means adding a snapshot and a table, and the
 * moment somebody does, this starts checking it. A mapping that names a field the published
 * document does not have is the one failure mode that produces a confidently wrong packet.
 */
describe('what Saoirse already knows, for every product that has a form', () => {
  const products = productsWithForms()

  it('covers more than one product, or this proves nothing', () => {
    expect(products.length).toBeGreaterThan(1)
  })

  it.each(products)('%s: every mapping points at a field that exists', (product) => {
    const mapping = formForProduct(product)
    expect(mapping).not.toBeNull()
    const snapshot = formSnapshot(mapping?.formId ?? '')
    expect(snapshot).toBeDefined()
    if (!mapping || !snapshot) return

    const resolved = resolvePrefill({
      definition: snapshot.definition,
      prefill: mapping.prefill,
      // Nothing is held, so every mapping lands in `unresolved` for want of a fact. What is
      // being checked is the other reason a mapping can fail to resolve: naming a field that
      // is not there. That one would be reported here too, so the two are told apart by
      // resolving again with every fact present.
      held: () => undefined,
      reused: () => false,
      active: new Set(snapshot.definition.fields.map((f) => f.id)),
    })
    expect(resolved.answers).toEqual({})

    const destinations = mapping.prefill.map((entry) =>
      'toscana' in entry ? entry.toscana : entry.fieldId,
    )
    expect(resolved.unresolved).toEqual(destinations)

    // Now the real check: every destination resolves to a real field id.
    const byToscana = new Map(
      snapshot.definition.fields
        .filter((f) => typeof f.toscana === 'string' && f.toscana.length > 0)
        .map((f) => [f.toscana as string, f.id]),
    )
    const ids = new Set(snapshot.definition.fields.map((f) => f.id))

    const missing = mapping.prefill.filter((entry) => {
      const id = 'toscana' in entry ? byToscana.get(entry.toscana) : entry.fieldId
      return id === undefined || !ids.has(id)
    })
    expect(missing.map((entry) => ('toscana' in entry ? entry.toscana : entry.fieldId))).toEqual([])
  })

  it.each(products)('%s: every value translation names a choice the form offers', (product) => {
    const mapping = formForProduct(product)
    const snapshot = formSnapshot(mapping?.formId ?? '')
    if (!mapping || !snapshot) return

    const byToscana = new Map(
      snapshot.definition.fields
        .filter((f) => typeof f.toscana === 'string' && f.toscana.length > 0)
        .map((f) => [f.toscana as string, f]),
    )
    const byId = new Map(snapshot.definition.fields.map((f) => [f.id, f]))

    const wrong: string[] = []
    for (const entry of mapping.prefill) {
      if (!entry.values) continue
      const field = 'toscana' in entry ? byToscana.get(entry.toscana) : byId.get(entry.fieldId)
      const offered = new Set((field?.choices ?? []).map((choice) => choice.value))
      if (offered.size === 0) continue
      for (const value of Object.values(entry.values)) {
        if (!offered.has(value)) wrong.push(`${entry.fact} -> ${value}`)
      }
    }

    // A translation to a value the form does not offer is rejected on submission at best, and
    // silently misfiled at worst.
    expect(wrong).toEqual([])
  })

  it('answers a real share of what SuperSaver would otherwise ask', () => {
    const snapshot = formSnapshot('1833')
    if (!snapshot) throw new Error('SuperSaver is not registered')

    const byToscana = new Map(
      snapshot.definition.fields
        .filter((f) => typeof f.toscana === 'string')
        .map((f) => [f.toscana as string, f]),
    )
    const prefillable = new Set(
      SUPERSAVER_PREFILL.map((p) => ('toscana' in p ? byToscana.get(p.toscana)?.id : p.fieldId)),
    )

    const asked = activeFields(snapshot.definition.fields, {}).filter(
      (f) => f.isRequired && !['html', 'section', 'page', 'hidden'].includes(f.type),
    )
    const covered = asked.filter((f) => prefillable.has(f.id))

    // Not a vanity number: it is the claim the demo makes out loud.
    expect(covered.length).toBeGreaterThanOrEqual(8)
    expect(asked.length).toBeGreaterThan(covered.length)
  })
})

describe('reshaping a fact into what the form wants', () => {
  it('splits a name, keeping double-barrelled surnames whole', () => {
    expect(namePart('Aoife Ní Bhriain', 'firstName')).toBe('Aoife')
    expect(namePart('Aoife Ní Bhriain', 'surname')).toBe('Ní Bhriain')
    expect(namePart('Prince', 'surname')).toBe('')
  })

  it('pulls the parts of an address people actually say', () => {
    const address = '9 Shanliss Park, Santry, Dublin 9'
    expect(addressPart(address, 'houseNumber')).toBe('9')
    expect(addressPart(address, 'addressLine1')).toBe('Shanliss Park')
    expect(addressPart(address, 'addressLine2')).toBe('Santry')
    expect(addressPart(address, 'county')).toBe('Dublin 9')
  })

  it('returns nothing rather than guessing when a part is not there', () => {
    expect(addressPart('Shanliss Park', 'houseNumber')).toBe('')
    expect(addressPart('', 'county')).toBe('')
  })
})

describe('resolving what is held into form answers', () => {
  it('fills the fields the facts cover and names the ones they do not', () => {
    const held: Partial<Record<string, unknown>> = {
      'identity.fullName': 'Dave Quinn',
      'identity.dateOfBirth': '1988-10-25',
      'identity.address': '9 Shanliss Park, Santry, Dublin 9',
      'identity.ppsn': '1234567Q',
      'goals.monthlySaving': 1200,
    }

    const resolved = resolvePrefill({
      definition,
      prefill: SUPERSAVER_PREFILL,
      held: (key) => held[key],
      reused: () => true,
      active: new Set(definition.fields.map((f) => f.id)),
    })

    const byToscana = new Map(
      definition.fields
        .filter((f) => typeof f.toscana === 'string')
        .map((f) => [f.toscana as string, f.id]),
    )
    const fieldFor = (toscana: string) => byToscana.get(toscana) ?? 'missing'

    expect(resolved.answers[fieldFor('Applicant_1_First_Name')]).toBe('Dave')
    expect(resolved.answers[fieldFor('Applicant_1_Surname')]).toBe('Quinn')
    expect(resolved.answers[fieldFor('Applicant_1_Address_House_Number')]).toBe('9')
    expect(resolved.answers[fieldFor('Applicant_1_Address_County')]).toBe('Dublin 9')
    expect(resolved.answers[fieldFor('Direct_Debit_Amount')]).toBe(1200)

    // Not held, so the customer still gets asked. A blank is not an answer.
    expect(resolved.unresolved).toContain('Applicant_1_Email_Address')
    expect(resolved.unresolved).toContain('Applicant_1_Employer_Name')
    expect(Object.keys(resolved.answers)).not.toContain(fieldFor('Applicant_1_Email_Address'))
  })

  it('counts as reused only what was not collected for this form', () => {
    const held: Partial<Record<string, unknown>> = {
      'identity.fullName': 'Dave Quinn',
      'goals.monthlySaving': 1200,
    }

    const resolved = resolvePrefill({
      definition,
      prefill: SUPERSAVER_PREFILL,
      held: (key) => held[key],
      // The saving amount was stated while applying for this; the name came from before it.
      reused: (key) => key !== 'goals.monthlySaving',
      active: new Set(definition.fields.map((f) => f.id)),
    })

    const byToscana = new Map(
      definition.fields
        .filter((f) => typeof f.toscana === 'string')
        .map((f) => [f.toscana as string, f.id]),
    )
    const amount = byToscana.get('Direct_Debit_Amount') ?? 'missing'
    const firstName = byToscana.get('Applicant_1_First_Name') ?? 'missing'

    expect(resolved.reused).toContain(firstName)
    expect(resolved.reused).not.toContain(amount)
  })

  it('treats an empty or whitespace fact as not held', () => {
    const resolved = resolvePrefill({
      definition,
      prefill: SUPERSAVER_PREFILL,
      held: (key) => (key === 'identity.fullName' ? '   ' : undefined),
      reused: () => true,
      active: new Set(definition.fields.map((f) => f.id)),
    })

    expect(resolved.answers).toEqual({})
    expect(resolved.unresolved).toContain('Applicant_1_First_Name')
  })

  it('drops a part a fact does not contain rather than writing a blank', () => {
    const resolved = resolvePrefill({
      definition,
      prefill: SUPERSAVER_PREFILL,
      // One word, so there is no surname and no house number in sight.
      held: (key) => (key === 'identity.fullName' ? 'Prince' : undefined),
      reused: () => true,
      active: new Set(definition.fields.map((f) => f.id)),
    })

    const byToscana = new Map(
      definition.fields
        .filter((f) => typeof f.toscana === 'string')
        .map((f) => [f.toscana as string, f.id]),
    )

    expect(resolved.answers[byToscana.get('Applicant_1_First_Name') ?? '']).toBe('Prince')
    expect(Object.keys(resolved.answers)).not.toContain(byToscana.get('Applicant_1_Surname'))
    expect(resolved.unresolved).toContain('Applicant_1_Surname')
  })
})

describe('the personal loan, filled from what Saoirse holds', () => {
  const loan = formSnapshot('1940')
  const mapping = formForProduct('personal_loan')

  /** Dave after SuperSaver, plus what a lending conversation adds. */
  const held: Record<string, unknown> = {
    'identity.fullName': 'Dave Quinn',
    'identity.email': 'dave@example.ie',
    'identity.mobile': '0871234567',
    'identity.ppsn': '1234567Q',
    'identity.maritalStatus': 'single',
    'identity.yearsAtAddress': 5,
    'household.dependantCount': 0,
    'employment.status': 'self_employed',
    'employment.occupation': 'Consultant',
    'employment.startDate': '2019-03-01',
    'income.netMonthly': 4200,
    'expenditure.monthlyRent': 1500,
    'liabilities.creditCardBalance': 900,
    'assets.savingsBalance': 8000,
    'housing.currentTenure': 'renting',
    'banking.salaryPaidTo': 'another_bank',
    'borrowing.requestedAmount': 20000,
    'borrowing.repaymentMonths': 24,
    'borrowing.purpose': 'Car purchase',
  }

  /** What the customer taps before the amount question exists at all. */
  const tapped = { 363: 'No', 207: 'New loan', 70: 'monthly', 221: 'No' }

  const fill = () =>
    fillFromFacts({
      definition: loan?.definition ?? { id: '', title: '', fields: [] },
      prefill: mapping?.prefill ?? [],
      held: (key) => held[key],
      reused: () => true,
      answers: tapped,
    })

  /**
   * The bug this guards. `Loan_Amount` is carried by five fields of this definition: one for a
   * new loan, one for a top-up and three for other products. A lookup keyed on the name alone
   * kept whichever came last, so twenty thousand euro landed on the top-up field, the new-loan
   * field stayed empty, and the calculated total came out as zero. The packet said a man asking
   * to borrow €20,000 wanted nothing.
   */
  it('puts the amount on the field this branch actually uses', () => {
    const resolved = fill()
    expect(resolved.answers['179']).toBe(20000)
    expect(resolved.answers['199']).toBeUndefined()
  })

  it('translates Saoirse vocabulary into the form’s own', () => {
    const resolved = fill()
    expect(resolved.answers['171']).toBe('tenant') // renting
    expect(resolved.answers['167']).toBe('Self Employed')
    expect(resolved.answers['341']).toBe('No') // salary paid to another bank
    expect(resolved.answers['22']).toBe('Yes') // holds €8,000 in savings
  })

  it('splits a name and dates a duration', () => {
    const resolved = fill()
    expect(resolved.answers['203']).toBe('Dave')
    expect(resolved.answers['204']).toBe('Quinn')
    expect(resolved.answers['443']).toEqual({ years: 5, months: 0 })
  })

  it('leaves what it genuinely cannot answer', () => {
    const resolved = fill()
    // Country of birth and citizenship are not a nationality; length of residence is not time
    // at an address. None of them are mapped, so none of them are filled.
    expect(resolved.answers['4']).toBeUndefined()
    expect(resolved.answers['5']).toBeUndefined()
    expect(resolved.answers['51']).toBeUndefined()
  })

  it('does not put a gross annual salary in a net monthly field', () => {
    const resolved = fillFromFacts({
      definition: loan?.definition ?? { id: '', title: '', fields: [] },
      prefill: mapping?.prefill ?? [],
      // Saoirse holds the gross annual figure and nothing else.
      held: (key) => (key === 'income.annualBasic' ? 65000 : undefined),
      reused: () => true,
      answers: tapped,
    })
    expect(resolved.answers['83']).toBeUndefined()
  })

  it('cuts the questions a customer meets, which is the whole claim', () => {
    const definition = loan?.definition
    if (!definition) throw new Error('1940 is not registered')

    const cold = resolveFormState(definition, tapped).outstanding.length
    const warm = resolveFormState(definition, { ...tapped, ...fill().answers }).outstanding.length

    expect(warm).toBeLessThan(cold)
    // What is left is the consents, the uploads, and what Saoirse genuinely does not know.
    expect(warm).toBeLessThanOrEqual(20)
  })
})
