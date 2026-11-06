import { describe, expect, it } from 'vitest'
import { mayOfferProducts, mayProposePlan, stageFor, STAGES, type StageContext } from './stages.ts'

const base: StageContext = {
  customerTurns: 3,
  goalGaps: 5,
  approach: null,
  planAccepted: false,
  arrangement: false,
  arrangementShown: false,
  applications: 0,
}

const at = (over: Partial<StageContext>) => stageFor({ ...base, ...over })

describe('where a conversation has got to', () => {
  it('opens on the first thing anybody says', () => {
    expect(at({ customerTurns: 1 })).toBe('opening')
  })

  /**
   * The order this whole engine turns on, and the one it got wrong first time.
   *
   * Discovery used to run before the fork, so a conversation about buying a first home became
   * four turns of mortgage qualification before anybody was asked what they wanted. Asking
   * somebody whether they want a plan costs one sentence and requires knowing nothing about
   * them, so it comes first and nothing about the case can delay it.
   */
  it('keeps the fork open until it is answered, whatever else is unknown', () => {
    expect(at({ customerTurns: 2, goalGaps: 9 })).toBe('direction')
    expect(at({ customerTurns: 6, goalGaps: 0 })).toBe('direction')
  })

  it('discovers only once they have asked for a plan', () => {
    expect(at({ approach: null, goalGaps: 9 })).toBe('direction')
    expect(at({ approach: 'plan', goalGaps: 9 })).toBe('discovering')
  })

  it('plans once there is enough of a picture to be worth one', () => {
    expect(at({ approach: 'plan', goalGaps: 3 })).toBe('discovering')
    expect(at({ approach: 'plan', goalGaps: 2 })).toBe('planning')
    expect(at({ approach: 'plan', goalGaps: 0 })).toBe('planning')
  })

  /** Somebody who knows what they want is taken at their word: no plan, no discovery. */
  it('goes straight to choosing when they just want the product', () => {
    expect(at({ approach: 'product', goalGaps: 9 })).toBe('choosing')
    expect(at({ customerTurns: 2, approach: 'product', goalGaps: 9 })).toBe('choosing')
  })

  it('chooses once a plan is theirs', () => {
    expect(at({ approach: 'plan', planAccepted: true, goalGaps: 9 })).toBe('choosing')
  })

  /**
   * The moment a live conversation got the wrong way round: Saoirse offered a choice of two
   * savings accounts and the customer replied with the right arrangement worked out alone.
   * With a kept plan and an arrangement to show, it is shown before any single product is.
   */
  it('arranges the money once, between keeping the plan and choosing', () => {
    expect(at({ approach: 'plan', planAccepted: true, arrangement: true })).toBe('arranging')
    expect(
      at({ approach: 'plan', planAccepted: true, arrangement: true, arrangementShown: true }),
    ).toBe('choosing')
  })

  it('does not arrange without a kept plan, however much it could', () => {
    expect(at({ approach: 'plan', goalGaps: 0, arrangement: true })).toBe('planning')
    expect(at({ approach: 'product', arrangement: true })).toBe('choosing')
  })

  it('still lets an application win over an unshown arrangement', () => {
    expect(at({ planAccepted: true, arrangement: true, applications: 1 })).toBe('applying')
  })

  it('applies once anything is started, whatever came before it', () => {
    expect(at({ applications: 1 })).toBe('applying')
    expect(at({ customerTurns: 1, applications: 1 })).toBe('applying')
    expect(at({ approach: 'plan', applications: 2 })).toBe('applying')
  })

  /**
   * The stage is read off the case every turn and never stored, so a customer who changes
   * their mind moves the conversation with them rather than carrying on from a position the
   * case no longer supports.
   */
  it('moves back when the case no longer supports where it was', () => {
    expect(at({ approach: 'plan', goalGaps: 1 })).toBe('planning')
    expect(at({ approach: null, goalGaps: 1 })).toBe('direction')
  })
})

describe('what a stage permits', () => {
  it('offers no product before the customer has chosen a direction', () => {
    expect(mayOfferProducts('opening')).toBe(false)
    expect(mayOfferProducts('direction')).toBe(false)
    expect(mayOfferProducts('discovering')).toBe(false)
    expect(mayOfferProducts('planning')).toBe(false)
    expect(mayOfferProducts('arranging')).toBe(true)
    expect(mayOfferProducts('choosing')).toBe(true)
    expect(mayOfferProducts('applying')).toBe(true)
  })

  it('proposes a plan only where one is being built', () => {
    expect(mayProposePlan('direction')).toBe(false)
    expect(mayProposePlan('discovering')).toBe(false)
    expect(mayProposePlan('planning')).toBe(true)
  })

  it('covers every stage, so adding one fails here rather than in a conversation', () => {
    for (const stage of STAGES) {
      expect(typeof mayOfferProducts(stage)).toBe('boolean')
    }
    expect(STAGES).toHaveLength(7)
  })
})
