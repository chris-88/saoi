import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ANONYMOUS, currentIdentity } from '@/lib/identity'
import { platform, useInstallPrompt, useInstalled } from '@/lib/installed'

/**
 * Whether to offer the home screen, and when.
 *
 * Offered where it means something: to somebody signed in, in a conversation, in a browser
 * tab. Signing in is the moment they decided this was worth keeping, and keeping it on the
 * home screen is the natural next sentence. Not on arrival, which would be a wall; not inside
 * the installed app, which would be absurd; and not twice on one device.
 *
 * Once per device rather than once per case, because installing is a property of the device.
 * The same case on a laptop should not have used up the phone's one offer.
 */
const OFFERED_KEY = 'saoi.installOffered'

function offeredBefore(): boolean {
  try {
    return window.localStorage.getItem(OFFERED_KEY) === '1'
  } catch {
    return true
  }
}

export function useInstallOffer(): {
  readonly offer: boolean
  readonly dismiss: () => void
} {
  const installed = useInstalled()
  const prompt = useInstallPrompt()
  const identity = useQuery({
    queryKey: ['identity'],
    queryFn: () => currentIdentity(),
    initialData: ANONYMOUS,
  })
  const [dismissed, setDismissed] = useState(offeredBefore)

  const dismiss = useCallback(() => {
    setDismissed(true)
    try {
      window.localStorage.setItem(OFFERED_KEY, '1')
    } catch {
      // No storage, so it may be offered again next time. Better than never.
    }
  }, [])

  /*
   * iPhone always has a route: the Share sheet. Anything else is offered only when the
   * browser is holding a prompt for us. Telling somebody to look for an icon in the address
   * bar is a shrug, not an offer, and a button that cannot do anything is a dead control.
   */
  const possible = platform() === 'ios' || prompt !== null

  return {
    offer: !installed && !dismissed && !identity.data.anonymous && possible,
    dismiss,
  }
}
