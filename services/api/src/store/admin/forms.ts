import { syncFormApplications } from '@shared/db/form-applications.ts'
import { buildSubmission, type GeneratedSubmission } from '@shared/domain/forms/submission.ts'
import { limitWarnings, resolveNdi, type NdiOutcome } from '@shared/domain/forms/ndi.ts'
import { resolveFormState } from '@shared/domain/forms/state.ts'
import { loanAnnualRate } from '@shared/tenants/demo/forms/rates.ts'
import { formSnapshot } from '@shared/tenants/demo/forms/snapshots.ts'
import { ApiError } from '../../errors.ts'
import type { Db } from '../client.ts'

export type FormApplicationSummary = {
  readonly id: string
  readonly caseId: string
  readonly formId: string
  readonly formVersion: string
  /** Whose application it is: the name on the form, or the participant's own. */
  readonly who: string | null
  readonly answered: number
  readonly reused: number
  readonly updatedAt: string
}

export type RebuildOutcome = {
  readonly cases: number
  readonly forms: number
  readonly answered: number
  readonly failed: number
}

type Writable<T> = T extends readonly (infer U)[]
  ? Writable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Writable<T[K]> }
    : T

export type FormInspection = Writable<{
  readonly id: string
  readonly caseId: string
  readonly updatedAt: string
  readonly definition: {
    readonly formId: string
    readonly version: string
    readonly source: string
    readonly retrievedAt: string
    readonly sourceHash: string
    readonly fieldCount: number
    readonly activeCount: number
    readonly questionCount: number
    readonly requiredCount: number
  }
  readonly collected: readonly {
    readonly fieldId: string
    readonly label: string
    readonly type: string
    readonly toscana: string | null
    readonly value: unknown
    readonly reused: boolean
    readonly givenDirectly: string | null
  }[]
  readonly outstanding: readonly {
    readonly fieldId: string
    readonly label: string
    readonly type: string
  }[]
  readonly calculations: readonly Pick<
    NdiOutcome,
    'fieldId' | 'control' | 'label' | 'fidelity' | 'note' | 'parameters' | 'result'
  >[]
  readonly rateBasis: string | null
  readonly limits: readonly {
    readonly label: string
    readonly comparedField: string
    readonly operator: string
    readonly limit: string
    readonly actual: number
  }[]
  readonly consents: readonly {
    readonly fieldId: string
    readonly wording: string
    readonly agreedAt: string
  }[]
  readonly documents: readonly {
    readonly fieldId: string
    readonly fileName: string
    readonly sizeBytes: number | null
    readonly attachedAt: string
    readonly signatures: string
  }[]
  readonly submission: GeneratedSubmission & {
    readonly status: 'GENERATED_NOT_SENT'
    readonly externalRequestMade: false
  }
}>

/** The bank-form applications the console lists, rebuilds and inspects. */
export interface AdminFormsStore {
  /** Was `rebuild_form_applications`. */
  rebuild(): Promise<RebuildOutcome>
  /** Was `list_form_applications`: the sixty most recent. */
  list(): Promise<FormApplicationSummary[]>
  /** Was `inspect_form_application`. Throws `not_found`. */
  inspect(formApplicationId: string): Promise<FormInspection>
}

type ApplicationRow = {
  id: string
  case_id: string
  form_id: string
  form_version: string
  source_hash?: string
  answers: unknown
  reused_fields: unknown
  updated_at: string
}

type AnswerRow = {
  field_id: string
  source: string
  wording: string | null
  answered_at: string
}

const STRUCTURAL = ['html', 'section', 'page', 'accordion', 'form_module']

