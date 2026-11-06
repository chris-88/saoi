import type { Card } from '@shared/contracts/cards.ts'
import { arrange } from '@shared/domain/savings/arrange.ts'
import { formatRate, situationFrom } from '@shared/domain/savings/situation.ts'
import { caseFactReader } from '@shared/db/fact-reader.ts'
import { loadCase } from '@shared/db/case-repository.ts'
import type { ToolModule } from './_shared.ts'

/**
 * Longer than the options window: the split does not change between turns unless a fact does,
 * and the engine recomputes it from the case either way, so a fresh copy says nothing new.
 */
const ARRANGEMENT_CARD_WINDOW = 6

export const showArrangementTool: ToolModule<'show_arrangement'> = {
  name: 'show_arrangement',
  async run(_input, ctx) {
    const { admin, turn, loaded, savingsOptions } = ctx

    /*
     * One arrangement card, not one per turn. Asked "show me the rest first" and
     * then given a name and address, the model drew the same split four times in a
     * row on one live case, each copy waiting for the same tap. The one on screen
     * still works until something is started from it, and the digest already says
     * it is waiting.
     */
    const lastArrangement = [...loaded.messages]
      .slice(-ARRANGEMENT_CARD_WINDOW)
      .reverse()
      .find((message) => message.cards.includes('arrangement'))
    const startedSince = loaded.applications.some(
      (application) => application.product === 'savings',
    )
    // A fact recorded since the card went up can change the split: on a live case
    // the customer said they wanted the bonus, the mortgage question got answered,
    // and the card still on screen was the one without MortgageSaver.
    const factsSince =
      lastArrangement !== undefined &&
      loaded.facts.some((fact) => fact.capturedAt > lastArrangement.createdAt)
    if (lastArrangement !== undefined && !startedSince && !factsSince) {
      return {
        result:
          'The arrangement card is already on screen from an earlier turn and still works. ' +
          'Point at it in your own words, or answer what they asked; do not draw another.',
      }
    }

    /*
     * From the case as it is now, not as it was when the turn began.
     *
     * The arrangement is worked out once at the start of the turn, and a fact the
     * model records in the same turn is not in it. On a live case the customer
     * said the mortgage was coming here, the model recorded it and called this in
     * the same breath, Saoirse described a three-account split, and the card showed
     * two. `record_facts` reloads for the same reason.
     */
    const current = await loadCase(admin, turn.caseId)
    const reader = current === null ? null : caseFactReader(current)
    const arrangement =
      reader === null
        ? null
        : arrange(situationFrom(reader, new Date().toISOString().slice(0, 10)), savingsOptions)

    if (arrangement !== null && arrangement.needs.length > 0) {
      return {
        result:
          'Not yet. Before this can be arranged, ask: ' +
          arrangement.needs.map((need) => need.why).join(' ') +
          ' One question, then show it next turn.',
        refused: true,
      }
    }

    if (arrangement === null) {
      return {
        result:
          'There is nothing to arrange yet. Either what they have saved and what ' +
          'they can put away each month are not held, or only one account fits. ' +
          'Ask for the figures if they are missing; otherwise offer products one ' +
          'at a time.',
        refused: true,
      }
    }

    const card: Card = {
      type: 'arrangement',
      title: 'How your money would be arranged',
      allocations: arrangement.allocations.map((allocation) => ({
        product: 'savings',
        catalogueId: allocation.productId,
        name: allocation.name,
        amount: allocation.amount,
        cadence: allocation.cadence,
        termMonths: allocation.termMonths,
        rate:
          `${formatRate(allocation.annualRate)} AER` +
          (allocation.termMonths === null
            ? ''
            : ` fixed for ${String(allocation.termMonths)} months`),
        job: allocation.job,
        watch: [...allocation.watch],
      })),
      firstYearInterest: arrangement.firstYearInterest,
      bonus:
        arrangement.bonus === null
          ? null
          : {
              amount: arrangement.bonus.amount,
              conditions: [...arrangement.bonus.conditions],
            },
      notes: [...arrangement.notes],
    }

    return {
      result:
        'Arrangement shown, worked out by the server from the facts held. Say one ' +
        'line about why it is shaped this way, in their terms, and stop. Do not ' +
        'restate a figure and do not ask anything: one tap starts every account ' +
        'on it.',
      card,
    }
  },
}
