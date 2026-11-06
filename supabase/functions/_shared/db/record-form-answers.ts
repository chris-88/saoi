import type { Db } from './case-repository.ts'
import type { Json } from './database.types.ts'
import type { FormField } from '../domain/forms/definition.ts'
import { resolveFormState, isQuestion } from '../domain/forms/state.ts'
import { formForProduct } from '../tenants/demo/forms/mapping.ts'
import { formSnapshot } from '../tenants/demo/forms/snapshots.ts'
import { isProduct } from '../domain/journey.ts'

/**
 * Answers to the form's own questions, as given in conversation.
 *
 * The counterpart to `recordFacts`, and checked as hard. The model is told what the form wants
 * and in what terms; what it sends back is verified against the published document before any
 * of it is written, because a form answer that the platform would reject, or that silently
 * lands on a field nobody asked about, is worse than no answer at all.
 *
 * Which field an answer is for is settled first, by id and then by label. The digest lists
 * every question with its id in brackets and tells the model to copy it; for two days it
 * listed labels alone, the model guessed ids, and every answer was refused with "no such
 * field". The id is still the key. A label is accepted when exactly one live question carries
 * it, because SuperSaver asks "Are you a US citizen?" once per applicant and a guess between
 * the two would put an answer on the wrong person. A refusal names the ids that would have
 * worked, so the next round can be right rather than another guess.
 *
 * Four refusals after that, in order of how badly they would end:
 *
 *   - a declaration or an upload, which need a tap and a file and can never come from chat
 *   - a field this customer's branch does not reach
 *   - something the form works out for itself
 *   - a value a choice field does not offer
 *
 * Refusals come back to the model as reasons, the way fact refusals do, so a turn where
 * everything bounced is visible rather than looking like a turn where nothing was tried.
 */

/** Enough for the model to find the one it meant; the digest itself shows five. */
const MAX_CANDIDATES = 8

/** Trimmed, case-folded, and without the full stop the digest adds to make a label a sentence. */
function labelKey(label: string): string {
  return label.trim().toLowerCase().replace(/\.$/, '')
}

/** "[id 380]" copied whole from the digest line is still the id. */
function idKey(sent: string): string {
  return sent
    .trim()
    .replace(/^\[?\s*id\s+/i, '')
    .replace(/\]$/, '')
    .trim()
}

const answerable = (field: FormField): boolean =>
  field.type !== 'checkbox' && field.type !== 'fileupload'

const named = (field: FormField): string => `${field.id}: ${field.label.trim()}`

export type FormAnswerWrite = {
  readonly fieldId: string
  readonly value: string | number | boolean
}

export type FormAnswerOutcome = {
  readonly accepted: readonly string[]
  readonly rejected: readonly { readonly fieldId: string; readonly reason: string }[]
}

