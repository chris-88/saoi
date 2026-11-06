import { lastOptionsOffered, setsEqual } from '../lookups.ts'
import type { Card } from '@shared/contracts/cards.ts'
import { factCatalogue } from '@shared/domain/facts.ts'
import { suitableCurrentAccount } from '@shared/tenants/demo/current-accounts.ts'
import { caseFactReader } from '@shared/db/fact-reader.ts'
import { productInfo } from '@shared/tenants/demo/products.ts'
import { knowledgeProduct } from '@shared/tenants/demo/kb-prompt.ts'
import { loadCase, writeEvent } from '@shared/db/case-repository.ts'
import { needsFor } from '@shared/db/needs.ts'
import { worthRaising } from '@shared/domain/goals/engine.ts'
import type { ToolModule } from './_shared.ts'

/**
 * How many customer turns before the discovery gate lifts regardless.
 *
 * A customer who will not answer questions must still be able to get somewhere. Four was two
 * exchanges — enough to learn that somebody is renting and has savings, and nothing about what
 * they earn, what they are buying or who else is involved.
 */
const DISCOVERY_PATIENCE = 7

/** Short, so a genuinely different set of options can still follow a turn later. */
const OPTIONS_CARD_WINDOW = 2

export const showProductOptionsTool: ToolModule<'show_product_options'> = {
  name: 'show_product_options',
  async run(input, ctx) {
    const { admin, turn, loaded, gate, goals, kb, currentAccountPick, customerMessage } = ctx

    const { products } = input

    /**
     * §5, §6 — is there enough understanding of this person to be offering anything?
     *
     * Two different questions were being conflated. "Is a need established" is
     * answered the moment somebody says the word mortgage, and the gate passed on
     * that — so a customer who had said they wanted a broad conversation about their
     * whole position, and had given one round of answers, was handed a mortgage card
     * in the same turn Saoirse was still asking them what price range they had in mind.
     *
     * Being sure what somebody needs is not the same as understanding their
     * position, and a person doing this job would keep asking. The Goal Engine
     * already works out what a goal needs to know before it can be acted on, so the
     * gate is whether the case can answer most of it.
     */
    const candidates = needsFor(loaded, {
      sensitiveDisclosure: gate.suppressHumour,
    })
    const established = candidates.some(
      (candidate) => candidate.state === 'ready_to_surface' || candidate.state === 'clarify',
    )
    const customerTurns = loaded.messages.filter((m) => m.role === 'customer').length

    // Whichever goal the offer is in service of: the one they named, or failing that
    // the best-evidenced one worth raising.
    const leading = worthRaising(goals.candidates, 1)[0] ?? null
    const needed = leading?.goal.informationNeeded.length ?? 0
    const unknown = leading?.missing.length ?? 0
    const understood = needed === 0 || unknown <= Math.floor(needed / 2)

    /**
     * The escape hatch, raised from four turns.
     *
     * Somebody who will not answer questions still has to be able to get somewhere,
     * and past a certain point continuing to ask is its own failure. But four turns
     * is two exchanges, which is nowhere near enough to have understood anybody.
     */
    /**
     * Did they ask for this, in so many words?
     *
     * The gate below decides whether Saoirse understands somebody well enough to raise
     * something. It has nothing to say about a product they have just named: "can I
     * open a current account with you please" answered with "before I set that up,
     * what sort of price are you looking at" is not discovery, it is not listening.
     *
     * Matched against the message in front of us rather than the recorded objective,
     * because the objective is what they came for and this is what they just said.
     */
    const asked = ((): boolean => {
      const said = customerMessage.toLowerCase()
      if (said === '') return false

      return products.some((option) => {
        const product = option.product
        const name = productInfo(product).name.toLowerCase()
        return said.includes(name) || said.includes(product.replaceAll('_', ' '))
      })
    })()

    /**
     * Or did the needs engine establish it? A need that is ready to surface has
     * crossed its threshold on explicit or corroborated evidence, and "understand
     * their position" is the wrong bar for a product with nothing to assess: a
     * graduate who said "I need a bank account" and gave the facts the account pick
     * turns on was refused the card for six turns while being asked about a house.
     */
    const wanted = products.some((option) =>
      candidates.some(
        (candidate) =>
          candidate.state === 'ready_to_surface' &&
          candidate.need.products.includes(option.product),
      ),
    )

    if (!asked && !wanted && (!established || !understood) && customerTurns < DISCOVERY_PATIENCE) {
      const ask =
        leading === null || leading.missing.length === 0
          ? 'what has changed for them, who else is involved and what they are hoping to do'
          : leading.missing
              .slice(0, 4)
              .map((key) => factCatalogue[key]?.label?.toLowerCase() ?? key)
              .join(', ')

      return {
        result:
          `Too early — you do not understand their position well enough to be offering anything yet. ` +
          `Still unknown: ${ask}. Ask about those, in their language and a couple at a time, ` +
          'and record what they tell you. Offer once you can actually see where they stand. ' +
          'Do not mention that you were stopped, and do not ask a question and show options in the same breath.',
        refused: true,
      }
    }

    /**
     * One offer, not one per turn. The card persists in the transcript and stays
     * tappable, so showing it again adds nothing and makes the conversation look
     * like it is going in circles. The window is short, so genuinely new options
     * can still be offered a turn later.
     */
    const justOffered = loaded.messages
      .slice(-OPTIONS_CARD_WINDOW)
      .some((message) => message.cards.includes('product_options'))

    /*
     * The same set is a repeat; a different set is a new offer. The customer said
     * "keep the fixed term too", the model asked for three accounts where two were
     * on screen, was told the card was already there, and told the customer the
     * three were on the card. Only the types are loaded with the case, so the last
     * card's options are read back when it matters.
     */
    const onScreen = justOffered ? await lastOptionsOffered(admin, turn.caseId) : new Set<string>()
    const sameAsOnScreen =
      onScreen.size > 0 &&
      setsEqual(
        onScreen,
        new Set(products.map((option) => String(option.catalogueId ?? option.product))),
      )

    if (justOffered && sameAsOnScreen) {
      return {
        result:
          'Those options are already on screen from the previous turn and still work. Answer what they asked and point at the card; do not show it again.',
      }
    }

    const declined = new Set(
      loaded.productInterests.filter((i) => i.status === 'declined').map((i) => i.product),
    )

    /*
     * The current account is decided from facts, not by the model (§51, Invariant 3).
     *
     * Whatever account the model named, the card shows the one the rules pick, and
     * the model is told so it says the right name. From the case as it is now, like
     * `show_arrangement`: a graduation year recorded earlier in this same turn is not
     * in the pick the turn began with, and swapping on a stale pick would put the
     * account with the fee on the card in the one turn that matters.
     */
    const offersCurrentAccount = products.some((option) => option.product === 'current_account')
    const fresh = offersCurrentAccount ? await loadCase(admin, turn.caseId) : null
    const freshReader = fresh === null ? null : caseFactReader(fresh)
    const pick =
      freshReader === null
        ? currentAccountPick
        : suitableCurrentAccount(freshReader, new Date(), kb.products)

    const swaps: { readonly from: string | null; readonly note: string }[] = []
    const offered = products.map((option) => {
      if (option.product !== 'current_account' || pick === null) return option
      if (option.catalogueId === pick.catalogueId) return option

      swaps.push({
        from: option.catalogueId ?? null,
        note:
          `Swapped ${option.catalogueId ?? 'an unnamed current account'} for ` +
          `${pick.catalogueId}: ${pick.because} The card shows the ${pick.name}; ` +
          'name that account, not the one you asked for.',
      })
      return { ...option, catalogueId: pick.catalogueId }
    })

    for (const swap of swaps) {
      await writeEvent(admin, {
        caseId: turn.caseId,
        type: 'product_swapped',
        actor: 'system',
        payload: {
          product: 'current_account',
          from: swap.from,
          to: pick?.catalogueId ?? null,
          because: pick?.because ?? null,
        },
      })
    }

    /*
     * The specific product's own name, where the model named one.
     *
     * Two savings accounts both labelled "Savings account" are two rows a customer
     * cannot tell apart, and they were the same row to the code as well.
     */
    const card: Card = {
      type: 'product_options',
      options: offered.map((option) => {
        const catalogue =
          option.catalogueId === undefined
            ? undefined
            : knowledgeProduct(option.catalogueId, kb.products)

        return {
          product: option.product,
          ...(catalogue === undefined ? {} : { catalogueId: catalogue.id }),
          displayName: catalogue?.name ?? productInfo(option.product).name,
          oneLine: catalogue?.customer_job ?? productInfo(option.product).oneLine,
          reason: option.reason,
          previouslyDeclined: declined.has(option.product),
        }
      }),
    }

    for (const option of offered) {
      await writeEvent(admin, {
        caseId: turn.caseId,
        type: 'product_offered',
        actor: 'model',
        payload: {
          product: option.product,
          reason: option.reason,
          ...(option.catalogueId === undefined ? {} : { catalogueId: option.catalogueId }),
        },
      })
    }

    /**
     * Offering and asking at once reads as not listening.
     *
     * The card is a decision point: it asks the customer to choose. Putting a fresh
     * question beside it gives them two things to answer and makes the offer look
     * like something Saoirse was going to say regardless of their reply.
     */
    return {
      result:
        'Options shown. The customer chooses in the card, so stop there — say in a ' +
        'sentence why these and leave them to it. Do not ask another question in the ' +
        'same turn; whatever it is will keep until they have decided.' +
        (swaps.length === 0 ? '' : ` ${swaps.map((swap) => swap.note).join(' ')}`),
      card,
    }
  },
}
