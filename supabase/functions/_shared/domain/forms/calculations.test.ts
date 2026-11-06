import { describe, expect, it } from 'vitest'
import { formDefinitionSchema, type FormField } from './definition.ts'
import { calculatedValues, evaluateFormula } from './calculations.ts'

const field = (over: Partial<FormField> & { id: string }): FormField =>
  formDefinitionSchema.parse({
    id: '1',
    title: 't',
    fields: [{ type: 'number', label: '', ...over }],
  }).fields[0] as FormField

const definition = (fields: readonly Record<string, unknown>[]) =>
  formDefinitionSchema.parse({ id: '1940', title: 'test', fields })

describe('evaluating one formula', () => {
  it('adds the fields it names', () => {
    expect(evaluateFormula('{:179}+{:218}', { 179: 15000, 218: 5000 })).toBe(20000)
  })

  it('treats a field with no answer as zero, which is what the platform does', () => {
    // The real formula on field 255 adds seven possible loan amounts; one branch answers one.
    expect(
      evaluateFormula('{:179}+{:218}+{:219}+{:381}+{:396}+{:453}+{:501}', { 179: 20000 }),
    ).toBe(20000)
  })

  it('honours precedence and brackets', () => {
    expect(evaluateFormula('({:523}/{:255})*100', { 523: 5000, 255: 20000 })).toBe(25)
    expect(evaluateFormula('{:1}+{:2}*{:3}', { 1: 2, 2: 3, 3: 4 })).toBe(14)
  })

  it('reads a number out of a string answer, because form values arrive as text', () => {
    expect(evaluateFormula('{:179}+{:218}', { 179: '15000', 218: '5000.50' })).toBe(20000.5)
  })

  /**
   * A blank denominator is the ordinary state of this form, not an edge case: the energy
   * percentage divides by the total loan amount, and the total is zero until somebody says
   * what they want to borrow. Infinity compared against "> 100" would fire a validation
   * warning at a customer who has answered nothing.
   */
  it('gives nothing rather than infinity when it divides by zero', () => {
    expect(evaluateFormula('({:523}/{:255})*100', { 523: 5000 })).toBeUndefined()
  })

  it('refuses a formula containing anything but arithmetic', () => {
    expect(evaluateFormula('{:1}+fetch("x")', { 1: 1 })).toBeUndefined()
    expect(evaluateFormula('process.exit(1)', {})).toBeUndefined()
  })

  it('gives nothing for an empty formula', () => {
    expect(evaluateFormula('', { 1: 1 })).toBeUndefined()
  })
})

describe('resolving every calculated field', () => {
  it('fills one calculation from the answers', () => {
    const form = definition([
      { id: '179', type: 'number', label: 'How much do you want to borrow?' },
      { id: '255', type: 'number', label: 'Total amount', calculationFormula: '{:179}+{:218}' },
    ])

    expect(calculatedValues(form.fields, { 179: 20000 })).toEqual({ 255: 20000 })
  })

  /**
   * 618 is `{:525}` and 525 is `({:523}/{:255})*100`, so a single pass in definition order
   * resolves 618 against an undefined 525 and reports nothing. Both are compared with `>` and
   * `<` by the active-field rules, so getting this wrong silently changes which questions a
   * customer is asked.
   */
  it('resolves a calculation that depends on another calculation', () => {
    const form = definition([
      { id: '618', type: 'number', label: 'Percentage, again', calculationFormula: '{:525}' },
      { id: '525', type: 'number', label: 'Percentage', calculationFormula: '({:523}/{:255})*100' },
      { id: '523', type: 'number', label: 'Energy spend' },
      { id: '255', type: 'number', label: 'Total amount', calculationFormula: '{:179}' },
      { id: '179', type: 'number', label: 'Borrowing' },
    ])

    expect(calculatedValues(form.fields, { 179: 20000, 523: 5000 })).toEqual({
      255: 20000,
      525: 25,
      618: 25,
    })
  })

  it('leaves a circular calculation out rather than looping', () => {
    const form = definition([
      { id: '1', type: 'number', label: 'a', calculationFormula: '{:2}' },
      { id: '2', type: 'number', label: 'b', calculationFormula: '{:1}' },
    ])

    expect(calculatedValues(form.fields, {})).toEqual({})
  })

  it('an answered calculated field keeps the answer', () => {
    const form = definition([
      { id: '255', type: 'number', label: 'Total amount', calculationFormula: '{:179}' },
      { id: '179', type: 'number', label: 'Borrowing' },
    ])

    // The platform recalculates, but an explicit answer is the customer's and is not overwritten
    // silently: this is the same rule as everywhere else in Saoirse.
    expect(calculatedValues(form.fields, { 179: 20000, 255: 31000 })).toEqual({})
  })

  it('ignores fields with no formula', () => {
    expect(calculatedValues([field({ id: '1' })], { 1: 5 })).toEqual({})
  })
})
