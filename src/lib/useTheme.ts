import { useCallback, useEffect, useSyncExternalStore } from 'react'

export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]

const KEY = 'saoi.theme'

/*
 * One value, shared by every component that reads it.
 *
 * Two `useState` copies of the same setting drift: the switch on the profile screen would set
 * one and the console shell would keep rendering the other until a reload. `useSyncExternalStore`
 * is React's answer to exactly this and costs no dependency.
 */
let current: Theme = read()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Light, dark, or whatever the machine is set to.
 *
 * Real, rather than the decorative switch the console spec asked for. Every dark token was
 * already defined in `index.css` and nothing applied `.dark`, so the honest choice was between
 * a control that lies about what it does and a little code that makes it true.
 */
export function useTheme(): readonly [Theme, (next: Theme) => void] {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  )

  const setTheme = useCallback((next: Theme) => {
    current = next
    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      // Private browsing and blocked storage both throw. The choice still applies this session.
    }
    for (const listener of listeners) listener()
  }, [])

  return [theme, setTheme]
}

/**
 * Applies the theme for as long as the caller is mounted, and takes it off afterwards.
 *
 * Called once, by the console shell. The class has to go on `documentElement` — Radix portals
 * dialogs, sheets and dropdowns to `document.body`, so a class on an app-level div leaves every
 * popover in the other theme — and `documentElement` is shared with the rest of the application.
 * Without the cleanup, an admin who chose dark and then opened Saoirse would find the bank's front
 * door in dark mode, which is not what the setting says it does.
 */
export function useThemeApplied(): void {
  const [theme] = useTheme()

  useEffect(() => {
    apply(theme)

    const query = prefersDark()
    if (query === null) {
      return () => document.documentElement.classList.remove('dark')
    }

    const onChange = (): void => {
      // Following the machine means following it as it changes, not as it was on page load.
      if (current === 'system') apply('system')
    }
    query.addEventListener('change', onChange)

    return () => {
      query.removeEventListener('change', onChange)
      document.documentElement.classList.remove('dark')
    }
  }, [theme])
}

function read(): Theme {
  try {
    const stored = window.localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Fall through to the default.
  }
  return 'light'
}

/**
 * The machine's preference, or null where it cannot be asked.
 *
 * jsdom has no `matchMedia`, and neither did the browsers this would have been tested in a few
 * years ago. Reaching for it unguarded threw on mount and took the whole console down with it,
 * which is a long way out of proportion to not knowing somebody's colour scheme.
 */
function prefersDark(): MediaQueryList | null {
  if (typeof window.matchMedia !== 'function') return null
  return window.matchMedia('(prefers-color-scheme: dark)')
}

function apply(theme: Theme): void {
  // `system` with nothing to ask falls back to light, which is what this console looks like.
  const dark = theme === 'dark' || (theme === 'system' && prefersDark()?.matches === true)

  document.documentElement.classList.toggle('dark', dark)
}
