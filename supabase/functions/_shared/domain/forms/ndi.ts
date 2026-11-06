import type { FormDefinition, FormField } from './definition.ts'
import { evaluateFormula } from './calculations.ts'
import { quantity, type Answers } from './logic.ts'
import { repaymentFor } from '../quotes/maths.ts'

/**
 * The form's decision machinery: quotes, affordability and the eligibility verdict.
 *
 * The loan definition does not only describe questions. It describes four custom controls that
 * calculate, and one of them decides whether an application can proceed at all. That is what
 * makes this form a stronger proof than SuperSaver, and also what makes it the most dangerous
 * part to implement: a conversational assistant that invents an eligibility result is not a
 * demonstration of anything anybody would ship.
 *
 * So every control declares how honest it is, in its own output, and the console shows it:
 *
 *   source_faithful  computed here, from the definition's own declared inputs
 *   fixture          a stand-in, labelled as one, with the real contract unknown
 *   unsupported      the journey cannot proceed through this control
 *
 * The parameters are source-faithful for all of them, because the definition declares them:
 * field 238 carries `loanAmount: "{:255}"`, `salaryNet: "{:83}+{:91}"` and ten more. Those are
 * the bank's own references into its own form, resolved against this customer's answers.
 *
 * The results divide. A repayment is standard amortisation and is computed. An eligibility
 * verdict is undisclosed underwriting and is not: it is a fixture, it says so, and the model
 * has no way to set it.
 */

export const FIDELITIES = ['source_faithful', 'fixture', 'unsupported'] as const
export type Fidelity = (typeof FIDELITIES)[number]

/** Controls that calculate rather than ask. */
export const NDI_CALCULATORS = new Set([
  'ndi_simulate_repayments',
  'ndi_calculator',
  'ndi_eligibility',
])

export type NdiOutcome = {
  readonly fieldId: string
  readonly control: string
  readonly label: string
  readonly fidelity: Fidelity
  /** The declared inputs, resolved against this customer. Always source-faithful. */
  readonly parameters: Readonly<Record<string, string | number>>
  /** `null` when nothing can honestly be produced. */
  readonly result: string | number | null
  /** What the console says about it, in words a presenter can read out. */
  readonly note: string
}

/**
 * A rule the definition itself states about an amount.
 *
 * Distinct from eligibility and not a credit decision: these are the published limits, written
 * into the document as numeric conditions, and an application that trips one is outside the
 * product before anybody assesses anything. Reported separately so the console can show what
 * comes from the bank's own document next to what does not.
 */
export type LimitWarning = {
  readonly fieldId: string
  readonly label: string
  readonly comparedField: string
  readonly operator: '>' | '<'
  readonly limit: string
  readonly actual: number
}

export type NdiInput = {
  readonly definition: FormDefinition
  /** The settled values: answers, defaults and calculated fields. */
  readonly values: Answers
  readonly active: ReadonlySet<string>
  /** The published rate for the product and term, as a fraction. Tenant knowledge, injected. */
  readonly annualRate: number | null
  /**
   * The verdict to report where the real contract is not ours to implement.
   *
   * Passed in rather than written here so that the thing standing in for a credit decision is
   * visible at the call site, and so that a console can show something other than "eligible"
   * without this file growing an opinion about lending.
   */
  readonly eligibilityFixture: string
}

const asText = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : ''

/** `{:179}` inside a declared parameter. */
const REFERENCE = /\{:(\d+(?:\.\d+)?)\}/g

/**
 * One declared parameter, resolved.
 *
 * Two shapes appear. `{:83}+{:91}` is arithmetic and resolves to a number. `{:171}{:178}` is
 * two references end to end, which is how the form expresses "whichever of these is answered",
 * and resolves to text.
 */
function resolveParameter(formula: string, values: Answers): string | number {
  const literal = formula.replace(REFERENCE, (_whole, id: string) => asText(values[id])).trim()

  /*
   * Decided on the values, not on the formula.
   *
   * Asking the arithmetic evaluator first does not work: it substitutes anything non-numeric
   * as zero, so `{:171}{:178}`, where 171 is "home", came back as the number 0 rather than the
   * living arrangement. Substituting the real text first and seeing whether what is left could
   * be arithmetic tells the two apart, and the evaluator still does the sum, so an absent
   * reference in `{:83}+{:91}` is still worth nothing rather than breaking the expression.
   */
  if (!/^[\d\s.+\-*/()]*$/.test(literal)) return literal

  return evaluateFormula(formula, values) ?? literal
}

/**
 * The declared inputs of a control.
 *
 * Any setting whose value mentions a field reference is an input; everything else on the
 * control is presentation. That rule is the control's own, not ours, which is what lets a new
 * NDI type work here without being named.
 */
