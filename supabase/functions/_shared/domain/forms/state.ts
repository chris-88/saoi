import type { FormDefinition, FormField } from './definition.ts'
import { activeFields, type Answers } from './logic.ts'
import { calculatedValues } from './calculations.ts'

/**
 * Where a journey has got to: what applies, what the form has worked out, and what is left.
 *
 * Active fields and calculated values are circular by nature. Which fields apply depends on the
 * total amount, the total amount is calculated from the loan amount, and which loan-amount
 * field is the one that counts depends on which fields apply. SuperSaver never showed this
 * because it calculates nothing; the loan form puts it on the first page.
 *
 * So it settles rather than computes: work out what applies, calculate from what applies,
 * work out what applies again, and stop when the answer stops moving. Two passes is the normal
 * case and the bound exists for the pathological one.
 *
 * None of this is the model's work. The model decides how to ask; this decides what is asked.
 */

/** Structure rather than question: layout, copy, and the containers they sit in. */
export const STRUCTURAL = new Set(['html', 'section', 'page', 'accordion', 'form_module'])

/**
 * Controls the platform fills in for itself.
 *
 * Not questions, but not structure either: they are submitted. A calculated total, a hidden
 * routing flag, an eligibility verdict and an upload preview all end up in the packet without
 * anybody being asked anything, which is exactly why they must not appear in the list of
 * things still to collect.
 */
export const DERIVED_TYPES = new Set([
  'hidden',
  'file_preview',
  'ndi_calculator',
  'ndi_simulate_repayments',
  'ndi_eligibility',
  'ndi_quote_results',
  'ndi_affordable_options',
])

export type FormState = {
  /** Answers plus everything the form derived, which is what the rules are evaluated against. */
  readonly values: Answers
  /** What the form worked out, kept apart so the console can show it as derived. */
  readonly derived: Readonly<Record<string, number>>
  readonly active: readonly FormField[]
  /** Active, required, nobody has answered: the questions actually outstanding. */
  readonly outstanding: readonly FormField[]
}

const MAX_SETTLING_PASSES = 6

/**
 * Is this a question somebody has to answer, as opposed to something the form handles?
 *
 * A calculated field is excluded even when it is required and empty, because asking a customer
 * for a figure the definition says to derive is precisely the behaviour this whole engine
 * exists to avoid.
 */
export function isQuestion(field: FormField): boolean {
  if (STRUCTURAL.has(field.type)) return false
  if (DERIVED_TYPES.has(field.type)) return false
  if ((field.calculationFormula ?? '').trim() !== '') return false
  return true
}

export function resolveFormState(definition: FormDefinition, answers: Answers): FormState {
  let values: Answers = answers
  let active = activeFields(definition.fields, values)
  let derived: Readonly<Record<string, number>> = {}

  for (let pass = 0; pass < MAX_SETTLING_PASSES; pass += 1) {
    /*
     * Only answers on the live path count.
     *
     * Somebody who asks for €20,000 for a car and then changes to a student loan has an answer
     * sitting on a field that no longer applies. The platform's own total sums seven different
     * loan-amount fields, so a stale one would quietly double the amount being applied for.
     */
    const live: Record<string, unknown> = {}
    for (const field of active) {
      /*
       * The definition's own defaults, applied before anything else.
       *
       * Forty-three fields carry one, and they are not cosmetic: the loan-amount question only
       * appears when the hidden `IsNotStudent` flag is "1", and that 1 is a default. Without
       * this the first question on the form is inactive, the total calculates to zero, and the
       * engine reports that a customer who has asked to borrow twenty thousand euro has asked
       * for nothing.
       */
      const fallback = field.defaultValue
      if (typeof fallback === 'string' && fallback.trim() !== '') live[field.id] = fallback

      if (Object.prototype.hasOwnProperty.call(answers, field.id)) {
        live[field.id] = answers[field.id]
      }
    }

    derived = calculatedValues(definition.fields, live)
    values = { ...live, ...derived }

    const settled = activeFields(definition.fields, values)
    const same =
      settled.length === active.length && settled.every((field, at) => field.id === active[at]?.id)

    active = settled
    if (same) break
  }

  /*
   * A default is an answer for this purpose. The platform submits it whether or not anybody
   * looked at it, so presenting it as a question still to ask would be asking somebody to
   * confirm a value they are never shown.
   */
  const outstanding = active.filter(
    (field) =>
      field.isRequired &&
      isQuestion(field) &&
      !Object.prototype.hasOwnProperty.call(values, field.id),
  )

  return { values, derived, active, outstanding }
}
