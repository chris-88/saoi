import type { ConditionalLogic, FormField, LogicOperator } from './definition.ts'

/**
 * Which questions apply to this customer, decided in code.
 *
 * The SuperSaver definition carries 540 rules across 246 of its 499 fields. A model asked to
 * work out which apply would be wrong occasionally and unaccountably, and the consequence is
 * not cosmetic: a required field that is not active must not block the journey, and a field
 * that is active must not be skipped. Same division as everywhere else in Saoirse, the engine
 * decides what is needed and the model decides how to ask.
 *
 * The operator surface is `is`, `isnot`, `>` and `<`, with `all` or `any`, acting to `show` or
 * `hide`. That is not a simplification: it is every operator the published definitions use.
 * SuperSaver needs only the first two; the loan adds the comparisons, every one of them against
 * a calculated amount deciding whether a loan is too large for the product it is on.
 */

/** What the customer has answered so far, keyed by field id. */
export type Answers = Readonly<Record<string, unknown>>

/**
 * Compared as strings throughout.
 *
 * The definition is inconsistent about it — `value: 1` in one rule and `"1"` in the next — and
 * the platform itself compares submitted form values, which arrive as text.
 */
function one(value: unknown): string {
  // Only the scalars a form answer can actually be. Anything else is not an answer, and
  // stringifying it would quietly produce "[object Object]" and compare that.
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function asStrings(value: unknown): readonly string[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return (value as readonly unknown[]).map(one)
  return [one(value)]
}

/**
 * As a number, for the two comparison operators.
 *
 * `undefined` for anything that is not one, and an unanswered or unreadable value never
 * satisfies a comparison: the branches these open are the loan-amount validity warnings, and
 * warning somebody about an amount they have not given is worse than saying nothing.
 */
export function quantity(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const parsed = Number(trimmed.replace(/[€,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

function ruleMatches(answer: unknown, operator: LogicOperator, expected: unknown): boolean {
  /*
   * Numerically, and only numerically.
   *
   * Compared as text, "9000" is greater than "75000", which would show the "too much to
   * borrow" warning on an ordinary nine-thousand-euro loan. Everything else in this file
   * compares as strings because the platform does; these two cannot.
   */
  if (operator === '>' || operator === '<') {
    const actual = quantity(answer)
    const target = quantity(expected)
    if (actual === undefined || target === undefined) return false
    return operator === '>' ? actual > target : actual < target
  }

  const actual = asStrings(answer)
  const target = one(expected)

  if (operator === 'is') {
    // An unanswered field matches `is ""`, which is how the platform treats a blank.
    return actual.length === 0 ? target === '' : actual.includes(target)
  }

  /*
   * An unanswered field never satisfies `isnot`.
   *
   * Conservative on purpose: it keeps a branch closed until the customer has actually said
   * something. The real rule this matters for is the PPS confirmation, which appears once a
   * number has been entered and must not appear before.
   */
  if (actual.length === 0) return false
  return !actual.includes(target)
}

function rulesPass(logic: ConditionalLogic, answers: Answers): boolean {
  if (logic.rules.length === 0) return true
  const results = logic.rules.map((rule) =>
    ruleMatches(answers[rule.fieldId], rule.operator, rule.value),
  )
  return logic.logicType === 'all' ? results.every(Boolean) : results.some(Boolean)
}

/**
 * Whether this field is part of the journey, given what has been answered.
 *
 * A field with no logic is always active. Otherwise `show` means it appears when its rules
 * pass, and `hide` means it disappears when they do.
 */
export function isActive(field: FormField, answers: Answers): boolean {
  const logic = field.conditionalLogic
  if (!logic) return true

  const passes = rulesPass(logic, answers)
  return logic.actionType === 'show' ? passes : !passes
}

/**
 * Every field that currently applies, in definition order.
 *
 * Two gates, not one. A field's own rules decide whether it applies, and so does the page it
 * sits on: both definitions are multi-page wizards, and most of the branching is on the page.
 * The loan form has 47 pages, 29 of them conditional, and the fields behind them frequently
 * carry no rules of their own. The student education questions are plain required selects on a
 * page that appears only when the student flag is set, so without the page gate a customer
 * buying a car is asked which college they attend, and a packet carries answers from branches
 * nobody was on.
 */
export function activeFields(fields: readonly FormField[], answers: Answers): readonly FormField[] {
  const closed = closedPages(fields, answers)
  return fields.filter(
    (field) =>
      isActive(field, answers) && (field.pageNumber === undefined || !closed.has(field.pageNumber)),
  )
}

/**
 * Page numbers whose page break says they do not apply.
 *
 * A page break field carries the page's own conditional logic and a `pageNumber` naming the
 * page it governs, confirmed against the definition: the break gated on "Top up loan" governs
 * the page holding the top-up warning, and the one gated on the student flag governs the page
 * holding the college questions. A page with no break, which is the first one, always applies.
 */
function closedPages(fields: readonly FormField[], answers: Answers): ReadonlySet<number> {
  const closed = new Set<number>()
  for (const field of fields) {
    if (field.type !== 'page') continue
    if (field.pageNumber === undefined) continue
    if (!isActive(field, answers)) closed.add(field.pageNumber)
  }
  return closed
}
