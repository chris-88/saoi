import { create } from 'zustand'

/**
 * That a sign-in has just happened, for whoever is listening.
 *
 * The sign-in form is one component in three places: the card Saoirse offers, the menu, and the
 * prompt on the opening screen. None of them is the conversation, and the conversation is what
 * has to respond: refresh the identity, re-run the session so the server attaches the address
 * and loads what it knows, settle the card, and have Saoirse say something. A page reload used to
 * do all of that by force, with a white flash and three things popping into place.
 *
 * Ephemeral UI state, which is what Zustand is for here. Nothing persists; the conversation
 * acknowledges the signal once it has acted on it.
 */
type SignInSignal = {
  readonly signedInAt: number | null
  readonly markSignedIn: () => void
  readonly acknowledge: () => void
}

export const useSignInSignal = create<SignInSignal>((set) => ({
  signedInAt: null,
  markSignedIn: () => set({ signedInAt: Date.now() }),
  acknowledge: () => set({ signedInAt: null }),
}))