export function declaredParameters(
  field: FormField,
  values: Answers,
): Readonly<Record<string, string | number>> {
  const platform = field.platform ?? {}
  const resolved: Record<string, string | number> = {}

  for (const [key, raw] of Object.entries(platform)) {
    if (typeof raw !== 'string' || !raw.includes('{:')) continue

    /*
     * The platform encodes a control's configuration in its CSS class.
     *
     * `e2e-control[ndi_simulate_repayments](moratorium={:222}{:458},termType={:70}{:456})` is
     * a real value from the definition: the class name carries the control type and a list of
     * named inputs. Dumped whole it is noise in a packet; parsed, it is three more declared
     * parameters. The raw string itself is never a parameter.
     */
    if (key === 'cssClass') {
      for (const [name, formula] of controlConfig(raw)) {
        resolved[name] = resolveParameter(formula, values)
      }
      continue
    }

    resolved[key] = resolveParameter(raw, values)
  }

  return resolved
}

/** The `name={:ref}` pairs inside a control class's bracketed configuration. */
function controlConfig(cssClass: string): readonly (readonly [string, string])[] {
  const inside = /\(([^)]*)\)/.exec(cssClass)?.[1]
  if (inside === undefined) return []

  const pairs: (readonly [string, string])[] = []
  for (const part of inside.split(',')) {
    const at = part.indexOf('=')
    if (at <= 0) continue
    const name = part.slice(0, at).trim()
    const formula = part.slice(at + 1).trim()
    if (name === '' || !formula.includes('{:')) continue
    pairs.push([name, formula] as const)
  }
  return pairs
}

/**
 * What each calculating control produces for this customer.
 *
 * Only active controls: a quote on a branch the customer is not on is not a quote.
 */
export function resolveNdi(input: NdiInput): readonly NdiOutcome[] {
  const outcomes: NdiOutcome[] = []

  for (const field of input.definition.fields) {
    if (!NDI_CALCULATORS.has(field.type)) continue
    if (!input.active.has(field.id)) continue

    const parameters = declaredParameters(field, input.values)

    if (field.type === 'ndi_eligibility') {
      /*
       * The one result this codebase will not compute.
       *
       * Affordability at Demo Bank is a credit decision made by systems and policies
       * that are not published and not ours. Implementing something that looks like one would
       * produce a number a customer might act on, which is the precise failure the whole
       * engine-not-model architecture exists to prevent. A fixture that says it is a fixture is
       * honest; a plausible invention is not.
       */
      outcomes.push({
        fieldId: field.id,
        control: field.type,
        label: field.label,
        fidelity: 'fixture',
        parameters,
        result: input.eligibilityFixture,
        note: 'Stand-in result. The real affordability decision is undisclosed and is not reimplemented here.',
      })
      continue
    }

    const repayment = monthlyRepayment(parameters, input.annualRate)
    outcomes.push({
      fieldId: field.id,
      control: field.type,
      label: field.label,
      fidelity: repayment === null ? 'unsupported' : 'source_faithful',
      parameters,
      result: repayment,
      note:
        repayment === null
          ? 'Not enough is known yet to work this out: the amount, the term or the rate is missing.'
          : 'Computed here by standard amortisation, from the inputs this control declares.',
    })
  }

  return outcomes
}

/**
 * The monthly repayment, from whichever of the declared parameters carry the amount and term.
 *
 * Named by the controls themselves (`loanAmount`, `term`), so this follows the document rather
 * than a list of field ids.
 */
function monthlyRepayment(
  parameters: Readonly<Record<string, string | number>>,
  annualRate: number | null,
): number | null {
  if (annualRate === null) return null

  const amount = quantity(parameters['loanAmount'])
  const months = quantity(parameters['term'])
  if (amount === undefined || months === undefined) return null
  if (amount <= 0 || months <= 0) return null

  return Math.round(repaymentFor(amount, annualRate, months) * 100) / 100
}

/**
 * Limits the definition states for itself.
 *
 * Every numeric rule in the loan document compares an amount against a published product
 * limit: over €75,000 is not a standard loan, over €5,000 is not a student loan. A field whose
 * rules include one of those comparisons, and which is active, is the document saying this
 * application is outside the product. That is not a credit decision and does not need to be a
 * fixture: it is theirs, written down, and Saoirse can state it.
 */
export function limitWarnings(input: {
  readonly definition: FormDefinition
  readonly values: Answers
  readonly active: ReadonlySet<string>
}): readonly LimitWarning[] {
  const warnings: LimitWarning[] = []

  for (const field of input.definition.fields) {
    if (!input.active.has(field.id)) continue

    const logic = field.conditionalLogic
    if (!logic || logic.actionType !== 'show') continue

    for (const rule of logic.rules) {
      if (rule.operator !== '>' && rule.operator !== '<') continue
      const actual = quantity(input.values[rule.fieldId])
      if (actual === undefined) continue

      warnings.push({
        fieldId: field.id,
        label: field.label,
        comparedField: rule.fieldId,
        operator: rule.operator,
        limit: asText(rule.value),
        actual,
      })
    }
  }

  return warnings
}
