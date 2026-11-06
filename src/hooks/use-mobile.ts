import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${String(MOBILE_BREAKPOINT - 1)}px)`

/**
 * Whether the viewport is phone-sized.
 *
 * The generated version of this hook held the answer in state and wrote to it from an effect,
 * which renders once with the wrong answer and again with the right one — and is what the lint
 * rule about synchronous setState in effects is there to catch. A media query is an external
 * store, so it is read as one: subscribed to for changes, sampled directly for the value.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches
}

/** No window to measure, so assume the desktop layout; hydration corrects it immediately. */
function getServerSnapshot(): boolean {
  return false
}
