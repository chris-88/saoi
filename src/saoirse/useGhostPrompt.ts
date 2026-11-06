import { useEffect, useState } from 'react'

/** How fast it types, deletes, and how long it rests on a finished line. Milliseconds. */
const TYPE = 45
const DELETE = 25
const HOLD = 1_800
const BETWEEN = 400

/**
 * Sample openers, typed out in the empty composer.
 *
 * These replaced a row of tappable suggestions, which cost a tap less but read as a menu — and
 * a menu of five situations quietly contradicts the one claim this product makes, that you do
 * not have to pick from a list. Typing them into the box instead says "something like this, in
 * your own words" without narrowing it to five.
 */
export const GHOST_PROMPTS: readonly string[] = [
  'We’re hoping to buy a place next year…',
  // Somebody the bank has never met, which is the conversation it most wants to have.
  'I’m starting a new job and need a bank account…',
  'We’ve just had a baby…',
  'I’m moving in with my partner…',
  'I want to get on top of my money…',
  'I’ve something big coming up…',
  'Honestly, I’m not sure where to start…',
]

/**
 * One line at a time, typed and deleted, while the box is empty.
 *
 * Stops the moment anything is typed, because an animation under live text is a distraction
 * rather than a hint. Returns a static line under `prefers-reduced-motion` — the suggestion is
 * the point, the typing is decoration, and the decoration is what some people cannot tolerate.
 */
export function useGhostPrompt(active: boolean): string {
  const [typed, setTyped] = useState('')

  /*
   * Read once, at first render rather than in an effect. Somebody changing this setting
   * mid-conversation is not a case worth a listener, and every other path here sets state from
   * a timer, which keeps the effect free of synchronous renders.
   */
  const [reduced] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    if (!active || reduced) return

    let line = 0
    let shown = 0
    let deleting = false
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = (): void => {
      if (cancelled) return

      const full = GHOST_PROMPTS[line] ?? ''
      shown += deleting ? -1 : 1
      setTyped(full.slice(0, shown))

      let next: number = deleting ? DELETE : TYPE

      if (!deleting && shown >= full.length) {
        deleting = true
        next = HOLD
      } else if (deleting && shown <= 0) {
        deleting = false
        line = (line + 1) % GHOST_PROMPTS.length
        next = BETWEEN
      }

      timer = setTimeout(tick, next)
    }

    timer = setTimeout(tick, BETWEEN)

    return () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [active, reduced])

  if (!active) return ''
  return reduced ? (GHOST_PROMPTS[0] ?? '') : typed
}
