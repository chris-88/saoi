import type { Card } from '../contracts/cards.ts'
import type { LoadedCase } from '../db/loaded-case.ts'

/**
 * The invitation to sign in, at the point where it is worth something.
 *
 * Not a tool, for the same reason the data notice is not: the model must not be able to summon
 * it, skip it, or decide that now is a good moment to ask. Where to put it is a product
 * decision and it is made here.
 *
 * Timing is the whole argument. Asked on arrival it is a login wall in front of a conversation
 * nobody has had yet, and the thing Saoirse is trying not to be. Asked after a plan has been kept
 * or an application started, it is offering to hold on to something that already exists,
 * which is both true and the only honest reason to ask.
 */
export const SIGN_IN_PROMPT_EVENT = 'sign_in_offered'

/**
 * What the app sends, as an `action` turn, once somebody has signed in (`SaoirseChat` in
 * saoi-web, both the in-place code path and the reload after Google or a link). Stored as the
 * system message "Signed in." and answered by a turn.
 */
export const SIGNED_IN_ACTION = 'Signed in.'

export function isSignedInAction(trigger: string, message: string | undefined): boolean {
  return trigger === 'action' && message?.trim() === SIGNED_IN_ACTION
}

/**
 * The sign-in already answered on this case, if it has been: the id of the newest "Signed in."
 * system message written at or after the case was signed in (`customer_signed_in`, written once,
 * when the case becomes authenticated), or of any one when no sign-in was recorded. Null when
 * this one is the first. Pure.
 *
 * 2026-11-13: one claimed-plan case had four "Signed in." messages and four greetings in a day.
 * Each followed a separate Google login with the same account (two on the phone, two on a Mac
 * fifteen seconds apart), each landing in the same conversation, and the app greets every
 * landing. One sign-in, one message: a later landing on a case already answered writes nothing.
 */
export function signInAnswered(
  signedInAt: string | null,
  latest: { readonly id: string; readonly createdAt: string } | null,
): string | null {
  if (latest === null) return null
  if (signedInAt === null) return latest.id
  return Date.parse(latest.createdAt) >= Date.parse(signedInAt) ? latest.id : null
}

/**
 * Whether there is now something a sign-in would protect.
 *
 * Deliberately narrow. An application or a kept plan is work the customer would be annoyed to
 * lose; a conversation on its own is not, and asking after a couple of messages is the version
 * of this that reads as a demand for an email address.
 */
export function worthSigningInFor(loaded: LoadedCase): boolean {
  if (loaded.authLevel === 'authenticated') return false
  return loaded.applications.length > 0
}

export function signInPromptCard(whyHref: string): Card {
  return {
    type: 'sign_in',
    title: 'Save this with Saoirse',
    points: [
      'Keep what you have started, and pick it up later',
      'Carry on from your phone, or any other device',
      'Hear from Saoirse when something moves',
    ],
    /*
     * Said plainly, because the moment somebody is asked for an address by something wearing a
     * bank's name is the moment they wonder what they are actually agreeing to.
     */
    reassurance: 'This does not open a Demo Bank account or apply for anything.',
    whyHref,
  }
}
