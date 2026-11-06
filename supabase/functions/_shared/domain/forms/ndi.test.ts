import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { formDefinitionSchema } from './definition.ts'
import { resolveFormState } from './state.ts'
import { declaredParameters, limitWarnings, resolveNdi } from './ndi.ts'

const loan = formDefinitionSchema.parse(
  (
    JSON.parse(
      readFileSync('supabase/functions/_shared/tenants/demo/forms/form-1940.json', 'utf8'),
    ) as { definition: unknown }
  ).definition,
)

/** A new standard loan of €20,000 over 24 months, which is the captured branch. */
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
  83: 4200,
  85: 1500,
  87: 900,
  88: 0,
}

const stateFor = (answers: Record<string, unknown>) => {
  const state = resolveFormState(loan, answers)
  return { state, active: new Set(state.active.map((f) => f.id)) }
}

describe('the inputs a control declares', () => {
  it('resolves the full quote’s own references against this customer', () => {
    const { state } = stateFor(carLoan)
    const field = loan.fields.find((f) => f.id === '238')
    if (!field) throw new Error('238 is missing from the definition')

    const parameters = declaredParameters(field, state.values)

    // Straight from the definition: loanAmount is `{:255}`, the calculated total.
    expect(parameters['loanAmount']).toBe(20000)
    expect(parameters['term']).toBe(24)
    // `{:83}+{:91}` is arithmetic: salary plus any maintenance received.
    expect(parameters['salaryNet']).toBe(4200)
    // `{:171}{:178}` is two references end to end, which resolves as text.
    expect(parameters['livingArrangements']).toBe('home')
    // `{:85}+{:86}` sums the mortgage and the rent, whichever the branch uses.
    expect(parameters['monthlyMortgageRentPayments']).toBe(1500)
  })

  it('ignores settings that are not references', () => {
    const { state } = stateFor(carLoan)
    const upload = loan.fields.find((f) => f.id === '151')
    if (!upload) throw new Error('151 is missing from the definition')

    // maxFileSize and allowedExtensions are configuration, not inputs.
    expect(declaredParameters(upload, state.values)).toEqual({})
  })
})

describe('what each control produces', () => {
  const run = (answers: Record<string, unknown>, rate: number | null = 0.079) => {
    const { state, active } = stateFor(answers)
    return resolveNdi({
      definition: loan,
      values: state.values,
      active,
      annualRate: rate,
      eligibilityFixture: 'eligible',
    })
  }

  it('computes a repayment rather than inventing one', () => {
    const quote = run(carLoan).find((o) => o.fieldId === '238')
    expect(quote?.fidelity).toBe('source_faithful')
    // €20,000 over 24 months at 7.9%: the standard annuity payment, to the cent.
    expect(quote?.result).toBeCloseTo(903.63, 1)
  })

  it('says so when it cannot work one out', () => {
    const quote = run(carLoan, null).find((o) => o.fieldId === '238')
    expect(quote?.fidelity).toBe('unsupported')
    expect(quote?.result).toBeNull()
  })

  /**
   * The line this feature must not cross. An affordability verdict is a credit decision made
   * by systems that are not published, and a conversational assistant that produces one has
   * invented it however reasonable the arithmetic looks.
   */
  it('never computes an eligibility verdict', () => {
    const verdict = run(carLoan).find((o) => o.control === 'ndi_eligibility')
    expect(verdict?.fidelity).toBe('fixture')
    expect(verdict?.result).toBe('eligible')
    expect(verdict?.note).toMatch(/undisclosed/i)
  })

  it('leaves out controls the customer’s branch never reaches', () => {
    const outcomes = run({ 363: 'No' })
    // Nothing is known about an amount or a term yet, so no full quote is on this branch.
    expect(outcomes.every((o) => o.result === null || o.fidelity === 'fixture')).toBe(true)
  })
})

describe('limits the document states for itself', () => {
  const warningsFor = (answers: Record<string, unknown>) => {
    const { state, active } = stateFor(answers)
    return limitWarnings({ definition: loan, values: state.values, active })
  }

  it('is quiet on an amount within the product', () => {
    expect(warningsFor(carLoan)).toEqual([])
  })

  /**
   * Not a credit decision and not a fixture: the €75,000 ceiling is written into the bank's
   * own document as a numeric condition, so Saoirse can state it with the document as its source.
   */
  it('reports an amount the published rules put outside the product', () => {
    const warnings = warningsFor({ ...carLoan, 179: 80000 })
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]?.actual).toBe(80000)
    expect(warnings[0]?.limit).toBe('75000')
    expect(warnings[0]?.operator).toBe('>')
  })
})
