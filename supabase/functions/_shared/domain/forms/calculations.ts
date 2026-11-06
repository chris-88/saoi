import type { FormField } from './definition.ts'
import { quantity, type Answers } from './logic.ts'

/**
 * The values the form works out for itself.
 *
 * The loan definition carries six calculated fields, and they are not cosmetic: field 255 is
 * the total amount, summing whichever of seven possible loan-amount fields the active branch
 * uses, and the rules that decide whether an amount is valid compare against it. Ask a customer
 * for a total they have already given you in pieces and the journey is wrong; let the model
 * work it out and the number is a guess. So it is arithmetic, here, from the definition's own
 * formula.
 *
 *   255  {:179}+{:218}+{:219}+{:381}+{:396}+{:453}+{:501}
 *   525  ({:523}/{:255})*100
 *   618  {:525}
 *
 * The third one is why this resolves in dependency order rather than in definition order.
 */

/** `{:179}` is a reference to field 179's value. The only non-arithmetic token allowed. */
const REFERENCE = /\{:(\d+(?:\.\d+)?)\}/g

/** After references are substituted, a formula may contain nothing else. */
const ARITHMETIC_ONLY = /^[\d\s.+\-*/()]*$/

/** Deep enough for `{:525}` → `({:523}/{:255})*100` → `{:179}`, with room to spare. */
const MAX_DEPTH = 12

/**
 * Evaluate one formula against a set of values.
 *
 * An unreferenced or unanswered field counts as zero, which is what the platform does and what
 * field 255 depends on: seven loan-amount fields are summed and a given branch answers one.
 *
 * `undefined` rather than a number whenever the result is not a real quantity: a syntax it does
 * not recognise, a division by zero, anything that is not plain arithmetic once the references
 * are substituted. An absent calculated value leaves its comparisons false, which keeps a
 * branch closed; `Infinity` would open one, and the branches these feed are loan-amount
 * validity warnings.
 */
export function evaluateFormula(
  formula: string,
  values: Readonly<Record<string, unknown>>,
): number | undefined {
  if (formula.trim() === '') return undefined

  const substituted = formula.replace(REFERENCE, (_whole, id: string) =>
    String(quantity(values[id]) ?? 0),
  )

  /*
   * The guard that makes this safe to evaluate.
   *
   * These formulas come from a document published by somebody else, which is the definition of
   * untrusted input however reputable the publisher. After substitution the string may contain
   * digits, decimal points, the four operators, brackets and whitespace. Anything else, and the
   * answer is no result at all.
   */
  if (!ARITHMETIC_ONLY.test(substituted)) return undefined

  const result = arithmetic(substituted)
  return result !== undefined && Number.isFinite(result) ? result : undefined
}

/**
 * A four-operator expression evaluator.
 *
 * Hand-written rather than handed to `Function` or `eval`. The regular expression above means
 * what reaches here is arithmetic, but a prototype that evaluates a string pulled from another
 * organisation's website should not have a code path that could execute one at all, whatever
 * is believed about the filter in front of it.
 *
 * Recursive descent: expression is terms separated by + and -, a term is factors separated by
 * * and /, a factor is a number, a bracketed expression or a sign in front of either.
 */
function arithmetic(input: string): number | undefined {
  const text = input.replace(/\s+/g, '')
  let at = 0

  const expression = (): number | undefined => {
    let left = term()
    if (left === undefined) return undefined

    while (at < text.length && (text[at] === '+' || text[at] === '-')) {
      const operator = text[at]
      at += 1
      const right = term()
      if (right === undefined) return undefined
      left = operator === '+' ? left + right : left - right
    }
    return left
  }

  const term = (): number | undefined => {
    let left = factor()
    if (left === undefined) return undefined

    while (at < text.length && (text[at] === '*' || text[at] === '/')) {
      const operator = text[at]
      at += 1
      const right = factor()
      if (right === undefined) return undefined
      // Division by zero is the ordinary state of a percentage whose total is not known yet.
      if (operator === '/' && right === 0) return undefined
      left = operator === '*' ? left * right : left / right
    }
    return left
  }

  const factor = (): number | undefined => {
    if (at >= text.length) return undefined

    if (text[at] === '+' || text[at] === '-') {
      const sign = text[at] === '-' ? -1 : 1
      at += 1
      const value = factor()
      return value === undefined ? undefined : sign * value
    }

    if (text[at] === '(') {
      at += 1
      const inner = expression()
      if (inner === undefined || text[at] !== ')') return undefined
      at += 1
      return inner
    }

    const match = /^\d+(?:\.\d+)?/.exec(text.slice(at))
    if (!match) return undefined
    at += match[0].length
    return Number(match[0])
  }

  const value = expression()
  // Trailing characters mean the formula was not understood, not that the prefix was.
  return at === text.length ? value : undefined
}

/**
 * Every value the form derives, given what has been answered.
 *
 * Resolved by repetition rather than by sorting the dependency graph: a pass computes whatever
 * it can, and a pass that adds nothing new ends it. Simpler than a topological sort, and the
 * one thing a topological sort buys, detecting a cycle, falls out of it anyway: a circular pair
 * resolves nothing on the first pass and is left alone.
 *
 * A field the customer has answered is never overwritten. The platform would recalculate it,
 * but a stated answer belongs to the person who stated it, and silently replacing one is how a
 * form ends up submitting something nobody said.
 */
export function calculatedValues(
  fields: readonly FormField[],
  answers: Answers,
): Readonly<Record<string, number>> {
  const formulas = fields
    .map((field) => ({ id: field.id, formula: field.calculationFormula ?? '' }))
    .filter((entry) => entry.formula.trim() !== '')

  if (formulas.length === 0) return {}

  /** Which ids something is going to calculate, as opposed to ids nobody will ever fill. */
  const pending = new Set(formulas.map((entry) => entry.id))

  const outstanding = formulas.filter(
    (entry) => !Object.prototype.hasOwnProperty.call(answers, entry.id),
  )

  const derived: Record<string, number> = {}

  for (let pass = 0; pass < MAX_DEPTH; pass += 1) {
    let added = false

    for (const entry of outstanding) {
      if (entry.id in derived) continue

      /*
       * Only resolve a formula whose references are all available.
       *
       * Without this, `{:525}` evaluates against a missing 525 as zero and reports a confident
       * 0 for a percentage that is simply not known yet, which then satisfies `> 0` and shows
       * the customer a validation message about a branch they are not on.
       */
      if (!referencesReady(entry.formula, answers, derived, pending)) continue

      const value = evaluateFormula(entry.formula, { ...answers, ...derived })
      if (value === undefined) continue

      derived[entry.id] = value
      added = true
    }

    // A pass that resolves nothing ends it, which is also how a circular pair terminates:
    // neither of them ever becomes ready, so neither is reported.
    if (!added) break
  }

  return derived
}

/**
 * Whether every calculated field this formula names has a value yet.
 *
 * A reference to an ordinary question is fine unanswered, because the platform treats a blank
 * as zero. A reference to another calculation is not: it means this one is simply not its turn.
 */
function referencesReady(
  formula: string,
  answers: Answers,
  derived: Readonly<Record<string, number>>,
  pending: ReadonlySet<string>,
): boolean {
  for (const match of formula.matchAll(REFERENCE)) {
    const id = match[1]
    if (id === undefined) continue
    if (id in derived) continue
    if (Object.prototype.hasOwnProperty.call(answers, id)) continue
    if (pending.has(id)) return false
  }
  return true
}