export function supabaseAdminFormsStore(db: Db): AdminFormsStore {
  return {
    /*
     * Rebuilds the form applications from what each case holds. The write path keeps these in
     * step from here on; this is the button to press after editing the mapping table.
     */
    async rebuild() {
      const cases = await db.from('cases').select('id').limit(500)
      if (cases.error) throw new Error(`Failed to load cases: ${cases.error.message}`)

      let built = 0
      let answered = 0
      let failed = 0

      for (const row of cases.data ?? []) {
        try {
          const synced = await syncFormApplications(db, row.id)
          if (synced.forms.length > 0) {
            built += synced.forms.length
            answered += synced.answered
          }
        } catch {
          // One bad case must not stop the rebuild; the console reports how many.
          failed += 1
        }
      }

      return { cases: (cases.data ?? []).length, forms: built, answered, failed }
    },

    async list() {
      const rows = await db
        .from('form_applications')
        .select('id, case_id, form_id, form_version, answers, reused_fields, updated_at')
        .order('updated_at', { ascending: false })
        .limit(60)
      if (rows.error) throw new Error(`Failed to load form applications: ${rows.error.message}`)

      const listed = rows.data as unknown as ApplicationRow[]
      const caseIds = [...new Set(listed.map((row) => row.case_id))]

      // The name on the form is the right label, with the participant's own as the fallback.
      const names = new Map<string, string>()
      if (caseIds.length > 0) {
        const people = await db
          .from('participants')
          .select('case_id, display_name, role')
          .in('case_id', caseIds)
          .eq('role', 'primary')
        for (const person of people.data ?? []) {
          if (person.display_name) names.set(person.case_id, person.display_name)
        }

        const stated = await db
          .from('facts')
          .select('case_id, value')
          .in('case_id', caseIds)
          .eq('key', 'identity.fullName')
          .is('superseded_by', null)
        for (const fact of stated.data ?? []) {
          if (typeof fact.value === 'string' && fact.value.trim() !== '') {
            names.set(fact.case_id, fact.value)
          }
        }
      }

      return listed.map((row) => ({
        id: row.id,
        caseId: row.case_id,
        formId: row.form_id,
        formVersion: row.form_version,
        who: names.get(row.case_id) ?? null,
        // Enough to show progress in a list without building every packet.
        answered: Object.keys((row.answers ?? {}) as Record<string, unknown>).length,
        reused: ((row.reused_fields ?? []) as string[]).length,
        updatedAt: row.updated_at,
      }))
    },

    async inspect(formApplicationId) {
      const row = await db
        .from('form_applications')
        .select(
          'id, case_id, form_id, form_version, source_hash, answers, reused_fields, updated_at',
        )
        .eq('id', formApplicationId)
        .maybeSingle()
      if (row.error) throw new Error(`Failed to load the form application: ${row.error.message}`)
      if (!row.data) throw new ApiError('not_found', 'No such form application.')

      const record = row.data as unknown as ApplicationRow
      const snapshot = formSnapshot(String(record.form_id))
      if (!snapshot) throw new ApiError('not_found', 'No definition snapshot for that form.')

      const answers = (record.answers ?? {}) as Record<string, unknown>
      const reused = new Set((record.reused_fields ?? []) as string[])

      // Recomputed rather than stored, so an unfinished application shows what it maps to now.
      const state = resolveFormState(snapshot.definition, answers)
      const active = state.active
      const activeIds = new Set(active.map((field) => field.id))

      // The published rate for the term on the form, which is what a quote is computed at.
      const rate = loanAnnualRate(Number(state.values['234'] ?? 0))

      const ndi = resolveNdi({
        definition: snapshot.definition,
        values: state.values,
        active: activeIds,
        annualRate: rate?.rate ?? null,
        eligibilityFixture: 'eligible',
      })
      const limits = limitWarnings({
        definition: snapshot.definition,
        values: state.values,
        active: activeIds,
      })
      const packet = buildSubmission({
        definition: snapshot.definition,
        answers,
        reused,
        pageLocation: snapshot.pageLocation,
        ndi,
      })

      // How each answer got here, which is what makes the consent record evidence.
      const given = await db
        .from('form_answers')
        .select('field_id, source, wording, answered_at')
        .eq('form_application_id', record.id)
      if (given.error) throw new Error(`Failed to load form answers: ${given.error.message}`)
      const entries = (given.data ?? []) as AnswerRow[]
      const provenance = new Map(entries.map((entry) => [entry.field_id, entry]))

      const questions = active.filter((field) => !STRUCTURAL.includes(field.type))
      const has = (id: string) => Object.prototype.hasOwnProperty.call(answers, id)

      return {
        id: record.id,
        caseId: record.case_id,
        updatedAt: record.updated_at,
        definition: {
          formId: snapshot.formId,
          version: snapshot.version,
          source: snapshot.source,
          retrievedAt: snapshot.retrievedAt,
          sourceHash: snapshot.sourceHash,
          fieldCount: snapshot.definition.fields.length,
          activeCount: active.length,
          questionCount: questions.length,
          requiredCount: questions.filter((field) => field.isRequired).length,
        },
        collected: questions
          .filter((field) => has(field.id))
          .map((field) => ({
            fieldId: field.id,
            label: field.label,
            type: field.type,
            toscana: typeof field.toscana === 'string' ? field.toscana : null,
            value: answers[field.id],
            reused: reused.has(field.id),
            /** `customer`, `consent` or `document` where it was given to the form directly. */
            givenDirectly: provenance.get(field.id)?.source ?? null,
          })),
        outstanding: questions
          .filter((field) => field.isRequired && !has(field.id))
          .map((field) => ({ fieldId: field.id, label: field.label, type: field.type })),
        // A repayment is computed from the control's declared inputs; an eligibility verdict
        // is a stand-in. The fidelity says which.
        calculations: ndi.map((outcome) => ({
          fieldId: outcome.fieldId,
          control: outcome.control,
          label: outcome.label,
          fidelity: outcome.fidelity,
          note: outcome.note,
          parameters: outcome.parameters,
          result: outcome.result,
        })),
        rateBasis: rate?.basis ?? null,
        limits: limits.map((warning) => ({
          label: warning.label,
          comparedField: warning.comparedField,
          operator: warning.operator,
          limit: warning.limit,
          actual: warning.actual,
        })),
        consents: entries
          .filter((entry) => entry.source === 'consent')
          .map((entry) => ({
            fieldId: entry.field_id,
            wording: entry.wording ?? '',
            agreedAt: entry.answered_at,
          })),
        documents: entries
          .filter((entry) => entry.source === 'document')
          .map((entry) => {
            const value = (answers[entry.field_id] ?? {}) as Record<string, unknown>
            return {
              fieldId: entry.field_id,
              fileName: (value['fileName'] ?? '') as string,
              sizeBytes: (value['sizeBytes'] ?? null) as number | null,
              attachedAt: entry.answered_at,
              signatures: 'not generated: the production upload service issues these',
            }
          }),
        // The exact packet, and the fact that it goes nowhere.
        submission: {
          ...packet,
          entries: packet.entries.map((entry) => ({ ...entry })),
          status: 'GENERATED_NOT_SENT',
          externalRequestMade: false,
        },
      }
    },
  }
}
