import type { Card } from '@shared/contracts/cards.ts'
import { productInfo } from '@shared/tenants/demo/products.ts'
import { writeEvent } from '@shared/db/case-repository.ts'
import { buildQuote } from '@shared/domain/quotes/engine.ts'
import type { ToolModule } from './_shared.ts'

/**
 * Longer than the options window: a quote is read and compared rather than acted on, so it
 * stays useful further up the conversation, and a second copy of the same figures is noise.
 */
const QUOTE_CARD_WINDOW = 4

export const showQuoteTool: ToolModule<'show_quote'> = {
  name: 'show_quote',
  async run(input, ctx) {
    const { admin, turn, loaded, goalContext } = ctx

    const ask = input

    /**
     * One quote, not one per turn.
     *
     * Asked to go through an option, the model reached for the tool again and put a
     * second card under the first — the same figures, one row shorter. The card is
     * still on screen; what the customer wanted was the explanation.
     */
    const quoteOnScreen = loaded.messages
      .slice(-QUOTE_CARD_WINDOW)
      .some((message) => message.cards.includes('quote'))

    if (quoteOnScreen) {
      return {
        result:
          'That quote is already on screen. Talk about it rather than showing it ' +
          'again — and keep finding out what they need it for and how they mean to ' +
          'repay it.',
      }
    }

    const info = productInfo(ask.product)

    /*
     * What they have already put aside, from the case rather than from the model.
     *
     * Somebody with €32,000 towards a €40,000 deposit was told it would take two
     * years and nine months — which is how long €40,000 takes from nothing. The
     * arithmetic was right and it answered a question nobody asked. The balance is
     * a fact the bank holds, so it is read here and never passed in (Invariant 2).
     */
    const facts = goalContext?.facts
    const opening =
      ask.product === 'savings'
        ? (facts?.number('assets.depositAmount', 'household') ??
          facts?.number('assets.savingsBalance', 'household') ??
          undefined)
        : undefined

    const quote = buildQuote(info.variants ?? [], {
      amount: ask.amount,
      months: ask.months,
      monthly: ask.monthly,
      ...(opening === undefined || opening <= 0 ? {} : { opening }),
    })

    if (quote.problem !== null) {
      return {
        result:
          `No options to show: ${quote.problem} Say that plainly and ask for what ` +
          'would let you work it out.',
        refused: true,
      }
    }

    const card: Card = {
      type: 'quote',
      product: ask.product,
      displayName: info.name,
      basis: quote.basis,
      options: quote.options.map((option) => ({
        id: option.id,
        name: option.name,
        highlight: option.highlight,
        headline: option.headline,
        figures: [...option.figures],
        footnote: option.footnote,
      })),
    }

    /*
     * Showing somebody what a mortgage would cost is significant (Invariant 9), and
     * it is also the only record that this product is in play. The next turn reads
     * it to work out what applying would involve, which it cannot do from a card
     * payload nothing stores.
     */
    await writeEvent(admin, {
      caseId: turn.caseId,
      type: 'product_quoted',
      actor: 'model',
      payload: { product: ask.product, basis: quote.basis },
    })

    return {
      result:
        `Showing ${String(quote.options.length)} options for ${info.name}, based on ` +
        `${quote.basis}. The figures are on the card — do not repeat them. Say in a ` +
        'sentence what the trade-off between them is, and invite them to tap one so ' +
        'you can go through it properly. The rates are illustrative.',
      card,
    }
  },
}
