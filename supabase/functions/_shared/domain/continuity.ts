/**
 * Coming back, which is harder than leaving.
 *
 * Every visitor gets an anonymous auth user and `participant_sessions` maps it to their
 * participant, so returning in the same browser works by itself. Three other ways of returning
 * do not: storage cleared, a different device, and — on iOS — Safari and an installed PWA,
 * which are separate storage on the same phone. All three produce the same thing, a brand-new
 * empty case, and no amount of cookie will fix any of them, because a cookie lives in exactly
 * the storage that is missing. The only thing that crosses a storage boundary is the address
 * the person is carrying in their head.
 *
 * So signing in is the mechanism, and these are the two decisions it needs made for it:
 * whether the conversation they are standing in is worth bringing with them, and which of the
 * two conversations they then end up with should be the one on screen. Both are decided here,
 * from counts, rather than in the function that happens to be holding the request.
 */

/** What a case amounts to. Counts only: nothing here needs to read what anybody said. */
export type CaseSubstance = {
  readonly customerMessages: number
  readonly facts: number
  readonly applications: number
  readonly plans: number
}

/**
 * Whether this conversation should follow them onto the account.
 *
 * The motivating case is the empty one. Somebody returning on a new phone arrives, is given a
 * fresh case, signs in, and that fresh case is of no value to anybody: attaching it would put
 * an empty conversation into their switcher on every new device they ever used.
 *
 * Anything with work in it goes with them. A fact is work — it is a question they answered —
 * and so is a second message, which is the point where somebody is having a conversation
 * rather than saying hello and reconsidering.
 */
export function worthCarrying(substance: CaseSubstance): boolean {
  return (
    substance.applications > 0 ||
    substance.plans > 0 ||
    substance.facts > 0 ||
    substance.customerMessages >= 2
  )
}

export type LandingChoice = { readonly on: 'prior' | 'account' }

/**
 * Which conversation is open when they look up.
 *
 * The account's wins whenever it has one, including over a new conversation with work in it.
 * Somebody who signs in is reaching for something they already had; the one they started two
 * minutes ago by arriving is incidental to that, and `worthCarrying` has already made sure it
 * is attached and reachable from the switcher. This decides what is on screen, never what is
 * kept.
 */
export function landingFor(input: {
  readonly prior: CaseSubstance
  readonly accountHasConversation: boolean
}): LandingChoice {
  return { on: input.accountHasConversation ? 'account' : 'prior' }
}

/**
 * Somebody saying, in a first message, that this is not their first visit.
 *
 * Deliberately narrow, and built to miss rather than to catch. The way back in is permanently
 * in the menu, so a miss costs one tap; a false positive puts a sign-in card in front of a new
 * customer who said something ordinary, which is the login wall this product exists not to be.
 *
 * Phrases rather than a classifier, for the reason the gate's pre-checks are deterministic:
 * this decides whether a card appears, and a card appearing is not something to leave to a
 * model's reading of a sentence. It is also free, and it runs on a turn that is already paid
 * for.
 */
export function soundsLikeReturning(message: string): boolean {
  const said = message.toLowerCase().replace(/\s+/g, ' ').trim()
  if (said.length === 0) return false

  return RETURNING.some((pattern) => pattern.test(said))
}

/**
 * Each one has to be something nobody says on a genuine first visit.
 *
 * `talked to you` is in and bare `talked` is not, because "I talked to my wife about this" is
 * an ordinary opening line. `where i left off` is in and bare `before` is not, for the same
 * reason in a shorter sentence.
 */
const RETURNING: readonly RegExp[] = [
  /\b(spoke|talked|chatted|was speaking|was talking) (to|with) (you|saoirse|saoi)\b/,
  /\bwhere i left off\b/,
  /\b(been|was) here before\b/,
  /\bi(?:'| a)?m back\b/,
  /\bmy (previous |last |earlier )?conversation\b/,
  /\blast time\b/,
  /\bwe (spoke|talked|discussed)\b/,
]
