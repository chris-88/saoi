import { journeyFor } from '@shared/domain/journeys/index.ts'
import { recomputeApplications } from '@shared/db/applications.ts'
import { knowledgeProduct } from '@shared/tenants/demo/kb-prompt.ts'
import { loadCase, recordFacts, writeEvent } from '@shared/db/case-repository.ts'
import { participantFor } from '@shared/db/loaded-case.ts'
import type { ToolModule } from './_shared.ts'

export const recordFactsTool: ToolModule<'record_facts'> = {
  name: 'record_facts',
  async run(input, ctx) {
    const { admin, turn, loaded, primary, kb, rejections } = ctx

    const { facts } = input
    const outcome = await recordFacts(admin, {
      caseId: turn.caseId,
      facts,
      participants: { primary, partner: participantFor(loaded, 'partner') },
      source: 'customer_stated',
    })

    for (const key of outcome.accepted) {
      await writeEvent(admin, {
        caseId: turn.caseId,
        type: 'context_captured',
        actor: 'model',
        payload: { key },
      })
    }

    const rejected = outcome.rejected.map((item) => `${item.key}: ${item.reason}`).join('; ')

    /*
     * A fact offered and refused, recorded as such.
     *
     * `recordFacts` returns its refusals rather than throwing, so nothing upstream
     * ever saw them: a turn where every single fact bounced looked, from the
     * outside, exactly like a turn where the model never tried. Which is what sent
     * the first investigation of this after the wrong cause.
     */
    if (outcome.rejected.length > 0) {
      rejections.push({
        name: 'record_facts',
        error: rejected.slice(0, 300),
      })
    }

    // A fact can complete an application. What is outstanding is recomputed here,
    // not remembered by the model (Invariant 3).
    let progressed = ''
    if (outcome.accepted.length > 0) {
      const reloaded = await loadCase(admin, turn.caseId)
      if (reloaded) {
        const summaries = await recomputeApplications(admin, reloaded, {
          nameFor: (product, catalogueId) =>
            (catalogueId === null ? undefined : knowledgeProduct(catalogueId, kb.products)?.name) ??
            journeyFor(product).displayName,
        })
        const ready = summaries.filter((a) => a.state === 'ready')
        if (ready.length > 0) {
          progressed = ` Ready to review: ${ready.map((a) => a.displayName).join(', ')}.`
        }
      }
    }

    return {
      result:
        `Recorded ${outcome.accepted.length}.` +
        (rejected ? ` Not recorded — ${rejected}` : '') +
        progressed,
    }
  },
}
