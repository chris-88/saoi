import type { FormDefinition, FormField } from './definition.ts'
import { type Answers } from './logic.ts'
import { resolveFormState } from './state.ts'
import type { NdiOutcome } from './ndi.ts'

/**
 * The packet the existing web journey would POST, built from the same definition it renders.
 *
 * This is the artefact the whole feature exists to produce. Not a summary of the application
 * and not an approximation of it: the ordered entries a browser's `FormData` would carry to
 * `POST /api/forms/<id>`, so that the definition, the answers and the wire format can be put
 * side by side and read against each other.
 *
 * An ordered array rather than an object, because `FormData` permits repeated keys and the
 * real SuperSaver packet uses them: `input_1189[]` appears twice, once for the number and once
 * for the country. A JSON object would silently lose one of them.
 */

/** Where a value came from, so the console can show the difference. */
export const ENTRY_SOURCES = [
  'answer',
  'reused',
  'default',
  'consent',
  /** Worked out by the form from its own formula, never asked and never from the model. */
  'derived',
  'runtime',
] as const
export type EntrySource = (typeof ENTRY_SOURCES)[number]

export type SubmissionEntry = {
  readonly key: string
  readonly value: string
  readonly source: EntrySource
  /** The definition field this came from, where one exists. */
  readonly fieldId: string | null
  readonly label: string
  /** The platform's own downstream mapping, carried through untouched. */
  readonly toscana: string | null
  /** Masked in the console by default. */
  readonly sensitive: boolean
}

/** Structure rather than questions: nothing here is ever asked or submitted. */
const STRUCTURAL = new Set(['html', 'section', 'page', 'accordion', 'form_module'])

/** Types whose values should not be shown in full in an inspector. */
const SENSITIVE = new Set([
  'demo_ppsn',
  'account_number',
  'sort_code_v2',
  'iban',
  'demo_phone',
  'demo_email_auth_field',
  'demo_otp_auth_field',
  'email',
  'date',
])

const text = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : ''

/**
 * A file attached to one of the form's upload controls.
 *
 * A reference, never bytes. What is recorded is enough to show which file answered which
 * control, and nothing that could pass for the real upload service's receipt.
 */
export type FormUpload = {
  readonly fileName: string
  readonly storagePath: string
  readonly sizeBytes?: number
  readonly mimeType?: string
}

function asUpload(value: unknown): FormUpload | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as {
    fileName?: unknown
    storagePath?: unknown
    sizeBytes?: unknown
    mimeType?: unknown
  }
  if (typeof candidate.fileName !== 'string' || typeof candidate.storagePath !== 'string') {
    return null
  }
  return {
    fileName: candidate.fileName,
    storagePath: candidate.storagePath,
    ...(typeof candidate.sizeBytes === 'number' ? { sizeBytes: candidate.sizeBytes } : {}),
    ...(typeof candidate.mimeType === 'string' ? { mimeType: candidate.mimeType } : {}),
  }
}

/** `{ years, months }`, as the prefill tables produce for a duration control. */
function isDuration(value: unknown): value is { years: number; months: number } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { years?: unknown; months?: unknown }
  return typeof candidate.years === 'number' && typeof candidate.months === 'number'
}

function toscanaOf(field: FormField): string | null {
  return typeof field.toscana === 'string' && field.toscana.length > 0 ? field.toscana : null
}

/**
 * How one field becomes wire entries.
 *
 * Three shapes exist in the real packet and all three are observed rather than invented: a
 * plain `input_<id>`, a dotted `input_<id>.<n>` for a checkbox's sub-input, and a repeated
 * `input_<id>[]` for compound fields that carry more than one value.
 */
