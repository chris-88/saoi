import type { Card } from '@shared/contracts/cards.ts'
import { compareSwitch } from '@shared/domain/switch-comparison.ts'
import { SWITCHING_COSTS } from '@shared/tenants/demo/switching.ts'
import { selectRates } from '@shared/tenants/demo/mortgage-rates-select.ts'
import type { ToolModule } from './_shared.ts'
import { money } from './_shared.ts'

/**
 * §51 — a question about money, answered with figures.
 *
 * Everything on the card is computed here from the catalogue. The model chose to
 * show it and supplied what the customer said; it never sees a number it could
 * restate wrongly, which is the whole reason this tool exists.
 */
/**
 * Several catalogue products side by side (§51).
 *
 * The model picks which and says why; everything else is read from the knowledge
 * base here. An id that is not in the catalogue, or one the pack flags for
 * internal verification, is refused rather than rendered — the filtering that
 * keeps those four out of the prompt has to hold at the card too, or the one
 * place a customer actually reads is the one place it does not apply.
 */
export const showMortgageRatesTool: ToolModule<'show_mortgage_rates'> = {
  name: 'show_mortgage_rates',
  run(input, ctx) {
    const { rateTable } = ctx

    const ask = input

    const selection = selectRates(
      {
        customerType: ask.customerType,
        ber: ask.ber,
        ...(ask.amountEur === undefined ? {} : { amountEur: ask.amountEur }),
        ...(ask.termYears === undefined ? {} : { termYears: ask.termYears }),
      },
      rateTable,
    )

    /*
     * Refusing to price something is an answer, not a failure. A0 is the live case:
     * the bank added it to the BER scale and has not published a rate for it, and
     * rounding it down to A would cost somebody money.
     */
    if (selection.unavailable !== null) {
      return {
        result:
          `No rate can be quoted: ${selection.unavailable} Tell them that plainly, ` +
          'and offer to carry on with everything else.',
        refused: true,
      }
    }

    if (selection.options.length === 0) {
      return {
        result:
          'No published rate matches those details. Check the buyer type and BER ' +
          'against what they actually told you before asking them again.',
        refused: true,
      }
    }

    /*
     * The rate they have, or have been offered to stay, set against each of ours.
     *
     * Only with an amount and a term, because the comparison is in euro and a
     * percentage against a percentage is what the customer could already do. The
     * costs beside it are the published ones, listed rather than subtracted.
     */
    const compareWith = ask.compareWith
    const comparison =
      compareWith !== undefined && ask.amountEur !== undefined && ask.termYears !== undefined
        ? compareSwitch({
            balanceEur: ask.amountEur,
            termYears: ask.termYears,
            against: {
              label: compareWith.label,
              ratePct: compareWith.ratePct,
              cashbackEur: compareWith.cashbackEur ?? null,
              fixedYears: compareWith.fixedYears ?? null,
            },
            candidates: selection.options.map((option) => ({
              id: option.id,
              label: option.label,
              ratePct: option.ratePct,
              cashbackEur: option.cashbackEur,
              fixedYears: option.fixedYears,
            })),
          })
        : null

    const card: Card = {
      type: 'mortgage_rates',
      title: comparison === null ? 'Your mortgage rate options' : 'Our rates against what you have',
      basis: {
        buyerType: ask.customerType.replaceAll('_', ' '),
        ber: ask.ber,
        amountEur: ask.amountEur ?? null,
        termYears: ask.termYears ?? null,
      },
      asOf: selection.asOf,
      options: selection.options.map((option) => ({
        id: option.id,
        label: option.label,
        familyLabel: option.familyLabel,
        ratePct: option.ratePct,
        aprcPct: option.aprcPct,
        cashbackEur: option.cashbackEur,
        cashbackNote: option.cashbackNote,
        monthlyEur: option.monthlyEur,
        note: option.note,
      })),
      ...(comparison === null
        ? {}
        : {
            comparison: {
              against: comparison.against,
              rows: comparison.rows.map((row) => ({
                optionId: row.optionId,
                monthlyDifferenceEur: row.monthlyDifferenceEur,
                overYears: row.overYears,
                repaymentDifferenceEur: row.repaymentDifferenceEur,
                cashbackDifferenceEur: row.cashbackDifferenceEur,
                netBeforeCostsEur: row.netBeforeCostsEur,
              })),
              costs: SWITCHING_COSTS.map((cost) => ({
                label: cost.label,
                amount: cost.amount,
                note: cost.note,
              })),
            },
          }),
    }

    const cheapest = selection.options.reduce((low, option) =>
      option.ratePct < low.ratePct ? option : low,
    )
    const withCashback = selection.options.find((option) => option.cashbackEur !== null)

    return {
      result:
        `${String(selection.options.length)} rates are on the card with their APRCs ` +
        `and repayments, as published on ${selection.asOf}. Do not read them back. ` +
        'Say what separates them in a sentence or two' +
        (withCashback && withCashback.id !== cheapest.id
          ? `, and be straight that the lowest rate (${String(cheapest.ratePct)}%) pays no cashback while ` +
            `${withCashback.label} pays ${money(withCashback.cashbackEur ?? 0)} — which is cheaper ` +
            'depends on how long they stay on it, and it is their call.'
          : '.') +
        ' A published rate is not an offer: what they can borrow still goes through a ' +
        'full assessment.',
      card,
    }
  },
}
