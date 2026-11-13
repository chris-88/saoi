import { writeEvent } from '@shared/db/case-repository.ts'
import { loadHoldings } from '@shared/db/holdings.ts'
import { loadClaimedPlans } from '@shared/db/saved-plans.ts'
import { compareProducts, comparisonCardText } from '@shared/domain/market/compare.ts'
import { markChosenColumns } from '@shared/domain/market/choices.ts'
import { caseFigures } from '@shared/domain/market/products-card.ts'
import { adviceWordsIn } from '@shared/market/disclosures.ts'
import type { ToolModule } from './_shared.ts'
import { chosenText } from './show-products.ts'

/** Today in Europe/Dublin, YYYY-MM-DD: the day the figures are worked out from. */
const dublinToday = (now: Date = new Date()): string =>
  now.toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' })

const UNREAD = 'The market could not be read just now. Say so in a line.'

/**
 * The products the customer selected on the cards, set against each other (Chris, 2026-11-13).
 * The model passes the selected row ids; the customer's figures come from the case as they do
 * for `show_products` (`caseFigures`: the newest claimed plan, the holdings, the facts), and
 * every column, difference and the deciding question from the engine
 * (`domain/market/compare.ts`). The model writes nothing on the card (Invariant 2), and the
 * result hands it the question to ask and the differences to answer "help me choose" with,
 * as facts, never a pick. Writes `products_compared` (ids and names, no figures) so a follow-up
 * can be answered.
 */
export const compareProductsTool: ToolModule<'compare_products'> = {
  name: 'compare_products',
  async run(input, ctx) {
    const caseId = ctx.turn.caseId
    let loaded
    try {
      const [claimed, holdings, market] = await Promise.all([
        loadClaimedPlans(ctx.admin, caseId),
        loadHoldings(ctx.admin, caseId),
        ctx.market(),
      ])
      loaded = { plan: claimed.at(-1)?.plan ?? null, holdings, market }
    } catch {
      return { result: UNREAD, refused: true }
    }
    if (loaded.market.products.length === 0) return { result: UNREAD, refused: true }

    const fact = (key: string): unknown =>
      ctx.loaded.facts.filter((item) => item.key === key && item.supersededBy === null).at(-1)
        ?.value
    const figures = caseFigures({ plan: loaded.plan, holdings: loaded.holdings, fact })
    const outcome = compareProducts(loaded.market, figures, input.rowIds, dublinToday())

    if (outcome.kind === 'refused') {
      return {
        result:
          `No comparison: ${outcome.reason} Say so in a line, in your own words, and ask ` +
          'nothing else.',
        refused: true,
      }
    }

    // A column that is one of the customer's choices is marked, so the card can badge it.
    const card = markChosenColumns(outcome.card, loaded.plan?.choices)
    // Held to the line on every string the card says and on what the model is handed beside it.
    const advice = adviceWordsIn(
      [comparisonCardText(card), ...outcome.figureBasis.map((column) => column.line)].join('\n'),
    )
    if (advice.length > 0) {
      return { result: 'That comparison could not be shown just now.', refused: true }
    }

    await writeEvent(ctx.admin, {
      caseId,
      type: 'products_compared',
      actor: 'model',
      // Ids and names only: the next turn looks the figures up again.
      payload: {
        rowIds: card.columns.map((column) => column.rowId),
        leads: card.columns.map((column) => column.lead),
      },
    }).catch(() => undefined)

    return {
      result:
        `The comparison is on screen: "${card.title}", in the order they selected. The ` +
        'facts to know before choosing each, and the detail, are on the card: do not repeat ' +
        'them. Say one line about what the card sets side by side, then ask this question, ' +
        `in these words or close to them, and nothing else: "${card.decides}" Do not read the ` +
        'rows or figures out, do not rank them, and never say which one to take or which is ' +
        'better: it is a comparison, and they decide. If they asked for help choosing, give ' +
        'the differences below as facts, in a sentence or two, then that question.' +
        `\nDifferences, the facts that separate them:\n${card.differences.map((line) => `- ${line}`).join('\n')}` +
        `\nfigureBasis, what each column's money counts, to answer a question about one (not to ` +
        `read out):\n${outcome.figureBasis
          .map(
            (column) =>
              `- ${card.columns.find((item) => item.rowId === column.rowId)?.lead ?? column.rowId}: ${column.line}`,
          )
          .join('\n')}` +
        chosenText(card.columns),
      card,
    }
  },
}
