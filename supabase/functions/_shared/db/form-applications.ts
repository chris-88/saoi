import type { Db } from './case-repository.ts'
import type { Json } from './database.types.ts'
import { isFactKey, type FactKey } from '../domain/facts.ts'
import { isProduct } from '../domain/journey.ts'
import { formForProduct, type FormMapping } from '../tenants/demo/forms/mapping.ts'
import { formSnapshot } from '../tenants/demo/forms/snapshots.ts'
import { fillFromFacts } from '../tenants/demo/forms/prefill.ts'

/**
 * Keeps the digital form applications in step with the conversation.
 *
 * The console's forms tab reads `form_applications`, and for a while nothing wrote them: every
 * fact Saoirse collected went into `facts`, the mapping existed, the packet builder existed, and
 * the tab was still empty because no code ever joined the two. A conversation that had given
 * its name, date of birth, address, PPS number and monthly saving showed as nothing collected.
 *
 * Called at the end of a turn and after an application is created, so the row exists from the
 * moment a product is being applied for and tracks what has been collected since. Nothing here
 * submits anything: the packet is built for inspection, on demand, from these answers.
 */

export type SyncOutcome = {
  /** Form ids written, for the event payload. */
  readonly forms: readonly string[]
  readonly answered: number
  readonly reused: number
}

type FactRow = {
  key: string
  value: unknown
  source: string
  captured_for: string | null
}

/**
 * A fact Saoirse already held, as opposed to one asked for while filling this form in.
 *
 * `captured_for` is the application a fact was collected against. Anything collected for a
 * different application, or that came from the bank's own record rather than from asking, is
 * a question this form did not have to put to the customer, which is the whole claim (§53).
 *
 * A fact with no application attached counts too, and it is the strongest case of the lot: it
 * was given in open conversation before this form was ever started, so the form inherited it
 * rather than asking. Only a fact collected against this very application was asked for here.
 */
function heldAlready(fact: FactRow, applicationId: string): boolean {
  if (fact.source === 'bank_held' || fact.source === 'system_derived') return true
  return fact.captured_for !== applicationId
}

export async function syncFormApplications(client: Db, caseId: string): Promise<SyncOutcome> {
  const applications = await client.from('applications').select('id, product').eq('case_id', caseId)
  if (applications.error) throw new Error(applications.error.message)

  const withForms: { readonly id: string; readonly mapping: FormMapping }[] = []
  for (const row of applications.data ?? []) {
    // A product the catalogue has outgrown, or one with no published form yet. Neither is an
    // error: most of the catalogue has no definition to map onto.
    if (!isProduct(row.product)) continue
    const mapping = formForProduct(row.product)
    if (!mapping) continue
    withForms.push({ id: row.id, mapping })
  }

  if (withForms.length === 0) return { forms: [], answered: 0, reused: 0 }

  /*
   * Live facts only. A superseded fact is a previous answer, and a form filled from one would
   * show a value the customer has already corrected.
   */
  const facts = await client
    .from('facts')
    .select('key, value, source, captured_for')
    .eq('case_id', caseId)
    .is('superseded_by', null)
    .order('captured_at', { ascending: true })

  if (facts.error) throw new Error(facts.error.message)

  // Last one captured wins, which is how two live rows for the same key resolve.
  const latest = new Map<FactKey, FactRow>()
  for (const row of (facts.data ?? []) as FactRow[]) {
    if (!isFactKey(row.key)) continue
    latest.set(row.key, row)
  }

  const forms: string[] = []
  let answered = 0
  let reusedCount = 0

  for (const application of withForms) {
    const snapshot = formSnapshot(application.mapping.formId)
    // A mapping whose definition has not been snapshotted. Nothing to collect against.
    if (!snapshot) continue

    /*
     * What has already been given to this form, which the facts do not cover.
     *
     * "Do you use online banking?" is not a fact about a person worth carrying between products,
     * and neither is a declaration whose wording belongs to one lending application. Those are
     * collected against the form and have to survive a sync, or every turn of the conversation
     * would quietly undo the last one's answers.
     */
    const existing = await client
      .from('form_applications')
      .select('id')
      .eq('case_id', caseId)
      .eq('form_id', snapshot.formId)
      .maybeSingle()

    if (existing.error) throw new Error(existing.error.message)

    const collected: Record<string, unknown> = {}
    if (existing.data) {
      const given = await client
        .from('form_answers')
        .select('field_id, value')
        .eq('form_application_id', existing.data.id)

      if (given.error) throw new Error(given.error.message)
      for (const row of given.data ?? []) collected[row.field_id] = row.value
    }

    const resolved = fillFromFacts({
      definition: snapshot.definition,
      prefill: application.mapping.prefill,
      held: (key) => latest.get(key)?.value,
      reused: (key) => {
        const fact = latest.get(key)
        return fact ? heldAlready(fact, application.id) : false
      },
      answers: collected,
    })

    /*
     * Upsert on the case and form, because this runs every turn and must be idempotent: a
     * conversation that mentions nothing new rewrites the same row rather than adding another.
     */
    const written = await client.from('form_applications').upsert(
      {
        case_id: caseId,
        form_id: snapshot.formId,
        form_version: snapshot.version,
        source_hash: snapshot.sourceHash,
        /*
         * Facts last, so a correction in conversation reaches the form.
         *
         * The two rarely collide: a field with a fact behind it is not one the customer is
         * asked for directly. Where they do, the fact is the one that gets corrected when
         * somebody says "actually, it is four thousand", and a form answer frozen at the old
         * value would be the thing that reached the bank.
         */
        answers: { ...collected, ...resolved.answers } as unknown as Json,
        reused_fields: [...resolved.reused],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'case_id,form_id' },
    )

    if (written.error) throw new Error(written.error.message)

    forms.push(snapshot.formId)
    answered += Object.keys({ ...collected, ...resolved.answers }).length
    reusedCount += resolved.reused.length
  }

  return { forms, answered, reused: reusedCount }
}
