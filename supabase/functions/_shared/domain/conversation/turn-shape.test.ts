import { describe, expect, it } from 'vitest'
import { asksSomething } from './turn-shape.ts'

describe('whether a reply is asking the customer something', () => {
  /**
   * The turn this was built from, verbatim.
   *
   * A comparison of two savings accounts went on screen with this underneath it, so the
   * customer was asked to tap one card and answer two questions in the same breath.
   */
  it('hears the turn that caused this', () => {
    expect(
      asksSomething(
        'First job is getting the deposit into one place that’s built for it. For first-time ' +
          'buyers saving monthly, two accounts fit, and they can run side by side.\n\n' +
          'MortgageSaver is the one tied to the mortgage bonus, while SuperSaver pays a higher ' +
          'fixed rate for the first year but takes no lump sums. Before you pick, what do you ' +
          'pay in rent each month, and do you and your wife run your money jointly or ' +
          'separately day to day?',
      ),
    ).toBe(true)
  })

  /**
   * The same sentence with the mark left off, which is how it was written the first time.
   *
   * A detector that keys on punctuation alone would have watched this go past, and Saoirse drops
   * the question mark often enough that it cannot be the only thing being looked for.
   */
  it('hears a question with no question mark on it', () => {
    expect(
      asksSomething('Before you pick, do you and your wife run your money jointly day to day'),
    ).toBe(true)
    expect(asksSomething('Two accounts fit. What do you pay in rent each month')).toBe(true)
  })

  it('hears the short ones', () => {
    expect(asksSomething('All three are started. Would you like to?')).toBe(true)
    expect(asksSomething('Shall I put that in the plan')).toBe(true)
  })

  /**
   * A card turn is allowed to say what the card is for. It is saying it as a statement that
   * matters, and prose about what something means is not an interrogation.
   */
  it('does not hear a question in an ordinary statement', () => {
    for (const said of [
      'Here is how the money would split across the three.',
      'That structure works, and the bonus is worth more than any rate difference.',
      'What this means is that the lump sum earns less where it is.',
      'Bringing the two pots together is the right first move.',
      'The plan covers the deposit, the mortgage and protection, in that order.',
      'You can see what each one does, and what it costs you to use it.',
      'I have put the three accounts on screen for you.',
    ]) {
      expect(asksSomething(said), said).toBe(false)
    }
  })

  it('says no to nothing at all', () => {
    expect(asksSomething('')).toBe(false)
    expect(asksSomething('   \n  ')).toBe(false)
  })
})
