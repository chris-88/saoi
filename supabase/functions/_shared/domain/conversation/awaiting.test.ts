import { describe, expect, it } from 'vitest'
import { AWAITING_CARDS } from '../../contracts/cards.ts'
import { awaitingCard, type AwaitingContext } from './awaiting.ts'

type Message = AwaitingContext['messages'][number]

const saoirse = (cards: readonly string[] = []): Message => ({ role: 'assistant', cards })
const customer = (): Message => ({ role: 'customer', cards: [] })
/** What a tap leaves behind: the app reports it to Saoirse, and the report is saved as `system`. */
const tap = (): Message => ({ role: 'system', cards: [] })

const loaded = (over: Partial<AwaitingContext> = {}): AwaitingContext => ({
  authLevel: 'anonymous',
  messages: [],
  applications: [],
  productInterests: [],
  requests: [],
  participants: [{ role: 'primary' }],
  ...over,
})

describe('the card still waiting for the customer', () => {
  it('is nothing when no card has been shown', () => {
    expect(awaitingCard(loaded())).toBeNull()
    expect(awaitingCard(loaded({ messages: [customer(), saoirse()] }))).toBeNull()
  })

  it('is nothing when the only cards are things to read', () => {
    expect(
      awaitingCard(
        loaded({ messages: [saoirse(['status']), customer(), saoirse(['data_notice'])] }),
      ),
    ).toBeNull()
  })

  /**
   * The turn this was built from. Saoirse put a joint current account on screen, the customer
   * wrote "Great", and Saoirse took the word for the tap.
   */
  it('is the options card the customer answered in words', () => {
    expect(awaitingCard(loaded({ messages: [customer(), saoirse(['product_options'])] }))).toEqual({
      type: 'product_options',
      turnsAgo: 1,
    })
  })

  it('counts how far back the card is in Saoirse’s own replies', () => {
    // The case is loaded before the message being answered is saved, so the reply in hand is
    // not in the transcript: a card on the last Saoirse message is one turn back, not none.
    const messages = [saoirse(['product_options']), customer(), saoirse(), customer(), saoirse()]
    expect(awaitingCard(loaded({ messages }))?.turnsAgo).toBe(3)
  })

  /** §67: the mortgage is under way when the joint account is offered. */
  it('still waits when an older application exists but nothing was tapped since', () => {
    const result = awaitingCard(
      loaded({
        applications: [{ state: 'in_progress' }],
        messages: [saoirse(['product_options'])],
      }),
    )
    expect(result?.type).toBe('product_options')
  })

  it('is settled by the tap that started something', () => {
    expect(
      awaitingCard(
        loaded({
          applications: [{ state: 'in_progress' }],
          messages: [saoirse(['product_options']), tap(), saoirse()],
        }),
      ),
    ).toBeNull()
  })

  it('is settled by leaving every option on it', () => {
    expect(
      awaitingCard(
        loaded({
          productInterests: [{ status: 'declined' }],
          messages: [saoirse(['product_options']), tap(), saoirse()],
        }),
      ),
    ).toBeNull()
  })

  it('is not settled by a tap that left the case as it was', () => {
    // Signing in is reported as a tap too. It starts nothing, so the options are still open.
    const result = awaitingCard(
      loaded({ messages: [saoirse(['product_options']), tap(), saoirse()] }),
    )
    expect(result?.type).toBe('product_options')
  })

  it('ignores a tap that came before the card', () => {
    const result = awaitingCard(
      loaded({
        applications: [{ state: 'in_progress' }],
        messages: [tap(), saoirse(['product_options'])],
      }),
    )
    expect(result?.type).toBe('product_options')
  })

  it('is replaced by a later card that asks something else', () => {
    const messages = [saoirse(['product_options']), customer(), saoirse(['review'])]
    expect(awaitingCard(loaded({ messages }))).toEqual({ type: 'review', turnsAgo: 1 })
  })

  it('skips a reply that drew nothing waiting, back to the one that did', () => {
    const messages = [saoirse(['product_options']), customer(), saoirse(['status'])]
    expect(awaitingCard(loaded({ messages }))).toEqual({ type: 'product_options', turnsAgo: 2 })
  })
})

