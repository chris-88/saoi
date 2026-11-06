import { describe, expect, it } from 'vitest'
import { activeFields, isActive, type Answers } from './logic.ts'
import type { FormField } from './definition.ts'

const field = (overrides: Partial<FormField>): FormField => ({
  id: '1',
  type: 'text',
  label: '',
  isRequired: false,
  description: '',
  ...overrides,
})

/**
 * Which questions apply to this customer.
 *
 * Deterministic, and deliberately not the model's job. The real SuperSaver definition carries
 * 540 rules across 246 fields; a model asked to decide which apply would be wrong occasionally
 * and unaccountably, and §17.1 of the feature note is explicit that a required field which is
 * not active must not block the journey.
 */
describe('isActive()', () => {
  it('shows a field with no logic at all', () => {
    expect(isActive(field({}), {})).toBe(true)
  })

  it('shows when a `show` rule matches and hides when it does not', () => {
    const f = field({
      conditionalLogic: {
        actionType: 'show',
        logicType: 'all',
        rules: [{ fieldId: '335', operator: 'is', value: 'onlinebanking' }],
      },
    })
    expect(isActive(f, { '335': 'onlinebanking' })).toBe(true)
    expect(isActive(f, { '335': 'branch' })).toBe(false)
    // Unanswered is not a match, which is what keeps a journey from opening every branch.
    expect(isActive(f, {})).toBe(false)
  })

  it('hides when a `hide` rule matches', () => {
    const f = field({
      conditionalLogic: {
        actionType: 'hide',
        logicType: 'all',
        rules: [{ fieldId: '1159', operator: 'is', value: '1' }],
      },
    })
    expect(isActive(f, { '1159': '1' })).toBe(false)
    expect(isActive(f, { '1159': '0' })).toBe(true)
  })

  it('treats `all` as every rule and `any` as at least one', () => {
    const rules = [
      { fieldId: 'a', operator: 'is' as const, value: 'x' },
      { fieldId: 'b', operator: 'is' as const, value: 'y' },
    ]
    const all = field({ conditionalLogic: { actionType: 'show', logicType: 'all', rules } })
    const any = field({ conditionalLogic: { actionType: 'show', logicType: 'any', rules } })

    expect(isActive(all, { a: 'x', b: 'y' })).toBe(true)
    expect(isActive(all, { a: 'x' })).toBe(false)
    expect(isActive(any, { a: 'x' })).toBe(true)
    expect(isActive(any, {})).toBe(false)
  })

  it('handles `isnot`, including against an unanswered field', () => {
    const f = field({
      conditionalLogic: {
        actionType: 'show',
        logicType: 'all',
        rules: [{ fieldId: '778', operator: 'isnot', value: '' }],
      },
    })
    // This is the real PPS-confirmation rule: show once something has been entered.
    expect(isActive(f, { '778': '1234567T' })).toBe(true)
    expect(isActive(f, { '778': '' })).toBe(false)
    expect(isActive(f, {})).toBe(false)
  })

  it('compares as strings, because the definition mixes numbers and strings', () => {
    const f = field({
      conditionalLogic: {
        actionType: 'show',
        logicType: 'all',
        rules: [{ fieldId: 'n', operator: 'is', value: 1 }],
      },
    })
    expect(isActive(f, { n: '1' })).toBe(true)
    expect(isActive(f, { n: 1 })).toBe(true)
  })

  it('does not follow a chain: a rule reads the answer, not the referenced field’s own logic', () => {
    /*
     * The platform evaluates against submitted values. A field whose controller is itself
     * hidden simply has no answer, which the rules above already treat as "no match" — so the
     * branch closes without this needing to recurse.
     */
    const f = field({
      conditionalLogic: {
        actionType: 'show',
        logicType: 'all',
        rules: [{ fieldId: 'hidden', operator: 'is', value: 'yes' }],
      },
    })
    expect(isActive(f, {})).toBe(false)
  })
})