function entriesFor(
  field: FormField,
  answer: unknown,
  source: EntrySource,
): readonly SubmissionEntry[] {
  const base = {
    fieldId: field.id,
    label: field.label,
    toscana: toscanaOf(field),
    sensitive: SENSITIVE.has(field.type),
  }

  // A checkbox submits under its sub-input ids, carrying the choice text as the value.
  if (field.type === 'checkbox' && field.inputs && field.inputs.length > 0) {
    const chosen = Array.isArray(answer) ? (answer as readonly unknown[]).map(text) : [text(answer)]
    return field.inputs
      .map((input, index) => ({ input, value: chosen[index] ?? '' }))
      .filter((pair) => pair.value.length > 0)
      .map((pair) => ({ ...base, key: `input_${pair.input.id}`, value: pair.value, source }))
  }

  /*
   * A duration is one meaning and three entries.
   *
   * Time at an address and time in a role are each a control with sub-inputs `443.1`, `443.2`
   * and `443.3`: years, months, and the total in months. Saoirse holds `{ years, months }`, which
   * is what a person says, and the third is arithmetic rather than a question. Expanded here
   * because the shape a form wants on the wire is the form's business, not the conversation's.
   */
  if (isDuration(answer) && field.inputs && field.inputs.length >= 3) {
    const parts = [
      String(answer.years),
      String(answer.months),
      String(answer.years * 12 + answer.months),
    ]
    return field.inputs.slice(0, 3).map((input, index) => ({
      ...base,
      key: `input_${input.id}`,
      value: parts[index] ?? '',
      source,
    }))
  }

  // Compound fields repeat the key. The phone field carries the number and then the country.
  if (Array.isArray(answer)) {
    return (answer as readonly unknown[]).map((item) => ({
      ...base,
      key: `input_${field.id}[]`,
      value: text(item),
      source,
    }))
  }

  return [{ ...base, key: `input_${field.id}`, value: text(answer), source }]
}

/**
 * The two entries a quote control sends, or the one an eligibility control sends.
 *
 * The browser serialises the parameters object by appending it to `FormData`, which turns it
 * into the string "[object Object]": that is literally what the captured submission carries,
 * and the platform evidently recomputes from the rest rather than reading it. A packet built
 * for inspection carries the JSON instead, because an entry reading "[object Object]" is
 * indistinguishable from a bug and tells a reader nothing. Noted in `docs/decisions.md`.
 */
function ndiEntries(field: FormField, outcome: NdiOutcome): readonly SubmissionEntry[] {
  const base = {
    fieldId: field.id,
    label: field.label,
    toscana: toscanaOf(field),
    sensitive: false,
    source: 'derived' as const,
  }

  if (field.type === 'ndi_eligibility') {
    return [{ ...base, key: `input_${field.id}`, value: text(outcome.result) }]
  }

  return [
    { ...base, key: `input_${field.id}.parameters`, value: JSON.stringify(outcome.parameters) },
    {
      ...base,
      key: `input_${field.id}.result`,
      value: outcome.result === null ? '' : JSON.stringify({ monthlyRepayment: outcome.result }),
    },
  ]
}

export type BuildInput = {
  readonly definition: FormDefinition
  readonly answers: Answers
  /** Which answers Saoirse already held rather than asked for, for the questions-avoided story. */
  readonly reused?: ReadonlySet<string>
  /**
   * Issued by the GET and never stored.
   *
   * Absent here on purpose when none is to hand: the console shows the slot and says it is
   * empty, which is more honest than a plausible-looking string in a packet nobody will send.
   */
  readonly nonce?: string | undefined
  readonly pageLocation: string
  /**
   * What the form's calculating controls produced, from `resolveNdi`.
   *
   * Passed in rather than computed here because working them out needs a published interest
   * rate, which is tenant knowledge and has no business in this file. Omitted entirely for a
   * form that has none, which is SuperSaver.
   */
  readonly ndi?: readonly NdiOutcome[] | undefined
}

export type GeneratedSubmission = {
  /** Where the genuine journey would send this. Recorded as metadata, never called. */
  readonly target: string
  readonly method: 'POST'
  readonly encoding: 'multipart/form-data'
  readonly formId: string
  readonly formVersion: string
  readonly entries: readonly SubmissionEntry[]
  readonly generatedAt: string
}

/**
 * Build the packet.
 *
 * Fields are walked in definition order, which is the order the browser appends them, and
 * inactive branches are skipped: a question that does not apply to this customer contributes
 * nothing, however required it is marked.
 */
