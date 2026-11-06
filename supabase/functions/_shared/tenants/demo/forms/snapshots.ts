import { formDefinitionSchema, type FormDefinition } from '../../../domain/forms/definition.ts'
import form1833 from './form-1833.json' with { type: 'json' }
import form1940 from './form-1940.json' with { type: 'json' }

/**
 * The form definitions Saoirse has taken a copy of, and where each came from.
 *
 * A snapshot rather than a live fetch: a demonstration must not depend on another
 * organisation's website answering at the moment somebody is filming, and re-pulling 691KB
 * from their infrastructure on every turn to serve our own is impolite when the definition
 * changes rarely.
 *
 * The provenance travels with it. The console shows the source URL, when it was retrieved, the
 * form's own version string and a hash of the bytes, which is what lets somebody in the room
 * satisfy themselves this is the bank's document and not ours.
 */

export type FormSnapshot = {
  readonly formId: string
  readonly source: string
  readonly retrievedAt: string
  readonly version: string
  readonly sourceHash: string
  readonly definition: FormDefinition
  /** Where the genuine journey is completed. Submitted as `page_location`. */
  readonly pageLocation: string
}

type RawSnapshot = {
  formId: string
  source: string
  retrievedAt: string
  version: string
  sourceHash: string
  definition: unknown
}

const PAGE_LOCATIONS: Readonly<Record<string, string>> = {
  '1833': 'https://forms.demo-bank.example/personal-banking/supersaver/',
  '1940': 'https://forms.demo-bank.example/consumer-lending/personal-loan',
}

const RAW: readonly RawSnapshot[] = [form1833, form1940]

/**
 * Parsed on first use, not on import.
 *
 * These are 707KB and 434KB of JSON, and validating both through Zod costs about 150ms. That
 * was being paid at module load, which on a serverless runtime means every cold start of every
 * function that touches this file, including a turn of conversation that has nothing to do with
 * forms. Now a definition is parsed the first time somebody asks for it and kept for the life
 * of the isolate, so the ordinary turn pays nothing and a form turn pays for one form.
 */
const parsed = new Map<string, FormSnapshot>()

function parse(raw: RawSnapshot): FormSnapshot {
  return {
    formId: raw.formId,
    source: raw.source,
    retrievedAt: raw.retrievedAt,
    version: raw.version,
    sourceHash: raw.sourceHash,
    definition: formDefinitionSchema.parse(raw.definition),
    pageLocation: PAGE_LOCATIONS[raw.formId] ?? '',
  }
}

export function formSnapshot(formId: string): FormSnapshot | undefined {
  const already = parsed.get(formId)
  if (already) return already

  const raw = RAW.find((candidate) => candidate.formId === formId)
  if (!raw) return undefined

  const snapshot = parse(raw)
  parsed.set(formId, snapshot)
  return snapshot
}

/** Every form, which does parse all of them. Only the console asks for this. */
export function allFormSnapshots(): readonly FormSnapshot[] {
  return RAW.map((raw) => formSnapshot(raw.formId)).filter(
    (snapshot): snapshot is FormSnapshot => snapshot !== undefined,
  )
}