export async function recordFormAnswers(
  client: Db,
  input: {
    readonly caseId: string
    readonly applicationId: string
    readonly participantId: string | null
    readonly answers: readonly FormAnswerWrite[]
  },
): Promise<FormAnswerOutcome> {
  const accepted: string[] = []
  const rejected: { fieldId: string; reason: string }[] = []

  const application = await client
    .from('applications')
    .select('id, product')
    .eq('id', input.applicationId)
    .eq('case_id', input.caseId)
    .maybeSingle()

  if (application.error) throw new Error(application.error.message)
  if (!application.data) {
    return {
      accepted: [],
      rejected: input.answers.map((answer) => ({
        fieldId: answer.fieldId,
        reason: 'that application is not on this case',
      })),
    }
  }

  const product = application.data.product
  const mapping = isProduct(product) ? formForProduct(product) : null
  const snapshot = mapping ? formSnapshot(mapping.formId) : undefined

  if (!snapshot) {
    return {
      accepted: [],
      rejected: input.answers.map((answer) => ({
        fieldId: answer.fieldId,
        reason: 'that application has no bank form behind it',
      })),
    }
  }

  const row = await client
    .from('form_applications')
    .select('id, answers')
    .eq('case_id', input.caseId)
    .eq('form_id', snapshot.formId)
    .maybeSingle()

  if (row.error) throw new Error(row.error.message)
  if (!row.data) {
    return {
      accepted: [],
      rejected: input.answers.map((answer) => ({
        fieldId: answer.fieldId,
        reason: 'nothing has been collected for that form yet',
      })),
    }
  }

  const current = (row.data.answers ?? {}) as Record<string, unknown>
  const state = resolveFormState(snapshot.definition, current)
  const active = new Set(state.active.map((field) => field.id))
  const byId = new Map(snapshot.definition.fields.map((field) => [field.id, field]))

  /*
   * What a label can resolve to: the live questions, with declarations and documents left in
   * so that naming one earns the refusal that explains it. Structure and derived fields are
   * left out, because nobody answers an html block, and a heading sharing a question's wording
   * would otherwise make the question ambiguous.
   */
  const liveQuestions = state.active.filter((field) => isQuestion(field))
  const byLabel = new Map<string, FormField[]>()
  for (const field of liveQuestions) {
    const key = labelKey(field.label)
    if (key === '') continue
    byLabel.set(key, [...(byLabel.get(key) ?? []), field])
  }

  /*
   * Where to point the model when nothing matched: the questions still open first, because
   * those are the ones it was shown, then the rest of what is live, so a correction to a
   * question already answered can still find its id.
   */
  const open = state.outstanding.filter(answerable)
  const openIds = new Set(open.map((field) => field.id))
  const candidates = [
    ...open,
    ...liveQuestions.filter((field) => answerable(field) && !openIds.has(field.id)),
  ]
    .slice(0, MAX_CANDIDATES)
    .map(named)
    .join(', ')

  const resolve = (
    sent: string,
  ): { ok: true; field: FormField } | { ok: false; reason: string } => {
    const byIdMatch = byId.get(idKey(sent))
    if (byIdMatch) return { ok: true, field: byIdMatch }

    const sharing = byLabel.get(labelKey(sent)) ?? []
    const [only] = sharing
    if (sharing.length === 1 && only) return { ok: true, field: only }
    if (sharing.length > 1) {
      return { ok: false, reason: `ambiguous; use one of: ${sharing.map(named).join(', ')}` }
    }

    return {
      ok: false,
      reason:
        candidates === ''
          ? 'no such field on this form'
          : `no such field on this form; the questions still open are: ${candidates}`,
    }
  }

  const writes: {
    form_application_id: string
    field_id: string
    value: Json
    source: 'customer'
    participant_id: string | null
  }[] = []

  for (const answer of input.answers) {
    const resolved = resolve(answer.fieldId)

    if (!resolved.ok) {
      rejected.push({ fieldId: answer.fieldId, reason: resolved.reason })
      continue
    }

    const field = resolved.field

    /*
     * The two that can never come from a conversation.
     *
     * A declaration is only a declaration if somebody read it and tapped; a model reporting
     * that the customer agreed is not evidence of anything (Invariant 1, §10). An upload needs
     * a file. Both have their own paths and neither of them is this one.
     */
    if (field.type === 'checkbox') {
      rejected.push({
        fieldId: answer.fieldId,
        reason: 'that is a declaration and needs an explicit tap, show it instead',
      })
      continue
    }

    if (field.type === 'fileupload') {
      rejected.push({ fieldId: answer.fieldId, reason: 'that is a document and needs an upload' })
      continue
    }

    if (!active.has(field.id)) {
      rejected.push({ fieldId: answer.fieldId, reason: 'that question does not apply here' })
      continue
    }

    if (!isQuestion(field)) {
      rejected.push({ fieldId: answer.fieldId, reason: 'the form works that one out itself' })
      continue
    }

    const choices = field.choices ?? []
    let value: string | number | boolean = answer.value

    if (choices.length > 0) {
      const wanted = String(answer.value).trim().toLowerCase()
      const match = choices.find(
        (choice) =>
          choice.value.toLowerCase() === wanted || choice.text.trim().toLowerCase() === wanted,
      )

      if (!match) {
        rejected.push({
          fieldId: answer.fieldId,
          reason: `must be one of: ${choices.map((choice) => choice.value).join(', ')}`,
        })
        continue
      }

      // The form's own spelling, because the platform compares values and not labels.
      value = match.value
    }

    writes.push({
      form_application_id: row.data.id,
      field_id: field.id,
      value: value,
      source: 'customer',
      participant_id: input.participantId,
    })
    accepted.push(field.id)
  }

  if (writes.length > 0) {
    const written = await client
      .from('form_answers')
      .upsert(writes, { onConflict: 'form_application_id,field_id' })

    if (written.error) throw new Error(written.error.message)
  }

  return { accepted, rejected }
}
