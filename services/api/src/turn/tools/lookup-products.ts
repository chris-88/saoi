import { writeEvent } from '@shared/db/case-repository.ts'
import { lookupProducts, lookupResultText } from '@shared/domain/market/lookup.ts'
import { adviceWordsIn } from '@shared/market/disclosures.ts'
import type { ToolModule } from './_shared.ts'

const UNREAD =
  'The market could not be read just now. Say so in a line and give no figure; do not say the ' +
  'product is not held.'

/**
 * A product, a provider or a rate the customer named, looked up across the whole market
 * (2026-11-13: Saoirse told Chris she did not hold AIB's 24-month fixed rate, which CCPC lists
 * and the market table holds). Read only and no card: the result is the facts to answer from,
 * each with its source and the day checked, and the rule for answering (a comparison, never a
 * pick). The query and the ids found are recorded as `products_looked_up`, no figures, so a
 * later turn knows what was looked up and looks it up again for the figures.
 */
export const lookupProductsTool: ToolModule<'lookup_products'> = {
  name: 'lookup_products',
  async run(input, ctx) {
    let market
    try {
      market = await ctx.market()
    } catch {
      return { result: UNREAD }
    }
    if (market.products.length === 0) return { result: UNREAD }

    const outcome = lookupProducts(market, input)
    const text = lookupResultText(outcome)
    // Saoi's own words around the source's are held to the line; never returned if not.
    if (adviceWordsIn(text).length > 0) {
      return { result: 'That lookup could not be returned just now. Say so in a line.' }
    }

    await writeEvent(ctx.admin, {
      caseId: ctx.turn.caseId,
      type: 'products_looked_up',
      actor: 'model',
      payload: {
        query: input.query,
        ...(input.category === undefined ? {} : { category: input.category }),
        ids: outcome.matches.map((fact) => fact.id),
        names: outcome.matches.map((fact) => `${fact.provider} ${fact.product}`),
        more: outcome.more,
      },
    }).catch(() => undefined)

    return { result: text }
  },
}