describe('answers that are arrays', () => {
  it('matches when any selected value matches, for multi-select and checkbox groups', () => {
    const f = field({
      conditionalLogic: {
        actionType: 'show',
        logicType: 'all',
        rules: [{ fieldId: 'c', operator: 'is', value: 'b' }],
      },
    })
    const answers: Answers = { c: ['a', 'b'] }
    expect(isActive(f, answers)).toBe(true)
    expect(isActive(f, { c: ['a'] })).toBe(false)
  })
})

/**
 * The thirteen numeric rules in the personal loan definition, all of them comparing a
 * calculated amount: over €75,000 is not a standard loan, over €5,000 is not a student loan,
 * over €10,000 is not a tenant home-improvement loan. Getting these wrong shows a customer a
 * validation warning about a product they are not applying for, or hides one they need.
 */
describe('comparing amounts', () => {
  const over = (value: string) =>
    field({
      conditionalLogic: {
        actionType: 'show',
        logicType: 'all',
        rules: [{ fieldId: '255', operator: '>', value }],
      },
    })

  it('compares as numbers, not as text', () => {
    // '9000' > '75000' is true when compared as strings, which would warn on every valid loan.
    expect(isActive(over('75000'), { 255: 9000 })).toBe(false)
    expect(isActive(over('75000'), { 255: 80000 })).toBe(true)
    expect(isActive(over('75000'), { 255: '80000' })).toBe(true)
  })

  it('is strict at the boundary, because the limit itself is allowed', () => {
    expect(isActive(over('75000'), { 255: 75000 })).toBe(false)
  })

  it('handles less than', () => {
    const under = field({
      conditionalLogic: {
        actionType: 'show',
        logicType: 'all',
        rules: [{ fieldId: '618', operator: '<', value: '75' }],
      },
    })
    expect(isActive(under, { 618: 50 })).toBe(true)
    expect(isActive(under, { 618: 80 })).toBe(false)
  })

  it('never matches when the value is missing or not a number', () => {
    expect(isActive(over('75000'), {})).toBe(false)
    expect(isActive(over('75000'), { 255: '' })).toBe(false)
    expect(isActive(over('75000'), { 255: 'a lot' })).toBe(false)
  })
})

/**
 * Both definitions are multi-page wizards whose branching mostly lives on the page, not on the
 * field: the loan form has 47 pages, 29 of them conditional, and the fields behind them carry
 * no logic at all. The student education questions are a plain required select with no rule on
 * it, sitting on a page that appears only when the student flag is set.
 *
 * Without this, a car loan applicant is asked for the name of their college.
 */
describe('pages, which carry most of the branching', () => {
  const wizard = [
    {
      id: 'p2',
      type: 'page',
      pageNumber: 2,
      label: '',
      conditionalLogic: {
        actionType: 'show',
        logicType: 'all',
        rules: [{ fieldId: 'student', operator: 'is', value: '1' }],
      },
    },
    { id: 'college', type: 'select', pageNumber: 2, label: 'Name of college', isRequired: true },
    { id: 'p3', type: 'page', pageNumber: 3, label: '' },
    { id: 'employer', type: 'text', pageNumber: 3, label: 'Employer', isRequired: true },
    { id: 'student', type: 'radio', pageNumber: 1, label: 'Student?' },
  ].map((f) => field(f as Partial<FormField>))

  it('hides a field whose page is not shown, even when the field itself has no rule', () => {
    expect(activeFields(wizard, { student: '0' }).map((f) => f.id)).not.toContain('college')
  })

  it('shows it once the page applies', () => {
    expect(activeFields(wizard, { student: '1' }).map((f) => f.id)).toContain('college')
  })

  it('leaves a page with no condition alone', () => {
    expect(activeFields(wizard, {}).map((f) => f.id)).toContain('employer')
  })

  it('page one needs no page break to be active', () => {
    expect(activeFields(wizard, {}).map((f) => f.id)).toContain('student')
  })
})
