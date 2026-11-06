import { useEffect, useState } from 'react'

/**
 * Where Saoirse is running, as far as installing it is concerned.
 *
 * Three facts the install moment turns on, none of which the app knew until now: whether it
 * is already running as an installed app, whether this is an iPhone (where Safari has no
 * install prompt and the only route is the Share sheet), and whether the browser has offered
 * a native prompt it is holding for us.
 *
 * The first one is the one that was missing. With no `standalone` check anywhere, the
 * installed app still showed "Install Saoirse" on its own landing page.
 */

/** Running from the home screen, rather than in a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true
  // Safari's own flag, which predates the media query and is still what iOS sets.
  const apple = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return standalone || apple
}

export type Platform = 'ios' | 'android' | 'desktop'

/**
 * iOS is the one that matters: no `beforeinstallprompt`, no API at all, Share sheet only. The
 * iPad check is for the ones that report themselves as a Mac.
 */
export function platform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop'
  const agent = navigator.userAgent
  const touchMac = agent.includes('Macintosh') && navigator.maxTouchPoints > 1
  if (/iPhone|iPad|iPod/.test(agent) || touchMac) return 'ios'
  if (/Android/.test(agent)) return 'android'
  return 'desktop'
}

/** The event Chrome and Edge fire when they are willing to install. Safari never does. */
export type InstallPromptEvent = Event & {
  readonly prompt: () => Promise<void>
}

/**
 * The browser's native install prompt, held until something wants it.
 *
 * Captured once per page rather than per button: the event fires once, early, and whichever
 * component listens first wins. Shared here so the landing page's button and the card in the
 * conversation see the same thing.
 */
let captured: InstallPromptEvent | null = null
const listeners = new Set<(event: InstallPromptEvent | null) => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    captured = event as InstallPromptEvent
    for (const listener of listeners) listener(captured)
  })
  window.addEventListener('appinstalled', () => {
    captured = null
    for (const listener of listeners) listener(null)
  })
}

export function useInstallPrompt(): InstallPromptEvent | null {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(captured)

  useEffect(() => {
    listeners.add(setPrompt)
    return () => {
      listeners.delete(setPrompt)
    }
  }, [])

  return prompt
}

/** Re-checked when the app becomes visible, because installing changes it without a reload. */
export function useInstalled(): boolean {
  const [installed, setInstalled] = useState(isInstalled)

  useEffect(() => {
    const refresh = () => setInstalled(isInstalled())
    window.addEventListener('appinstalled', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('appinstalled', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  return installed
}
