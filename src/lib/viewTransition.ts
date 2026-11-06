/**
 * A shared-element transition, where the browser can do one.
 *
 * The opening animation is one object moving: the mark waiting in the middle of the screen
 * becomes the avatar beside Saoirse's first reply (spec §5). The View Transitions API does exactly
 * that from two `view-transition-name` declarations and no library — the browser takes a
 * snapshot either side of the DOM change and tweens between them.
 *
 * Where it is missing, or where somebody has asked for less motion, the update still happens.
 * It just happens at once, which is the documented fallback (§14) rather than a degraded path
 * worth apologising for.
 */
export function withViewTransition(update: () => void | Promise<void>): void {
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (reduced || typeof document.startViewTransition !== 'function') {
    void update()
    return
  }

  /*
   * The browser snapshots the page, runs `update`, waits for whatever it returns, and snapshots
   * again. So `update` has to have changed the DOM by the time it settles: an update that only
   * queues a React state change hands the browser an "after" that looks like the "before",
   * and the morph it was asked for becomes a plain exit. The caller commits synchronously with
   * `flushSync` for exactly this reason.
   */
  document.startViewTransition(() => update())
}
