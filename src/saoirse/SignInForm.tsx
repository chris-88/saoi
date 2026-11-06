import { useState, type ReactNode } from 'react'
import { MailIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AnimatePresence, m } from 'motion/react'
import { fade, useStill } from '@/lib/motion'
import { useSignInSignal } from '@/saoirse/signInSignal'
import {
  clearSignInError,
  forgetKnownAddress,
  lastSignInError,
  maskedAddress,
  startEmailSignIn,
  verifyEmailCode,
} from '@/lib/identity'

/**
 * Address, then code. The whole of signing in to Saoirse.
 *
 * Shared by the card Saoirse offers mid-conversation and by the menu, because they are the same
 * two steps and a second copy of them is a second thing to get wrong: the length of the code,
 * the order of the code and the link, and what happens on success all have to match, and the
 * last time two sign-in paths drifted apart one of them stopped working for a week.
 *
 * Email only. There is no other provider and nothing to choose between.
 */

/**
 * How many digits the field will take.
 *
 * Supabase allows six to ten and the project is pushed to six, so six is what the copy says.
 * The range is here rather than a single number because the authority for the real length is
 * the hosted auth config, which this bundle cannot read: accepting the range means a config
 * that drifts produces a rejected code with a reason, rather than a code silently cut short.
 */
const MIN_CODE = 6
const MAX_CODE = 10

export function SignInForm({
  disabled,
  knownAddress,
}: {
  disabled?: boolean
  /**
   * The address this browser signed in with before, if it has.
   *
   * Turns the first step into one tap on a masked address instead of typing it again, with a
   * way out: a demo device gets handed around, and "not me" has to be reachable without
   * signing in as the previous person first.
   */
  knownAddress?: string
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const markSignedIn = useSignInSignal((signal) => signal.markSignedIn)
  const still = useStill()

  /*
   * A sign-in that failed on the way back has nowhere else to appear.
   *
   * `completeSignIn` runs before React mounts, so it leaves the reason behind, and this is on
   * screen afterwards. Read as the initial value rather than in an effect: an effect that sets
   * state on mount is a cascading render, and the read is deliberately non-destructive so
   * StrictMode's second pass does not swallow the message. It is cleared when they try again.
   */
  const [error, setError] = useState<string | null>(() => lastSignInError())

  const [email, setEmail] = useState(knownAddress ?? '')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')

  /** Dropped when they say it is not them, or when they ask to type a different one. */
  const [known, setKnown] = useState<string | null>(knownAddress ?? null)

  const notMe = () => {
    forgetKnownAddress()
    setKnown(null)
    setEmail('')
  }

  const enterCode = () => {
    if (busy) return
    setBusy(true)
    setError(null)
    void verifyEmailCode(email, code).then((result) => {
      setBusy(false)
      if (result.ok) {
        /*
         * The session is live. The conversation is told rather than the page reloaded: it
         * refreshes the identity, re-runs the session so the server attaches the address,
         * settles this card in place and has Saoirse pick up. A reload did all of that by force,
         * with a white flash and three things popping into place.
         */
        markSignedIn()
        return
      }
      setError(result.message ?? 'That did not work.')
    })
  }

  const sendCode = () => {
    if (busy) return
    setBusy(true)
    setError(null)
    clearSignInError()
    void startEmailSignIn(email).then((result) => {
      setBusy(false)
      if (result.ok) setSent(true)
      else setError(result.message ?? 'That did not work.')
    })
  }

  const stage = sent ? 'code' : known !== null ? 'known' : 'address'

  /*
   * The three stages used to be bare conditional branches, so going from "send a code" to
   * "enter it" was a swap between two unrelated blocks. One fade out, one fade in, in order.
   */
  return (
    <div className="space-y-2">
      <AnimatePresence mode="wait" initial={false}>
        {/* Spreads nothing when still, as the explainer does: the wrapper stays, the motion goes. */}
        <m.div key={stage} {...(still ? {} : fade)}>
          {sent ? (
            /*
             * The code first, the link second, and that order is the whole point.
             *
             * On an installed app a link opens in the browser, which is a different session and
             * looks exactly like losing the conversation. iOS has no way back into an installed
             * web app, so the fix is not to leave: read six digits, come back, type them here.
             */
            <>
              <p className="text-center text-sm font-medium">
                Check your email and enter the six digits.
              </p>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                /*
                 * Six is what the project sends and what the copy says, and the field still takes
                 * more than six.
                 *
                 * How long the code is lives in the hosted auth config, not in this bundle, and it
                 * was quietly on eight while every number here was six: the email sent eight
                 * digits, the input dropped the last two, and signing in was impossible. The
                 * length is pushed from `scripts/push-auth-templates.mjs` now, so the two agree —
                 * but a field that truncates cannot tell anybody what went wrong, and one that
                 * accepts the whole code lets the server reject it with a reason.
                 */
                maxLength={MAX_CODE}
                placeholder="000000"
                aria-label="The code from your email"
                className="text-center text-lg tracking-[0.4em] tabular-nums"
                value={code}
                disabled={(disabled ?? false) || busy}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, '').slice(0, MAX_CODE))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') enterCode()
                }}
              />
              <Button
                className="w-full"
                disabled={(disabled ?? false) || busy || code.length < MIN_CODE}
                onClick={enterCode}
              >
                {busy ? 'Checking…' : 'Continue'}
              </Button>
              <p className="text-muted-foreground text-center text-xs leading-relaxed">
                There is a link in the email too, but it opens a browser. The code keeps you here,
                in this conversation.
              </p>
            </>
          ) : known !== null ? (
            <>
              <Button className="w-full" disabled={(disabled ?? false) || busy} onClick={sendCode}>
                <MailIcon className="size-4" />
                {busy ? 'Sending…' : `Send a code to ${maskedAddress(known)}`}
              </Button>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground w-full text-center text-xs underline"
                onClick={notMe}
              >
                Not me, or a different address
              </button>
            </>
          ) : (
            <>
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                aria-label="Your email address"
                value={email}
                disabled={(disabled ?? false) || busy}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') sendCode()
                }}
              />
              <Button
                className="w-full"
                disabled={(disabled ?? false) || busy || email.trim().length === 0}
                onClick={sendCode}
              >
                <MailIcon className="size-4" />
                {busy ? 'Sending…' : 'Send me a code'}
              </Button>
            </>
          )}
        </m.div>
      </AnimatePresence>

      {error !== null && <p className="text-destructive text-center text-xs">{error}</p>}
    </div>
  )
}
