import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether the viewport is under a given width.
 *
 * Separate from `useIsMobile`, which is fixed at the phone breakpoint and is what the sidebar
 * uses. Some layouts stop working well before a phone: three resizable panels need something
 * closer to a laptop, and asking "is this a phone" would answer the wrong question for them.
 *
 * A media query is an external store, so it is read as one — subscribed to for changes and
 * sampled directly for the value, rather than held in state and written from an effect, which
 * renders once with the wrong answer.
 */
export function useIsNarrow(maxWidth: number): boolean {
  const query = `(max-width: ${String(maxWidth - 1)}px)`

  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined
      const media = window.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    [query],
  )

  const getSnapshot = useCallback(
    (): boolean =>
      typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false,
    [query],
  )

  // Nothing to measure without a window, so assume the wide layout; the first client render
  // corrects it.
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