export function buildSubmission(input: BuildInput): GeneratedSubmission {
  const { definition, answers } = input
  const entries: SubmissionEntry[] = []

  /*
   * The settled state, not the raw answers.
   *
   * Three things come out of settling that a field-by-field walk gets wrong. Most of the
   * branching is on the page rather than the field, so whole sections were reported active that
   * the customer never saw. The form's own defaults decide which questions exist at all. And
   * the calculated fields have to be worked out, because the packet carries them: a loan
   * submits a total nobody typed.
   */
  const state = resolveFormState(definition, answers)
  const active = new Set(state.active.map((field) => field.id))

  const ndi = new Map((input.ndi ?? []).map((outcome) => [outcome.fieldId, outcome]))
  const uploads: { fieldId: string; upload: FormUpload }[] = []

  for (const field of definition.fields) {
    if (STRUCTURAL.has(field.type)) continue
    if (!active.has(field.id)) continue

    /*
     * A calculating control submits what it worked out, in the control's own shape.
     *
     * The quote calculators send two entries, `input_238.parameters` and `input_238.result`,
     * which is how the captured submission carries them. The eligibility control sends one.
     * Both are marked derived: nobody was asked, and in the eligibility case the value is a
     * declared stand-in rather than a computed one.
     */
    const calculated = ndi.get(field.id)
    if (calculated) {
      entries.push(...ndiEntries(field, calculated))
      continue
    }

    /*
     * An upload control sends no value of its own.
     *
     * The captured submission carries nothing for `input_151` and instead carries a manifest,
     * `gform_uploaded_files`, appended at the very end. The file bytes went somewhere else
     * entirely, before the form was submitted, which is why this is a two-stage thing.
     */
    if (field.type === 'fileupload') {
      const attached = asUpload(state.values[field.id])
      if (attached) uploads.push({ fieldId: field.id, upload: attached })
      continue
    }

    /*
     * A preview control reports the state of the file beside it.
     *
     * `fileFields: ["input_151"]` is the control saying which upload it is showing, so it says
     * "previewing" exactly when that upload has something to preview, which is what the real
     * submission carries.
     */
    if (field.type === 'file_preview') {
      const watching = (field.platform?.['fileFields'] ?? []) as unknown
      const watched = Array.isArray(watching)
        ? (watching as unknown[]).map((entry) => String(entry).replace(/^input_/, ''))
        : []

      const ready = watched.some((id) => asUpload(state.values[id]) !== null)
      if (!ready) continue

      entries.push({
        key: `input_${field.id}`,
        value: 'previewing',
        source: 'derived',
        fieldId: field.id,
        label: field.label,
        toscana: toscanaOf(field),
        sensitive: false,
      })
      continue
    }

    const derived = Object.prototype.hasOwnProperty.call(state.derived, field.id)
    const answered = Object.prototype.hasOwnProperty.call(state.values, field.id)
    if (!answered) continue

    const stated = Object.prototype.hasOwnProperty.call(answers, field.id)
    const source: EntrySource = derived
      ? 'derived'
      : !stated
        ? 'default'
        : input.reused?.has(field.id) === true
          ? 'reused'
          : field.type === 'checkbox'
            ? 'consent'
            : 'answer'

    entries.push(...entriesFor(field, state.values[field.id], source))
  }

  /*
   * The upload manifest, appended before the runtime values as the capture shows.
   *
   * Two fields of each entry are deliberately absent. The genuine journey uploads to a service
   * that issues `x-file-hash` and `x-signed-file-hash`, and those are the one thing in this
   * feature that must never be invented: a fabricated signature is a forged credential,
   * however synthetic the file it describes. The console shows the gap and names what fills it.
   */
  if (uploads.length > 0) {
    const manifest: Record<string, unknown[]> = {}
    for (const { fieldId, upload } of uploads) {
      manifest[`input_${fieldId}`] = [
        {
          temp_filename: upload.storagePath,
          uploaded_filename: upload.fileName,
          size_bytes: upload.sizeBytes,
          content_type: upload.mimeType,
          'x-file-hash': null,
          'x-signed-file-hash': null,
        },
      ]
    }

    entries.push({
      key: 'gform_uploaded_files',
      value: JSON.stringify(manifest),
      source: 'derived',
      fieldId: null,
      label: 'Uploaded files',
      toscana: null,
      sensitive: false,
    })
  }

  /*
   * The two runtime values, appended last exactly as the browser appends them.
   *
   * The nonce is whatever the live GET returned. It is never hard-coded and never stored with
   * the snapshot: a stored one is stale, and the only thing a stale one could do is make this
   * packet look like something that could be sent.
   */
  entries.push({
    key: `demo_nonce_form_field_${definition.id}`,
    value: input.nonce ?? '',
    source: 'runtime',
    fieldId: null,
    label: 'Form nonce',
    toscana: null,
    sensitive: true,
  })
  entries.push({
    key: 'page_location',
    value: input.pageLocation,
    source: 'runtime',
    fieldId: null,
    label: 'Page location',
    toscana: null,
    sensitive: false,
  })

  return {
    target: `https://forms.demo-bank.example/api/forms/${definition.id}`,
    method: 'POST',
    encoding: 'multipart/form-data',
    formId: definition.id,
    formVersion: definition.title,
    entries,
    generatedAt: new Date().toISOString(),
  }
}
