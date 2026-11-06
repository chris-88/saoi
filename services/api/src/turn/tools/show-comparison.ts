import type { Card } from '@shared/contracts/cards.ts'
import { surfaceableProducts } from '@shared/tenants/demo/kb-prompt.ts'
import { rateOf } from '@shared/tenants/demo/rates.ts'
import type { ToolModule } from './_shared.ts'

export const showComparisonTool: ToolModule<'show_comparison'> = {
  name: 'show_comparison',
  run(input, ctx) {
    const { kb } = ctx

    const ask = input

    const found = ask.options.map((option) => ({
      option,
      product: surfaceableProducts(kb.products).find((candidate) => candidate.id === option.id),
    }))

    const missing = found.filter((entry) => entry.product === undefined)
    if (missing.length > 0) {
      return {
        result:
          `Not in the catalogue, or not for showing: ${missing.map((entry) => entry.option.id).join(', ')}. ` +
          'Use ids exactly as they appear in the product list, and only ones listed there.',
        refused: true,
      }
    }

    const card: Card = {
      type: 'comparison',
      title: ask.title,
      options: found.map(({ option, product }) => {
        const rate = product === undefined ? null : rateOf(product)

        return {
          id: option.id,
          name: product?.name ?? option.id,
          oneLine: product?.customer_job ?? '',
          rate: rate?.headline ?? null,
          rateNote: rate?.note ?? null,
          // Four is what fits beside three others on a phone before it stops being
          // something anybody compares and becomes something they scroll past.
          highlights: (product?.features ?? []).slice(0, 4).map((feature) => feature),
          reason: option.reason,
          endsIn:
            product === undefined || product.advice_model === 'information_or_self_serve'
              ? null
              : product.advice_model.replaceAll('_', ' '),
        }
      }),
    }

    return {
      result:
        `Comparing ${String(found.length)} products. They are on the card with what ` +
        'each one is for — do not read them back. Say in a sentence what separates ' +
        'them, and leave the choosing to them. Tapping one asks you to go through ' +
        'it; it starts nothing.',
      card,
    }
  },
}