describe('what settles each card', () => {
  it('a review, once the application is with the bank', () => {
    const messages = [saoirse(['review']), tap(), saoirse()]
    expect(awaitingCard(loaded({ messages, applications: [{ state: 'submitted' }] }))).toBeNull()
    expect(awaitingCard(loaded({ messages, applications: [{ state: 'ready' }] }))?.type).toBe(
      'review',
    )
  })

  it('a plan, by either decision', () => {
    expect(awaitingCard(loaded({ messages: [saoirse(['plan_proposal']), tap()] }))).toBeNull()
    expect(awaitingCard(loaded({ messages: [saoirse(['plan_proposal'])] }))?.type).toBe(
      'plan_proposal',
    )
  })

  it('an arrangement, once the accounts exist', () => {
    const messages = [saoirse(['arrangement']), tap(), saoirse()]
    expect(awaitingCard(loaded({ messages, applications: [{ state: 'in_progress' }] }))).toBeNull()
    expect(awaitingCard(loaded({ messages }))?.type).toBe('arrangement')
  })

  it('a pause prompt, by pausing or by carrying on', () => {
    expect(awaitingCard(loaded({ messages: [saoirse(['pause_prompt']), tap()] }))).toBeNull()
    // Continuing commits nothing, so nothing is saved: somebody who talks on has continued.
    expect(
      awaitingCard(loaded({ messages: [saoirse(['pause_prompt']), customer(), saoirse()] })),
    ).toBeNull()
    expect(awaitingCard(loaded({ messages: [saoirse(['pause_prompt'])] }))?.type).toBe(
      'pause_prompt',
    )
  })

  it('a partner invite, once the partner exists', () => {
    const messages = [saoirse(['partner_invite']), tap()]
    expect(
      awaitingCard(loaded({ messages, participants: [{ role: 'primary' }, { role: 'partner' }] })),
    ).toBeNull()
    expect(awaitingCard(loaded({ messages }))?.type).toBe('partner_invite')
  })

  it('an upload request, once a request was fulfilled', () => {
    const messages = [saoirse(['upload_request']), tap()]
    expect(awaitingCard(loaded({ messages, requests: [{ status: 'fulfilled' }] }))).toBeNull()
    expect(awaitingCard(loaded({ messages, requests: [{ status: 'open' }] }))?.type).toBe(
      'upload_request',
    )
  })

  it('the consent and form cards, on the tap alone', () => {
    for (const type of ['consent', 'form_declarations', 'form_upload', 'health_form'] as const) {
      expect(awaitingCard(loaded({ messages: [saoirse([type]), tap()] })), type).toBeNull()
      expect(awaitingCard(loaded({ messages: [saoirse([type])] }))?.type, type).toBe(type)
    }
  })

  it('the sign-in offer, by signing in or by moving on', () => {
    expect(
      awaitingCard(loaded({ authLevel: 'authenticated', messages: [saoirse(['sign_in'])] })),
    ).toBeNull()
    expect(
      awaitingCard(loaded({ messages: [saoirse(['sign_in']), customer(), saoirse()] })),
    ).toBeNull()
    expect(awaitingCard(loaded({ messages: [saoirse(['sign_in'])] }))?.type).toBe('sign_in')
  })

  it('does not let the server’s sign-in offer outrank the card the model asked with', () => {
    const messages = [saoirse(['product_options', 'sign_in'])]
    expect(awaitingCard(loaded({ messages }))?.type).toBe('product_options')
  })

  it('never waits on a comparison or a quote, which words answer', () => {
    expect(awaitingCard(loaded({ messages: [saoirse(['comparison'])] }))).toBeNull()
    expect(awaitingCard(loaded({ messages: [saoirse(['quote'])] }))).toBeNull()
  })

  it('lets a comparison end the wait on anything older', () => {
    const messages = [saoirse(['product_options']), customer(), saoirse(['comparison'])]
    expect(awaitingCard(loaded({ messages }))).toBeNull()
  })

  it('classifies every card the contract says waits for the customer', () => {
    for (const type of AWAITING_CARDS) {
      const result = awaitingCard(loaded({ messages: [saoirse([type])] }))
      expect(result === null || result.type === type, type).toBe(true)
    }
  })
})
