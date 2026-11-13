import { writeEvent } from '@shared/db/case-repository.ts'
import { loadHoldings } from '@shared/db/holdings.ts'
import { loadClaimedPlans } from '@shared/db/saved-plans.ts'
import {
  caseFigures,
  groupsInWords,
  productsCard,
  productsCardText,
  type RowBasis,
} from '@shared/domain/market/products-card.ts'
import { adviceWordsIn } from '@shared/market/disclosures.ts'
import type { ToolModule } from './_shared.ts'

/** Today in Europe/Dublin, YYYY-MM-DD: the day the figures are worked out from. */
const dublinToday = (now: Date = new Date()): string =>
  now.toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' })

/**
 * What each row's money figure counts, for the model to quote when asked whether a figure will
 * be realised (2026-11-12: Saoirse told Chris bunq's €581 would not be earned and to check with
 * bunq, when the figure already counted the bonus ending and the rate after it). Not on the card.
 */
export function figureBasisText(rows: readonly RowBasis[]): string {
  if (rows.length === 0) return ''
  return (
    '\nfigureBasis, what each row’s money figure counts, to answer a question about one (not to ' +
    'read out with the card):\n' +
    rows.map((row) => `- ${row.lead}: ${row.line}`).join('\n')
  )
}

/**
 * The product card that follows the question asked (the first-home experience, "4. The
 * conversation"). The model names the arrangement the question implies; the customer's figures
 * come from the case (the newest claimed plan, the holdings, the facts), the rows from the
 * engine over the whole market (`domain/market/products-card.ts`). The model writes nothing on
 * the card (Invariant 2). With nothing to work on, the result is the questions that would let it
 * run, and no card.
 */
export const showProductsTool: ToolModule<'show_products'> = {
  name: 'show_products',
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
      return { result: 'The market could not be read just now. Say so in a line.', refused: true }
    }
    if (loaded.market.products.length === 0) {
      return { result: 'The market could not be read just now. Say so in a line.', refused: true }
    }

    const fact = (key: string): unknown =>
      ctx.loaded.facts.filter((item) => item.key === key && item.supersededBy === null).at(-1)
        ?.value
    const figures = caseFigures({ plan: loaded.plan, holdings: loaded.holdings, fact })
    const outcome = productsCard(
      loaded.market,
      figures,
      {
        arrangement: input.arrangement,
        category: input.category,
        sortBy: input.sortBy,
        filters: input.filters,
      },
      dublinToday(),
    )

    if (outcome.kind === 'questions') {
      return {
        result:
          'No card: these figures are needed first. Ask the first one, in your own words, and ' +
          `nothing else: ${outcome.questions.map((question) => `"${question}"`).join(' ')}`,
      }
    }

    const card = outcome.card
    // Held to the line on every string the card says (the duty of care, 2.2), and on what the
    // model is handed to quote beside it: never shown if not.
    const advice = adviceWordsIn(
      [productsCardText(card), ...outcome.figureBasis.map((row) => row.line)].join('\n'),
    )
    if (advice.length > 0) {
      return { result: 'That card could not be shown just now.', refused: true }
    }

    await writeEvent(ctx.admin, {
      caseId,
      type: 'products_shown',
      actor: 'model',
      payload: {
        arrangement: card.arrangement.kind,
        ...(input.category === undefined ? {} : { category: input.category }),
        ...(input.sortBy === undefined ? {} : { sortBy: input.sortBy }),
        ...(input.filters === undefined ? {} : { filters: input.filters }),
        rows: card.rows.length,
        more: card.more,
        // Read back by the next turns' digest (`productsBasisLines`): the rows' figure basis
        // outlives the tool result, which only the turn that called it sees.
        figureBasis: outcome.figureBasis.map((row) => ({
          id: row.id,
          lead: row.lead,
          value: row.value,
          line: row.line,
        })),
      },
    }).catch(() => undefined)

    return {
      result:
        `The card is on screen: "${card.arrangement.title}", ${String(card.rows.length)} rows` +
        (card.more > 0 ? ` and ${String(card.more)} more they can ask for` : '') +
        `. ${card.arrangement.line}` +
        (groupsInWords(card) === null
          ? ''
          : ` It is in groups: ${groupsInWords(card) ?? ''}; refer to a group by its label.`) +
        ' Say one line about what it shows, in their terms, and ask ' +
        'nothing else. Do not read the rows or figures out, do not rank them in words, and ' +
        'never say which one to take: it is a comparison, and they decide.' +
        figureBasisText(outcome.figureBasis),
      card,
    }
  },
}
