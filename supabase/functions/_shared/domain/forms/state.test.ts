import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { formDefinitionSchema } from './definition.ts'
import { resolveFormState } from './state.ts'

const definition = (fields: readonly Record<string, unknown>[]) =>
  formDefinitionSchema.parse({ id: '1940', title: 'test', fields })

const show = (fieldId: string, operator: string, value: unknown) => ({
  actionType: 'show',
  logicType: 'all',
  rules: [{ fieldId, operator, value }],
})

describe('settling a journey', () => {
  it('a branch opened by a calculated value is active', () => {
    const form = definition([
      { id: '179', type: 'number', label: 'How much do you want to borrow?', isRequired: true },
      { id: '255', type: 'number', label: 'Total amount', calculationFormula: '{:179}+{:218}' },
      {
        id: '263',
        type: 'html',
        label: 'Too much for a standard loan',
        conditionalLogic: show('255', '>', '75000'),
      },
    ])

    // 255 is never answered: it is derived from 179, and the warning compares against it.
    const under = resolveFormState(form, { 179: 20000 })
    expect(under.derived).toEqual({ 255: 20000 })
    expect(under.active.map((f) => f.id)).not.toContain('263')

    const over = resolveFormState(form, { 179: 80000 })
    expect(over.derived).toEqual({ 255: 80000 })
    expect(over.active.map((f) => f.id)).toContain('263')
  })

  /**
   * The reason this settles rather than computing once. An answer left behind on a branch the
   * customer has moved off still sits in `answers`, and the total sums seven possible
   * loan-amount fields: counting a stale one doubles what somebody is applying for.
   */
  it('drops an answer left behind on a branch that is no longer live', () => {
    const form = definition([
      { id: '363', type: 'radio', label: 'Are you a student?' },
      {
        id: '179',
        type: 'number',
        label: 'Standard amount',
        conditionalLogic: show('363', 'is', 'No'),
      },
      {
        id: '396',
        type: 'number',
        label: 'Student amount',
        conditionalLogic: show('363', 'is', 'Yes'),
      },
      { id: '255', type: 'number', label: 'Total amount', calculationFormula: '{:179}+{:396}' },
    ])

    const state = resolveFormState(form, { 363: 'Yes', 179: 20000, 396: 3000 })

    expect(state.derived).toEqual({ 255: 3000 })
    expect(state.values['179']).toBeUndefined()
  })

  it('what is outstanding is the active required questions nobody has answered', () => {
    const form = definition([
      { id: '1', type: 'text', label: 'Asked', isRequired: true },
      { id: '2', type: 'text', label: 'Answered', isRequired: true },
      { id: '3', type: 'text', label: 'Optional' },
      {
        id: '4',
        type: 'text',
        label: 'On another branch',
        isRequired: true,
        conditionalLogic: show('1', 'is', 'maybe'),
      },
      { id: '5', type: 'html', label: 'Copy', isRequired: true },
      { id: '6', type: 'number', label: 'Derived', isRequired: true, calculationFormula: '{:2}' },
      { id: '7', type: 'ndi_eligibility', label: 'Eligibility', isRequired: true },
      { id: '8', type: 'hidden', label: 'Routing flag', isRequired: true },
    ])

    const state = resolveFormState(form, { 2: 'given' })

    // Only field 1. Not the optional one, not the inactive one, not the copy, and not the four
    // the form fills in for itself however required they are marked.
    expect(state.outstanding.map((f) => f.id)).toEqual(['1'])
  })

  it('answering an active required field removes it from what is outstanding', () => {
    const form = definition([{ id: '1', type: 'text', label: 'Name', isRequired: true }])
    expect(resolveFormState(form, {}).outstanding).toHaveLength(1)
    expect(resolveFormState(form, { 1: 'Dave' }).outstanding).toHaveLength(0)
  })
})

describe('the real personal loan definition', () => {
  const snapshot = JSON.parse(
    readFileSync('supabase/functions/_shared/tenants/demo/forms/form-1940.json', 'utf8'),
  ) as { definition: unknown }
  const loan = formDefinitionSchema.parse(snapshot.definition)

  it('parses, which the published operators once stopped it doing', () => {
    expect(loan.fields).toHaveLength(418)
    expect(loan.title).toBe('Consumer Loans E2E Combined - R9.10.1')
  })

  /** The captured branch: a new standard loan of €20,000 to buy a car, repaid monthly. */
  const carLoan = {
    363: 'No',
    207: 'New loan',
    500: 'Car purchase',
    179: 20000,
    70: 'monthly',
    221: 'No',
    234: '24',
    77: 'single',
    171: 'home',
    242: '0',
    167: 'Private sector',
  }

  it('derives the total amount from what the customer asked to borrow', () => {
    // 255 is never asked. The loan amount question itself only exists once a product is chosen
    // and the hidden student flag is at its default, which is what makes this a real check.
    expect(resolveFormState(loan, carLoan).derived['255']).toBe(20000)
  })

  /**
   * The claim the demo makes out loud, measured rather than asserted: 418 objects, 141 of them
   * questions, and this customer meets 29. They are the fields in the captured submission.
   */
  it('asks a fraction of what the document contains', () => {
    const state = resolveFormState(loan, carLoan)
    expect(state.outstanding.length).toBe(29)

    const asked = state.outstanding.map((f) => f.id)
    expect(asked).toContain('83') // net monthly salary
    expect(asked).toContain('475') // PPS number
    expect(asked).toContain('50') // the last of the six confirmations
  })

  it('does not ask a car buyer which college they attend', () => {
    // Page 22 exists and is required, but it belongs to the student journey.
    expect(resolveFormState(loan, carLoan).outstanding.map((f) => f.id)).not.toContain('372')
  })

  it('never asks for a calculated amount or an eligibility verdict', () => {
    const state = resolveFormState(loan, carLoan)
    expect(state.outstanding.map((f) => f.type)).not.toContain('ndi_eligibility')
    expect(state.outstanding.map((f) => f.id)).not.toContain('255')
  })
})
