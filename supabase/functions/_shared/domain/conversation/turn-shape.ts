/**
 * What else a turn is doing, besides the card it put on screen.
 *
 * A card that waits for a tap is the question of that turn. Saoirse was showing a comparison of two
 * savings accounts and, underneath it, asking what the customer paid in rent and whether they
 * banked jointly — three demands in one breath, and whichever the customer answered, the others
 * were left hanging. The card is also the thing that gets scrolled past when there is text under
 * it to reply to.
 *
 * The rule is declared in the stage guides and in the tool descriptions, where the model reads
 * it at the point of deciding. This is the other half: a deterministic check that says whether
 * it was followed, so that breaking it leaves a row behind rather than only a screenshot. It
 * cannot unsay the words — they are already streamed — but it can stop being invisible, which
 * is the same bargain `card_promised_not_shown` makes.
 */

/**
 * Whether this reply asks the customer something.
 *
 * Punctuation is not enough on its own. The turn that prompted all of this was written once
 * without a question mark at the end and read exactly the same way, so an interrogative opening
 * counts whether or not anybody closed it properly.
 */
export function asksSomething(text: string): boolean {
  const said = text.replace(/\s+/g, ' ').trim()
  if (said.length === 0) return false

  if (said.includes('?')) return true

  /*
   * A question asked without the mark, which is nearly always the last thing said.
   *
   * Scoped to the final sentence on purpose. "What this means is that the lump sum earns less"
   * is an explanation, and an interrogative looked for anywhere in a paragraph finds dozens of
   * those. At the end of a turn, after a card, it is a question.
   */
  const sentences = said.split(/(?<=[.!])\s+/).filter((part) => part.trim().length > 0)
  const last = sentences[sentences.length - 1] ?? said

  return WH_QUESTION.test(last) || YES_NO_QUESTION.test(last)
}

/**
 * What actually distinguishes a question from an explanation: the verb moves.
 *
 * "What do you pay" inverts the auxiliary in front of the subject. "What it costs you" and
 * "where it is" do not, and both are ordinary things to say about money in the middle of a
 * sentence — the first version of this matched them, and would have raised an event on every
 * turn that explained anything.
 *
 * Anchored to the start of the sentence or to a clause boundary, because that is where a
 * question begins and nowhere else.
 */
const OPENS = String.raw`(?:^|[,;:]\s*(?:and\s+|or\s+|but\s+)?)`
const AUX = String.raw`(?:do|does|did|are|is|was|were|would|could|can|have|has|will|shall|should|am)`
const SUBJECT = String.raw`(?:you|your|i|we|they|it|there|that|he|she)`
const WH = String.raw`(?:what|which|when|where|why|who|whose|how(?:\s+(?:much|many|long|soon|often))?)`

/** `what do you pay`, `how much have you saved`. */
const WH_QUESTION = new RegExp(`${OPENS}${WH}\\s+${AUX}\\s+${SUBJECT}\\b`, 'i')

/** `do you bank jointly`, `shall I put that in the plan`. */
const YES_NO_QUESTION = new RegExp(`${OPENS}${AUX}\\s+${SUBJECT}\\b`, 'i')
