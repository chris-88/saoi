import { describe, expect, it } from 'vitest'
import { landingFor, soundsLikeReturning, worthCarrying, type CaseSubstance } from './continuity.ts'

const nothing: CaseSubstance = {
  customerMessages: 0,
  facts: 0,
  applications: 0,
  plans: 0,
}

const substance = (over: Partial<CaseSubstance>): CaseSubstance => ({ ...nothing, ...over })

describe('whether a conversation is worth carrying across a sign-in', () => {
  /**
   * The case this exists for.
   *
   * Somebody returning on a new phone lands on a fresh anonymous case, taps sign in, and that
   * fresh case is worth nothing to anybody. Attaching it would put an empty conversation in
   * their switcher every time they signed in on a new device.
   */
  it('leaves an untouched conversation behind', () => {
    expect(worthCarrying(nothing)).toBe(false)
    expect(worthCarrying(substance({ customerMessages: 1 }))).toBe(false)
  })

  it('carries anything the customer would be annoyed to lose', () => {
    expect(worthCarrying(substance({ applications: 1 }))).toBe(true)
    expect(worthCarrying(substance({ plans: 1 }))).toBe(true)
    expect(worthCarrying(substance({ facts: 1 }))).toBe(true)
  })

  /**
   * One message is somebody saying hello and then thinking better of it. Two is a conversation,
   * even when nothing was recorded from it.
   */
  it('carries a conversation once it is actually a conversation', () => {
    expect(worthCarrying(substance({ customerMessages: 2 }))).toBe(true)
  })
})

describe('which conversation a sign-in opens', () => {
  /**
   * The whole point of signing in, for a returning person: they want the conversation they
   * had, not the empty one they just created by arriving.
   */
  it('opens the account’s own conversation when there is one', () => {
    expect(landingFor({ prior: nothing, accountHasConversation: true })).toEqual({ on: 'account' })
  })

  /**
   * Still the account's, even when the new one has substance.
   *
   * They signed in to get back to something. The one they just started is attached by
   * `worthCarrying` and sits in the switcher, so nothing is lost — this decides only what is
   * on screen when they look up.
   */
  it('prefers the account’s conversation over a new one with work in it', () => {
    expect(
      landingFor({ prior: substance({ applications: 1 }), accountHasConversation: true }),
    ).toEqual({ on: 'account' })
  })

  it('opens the one they are in when the account has none', () => {
    expect(landingFor({ prior: substance({ facts: 3 }), accountHasConversation: false })).toEqual({
      on: 'prior',
    })
    expect(landingFor({ prior: nothing, accountHasConversation: false })).toEqual({ on: 'prior' })
  })
})

describe('whether somebody is telling us they have been here before', () => {
  /**
   * Deliberately narrow, and it is meant to miss.
   *
   * The menu always carries the way back in, so a miss costs somebody one tap. A false
   * positive puts a sign-in card in front of a new customer who said something innocuous,
   * which is the login wall this product is trying not to be.
   */
  it('hears the plain ways of saying it', () => {
    for (const said of [
      'I spoke to you last week about a mortgage',
      'we talked to Saoirse before',
      'can I pick up where I left off',
      'I want to carry on where I left off',
      'been here before, I had a plan going',
      'I was here before',
      "I'm back",
      'I am back again',
      'what happened to my conversation',
      'last time we discussed the deposit',
    ]) {
      expect(soundsLikeReturning(said), said).toBe(true)
    }
  })

  it('does not hear it in an ordinary first message', () => {
    for (const said of [
      'I want to buy my first home',
      'I started saving last year and want to do it properly',
      'my wife and I are looking at houses',
      'I have an application with another bank',
      'back to the savings question',
      'what did you say about the rate',
      'I talked to my wife about this',
      'can you tell me about my options',
    ]) {
      expect(soundsLikeReturning(said), said).toBe(false)
    }
  })

  it('is not fooled by case or spacing', () => {
    expect(soundsLikeReturning('  BEEN  HERE  BEFORE  ')).toBe(true)
  })

  it('says no to nothing at all', () => {
    expect(soundsLikeReturning('')).toBe(false)
    expect(soundsLikeReturning('   ')).toBe(false)
  })
})
