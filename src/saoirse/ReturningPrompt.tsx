import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ANONYMOUS, currentIdentity, lastKnownAddress, maskedAddress } from '@/lib/identity'
import { SignInForm } from '@/saoirse/SignInForm'
import { Reveal } from '@/components/Primitives'
import { isInstalled } from '@/lib/installed'

/**
 * The way back, offered to the one person it applies to.
 *
 * Returning in the same browser works by itself: the anonymous user is in storage and
 * `participant_sessions` maps it to the conversation. Three other returns do not — storage
 * cleared, a different device, and Safari against an installed app, which are separate storage
 * on the same phone — and all three produce an empty new conversation with no sign that
 * anything else exists. The menu holds the way back for them, but nobody looks in a menu for a
 * thing they do not know is there.
 *
 * So it is offered on the opening screen, and only where there is evidence it means something:
 * an address this browser has signed in with before, and nobody signed in now. A first-time
 * visitor sees nothing, which is the point — the opening screen asks one question and waits,
 * and a sign-in on it would be the login wall this product is trying not to be.
 *
 * It cannot help somebody whose browser has never signed in here. Nothing can, short of asking
 * every arrival for an address, and that trade is not worth making.
 */
export function ReturningPrompt(): ReactNode {
  const [open, setOpen] = useState(false)

  const identity = useQuery({
    queryKey: ['identity'],
    queryFn: () => currentIdentity(),
    initialData: ANONYMOUS,
  })

  const address = lastKnownAddress()
  const installed = isInstalled()

  if (!identity.data.anonymous) return null
  if (address === null && !installed) return null

  /*
   * The installed app's first open.
   *
   * A home-screen web app on iOS has its own storage, separate from Safari: no session, no
   * remembered address, nothing carried across. That is the platform's rule, and it meant the
   * installed app opened cold, with the way back in hidden in a menu, moments after somebody
   * had signed in and been told to open it from the home screen. The one thing known for
   * certain is that they came from a conversation, because that is why anybody installs. So
   * the form is open already, and the address field is the first thing on screen.
   */
  if (open || (installed && address === null)) {
    return (
      <Reveal mode="mount" className="mt-8 w-full max-w-xs text-left">
        {address === null && (
          <p className="text-muted-foreground mb-3 text-center text-xs leading-relaxed">
            Saoirse is on your home screen. Sign in with the address you used in Safari and your
            conversation is here.
          </p>
        )}
        <SignInForm {...(address === null ? {} : { knownAddress: address })} />
      </Reveal>
    )
  }

  // Only reachable with an address: an installed app without one opened the form above.
  if (address === null) return null

  return (
    <div className="text-muted-foreground mt-8 max-w-xs text-xs leading-relaxed">
      <p>
        Been here before?{' '}
        <button type="button" className="text-foreground underline" onClick={() => setOpen(true)}>
          Pick up where you left off
        </button>{' '}
        and Saoirse will send a code to {maskedAddress(address)}.
      </p>
    </div>
  )
}
