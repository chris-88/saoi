import type { FormField } from './definition.ts'

/**
 * The words a declaration is made in.
 *
 * A checkbox on a published form carries its wording in one of two places. The loan form
 * puts the sentence in the field's label. The SuperSaver form puts a short tag in the label
 * ("DGS", "By tapping...") and the sentence in its single choice. A customer is asked to
 * agree to the sentence, never to the tag, so the longer of the two is the declaration: the
 * label when it is the sentence, the choice's text when the label is a stub or empty.
 */
export function declarationWording(field: Pick<FormField, 'label' | 'choices'>): string {
  const label = field.label.trim()
  const choices = field.choices ?? []
  const choice = choices.length === 1 ? (choices[0]?.text.trim() ?? '') : ''
  return choice.length > label.length ? choice : label
}
