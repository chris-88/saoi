import { useReducedMotion } from 'motion/react'

/**
 * One motion grammar for the whole product.
 *
 * The explainer settled it by use: four durations, one easing curve, entries that rise a few
 * pixels as they fade in. The conversation had none of it and was never meant to, and the two
 * surfaces read as different products as a result. These are the explainer's numbers, named,
 * mirrored by the `--motion-*` tokens in `index.css` for the few places CSS does the moving.
 *
 * Three rules, from `docs/design/motion.md`, unchanged:
 *
 *   1. Scale, translate and opacity only. Nothing that triggers layout or paint.
 *   2. Under `prefers-reduced-motion` everything stops. Not reduces: stops. `useStill()` is
 *      how a component asks, and the presets are spread conditionally on it.
 *   3. The opening morph (the mark becoming the avatar) stays on View Transitions.
 */

export const DURATION = {
  /** Hover, press, a state flip. */
  fast: 0.2,
  /** Most things: a badge appearing, a row settling. */
  base: 0.3,
  /** An entry. A card arriving, a section revealing. */
  slow: 0.45,
} as const

/** The one curve. Fast out, long settle; nothing bounces. */
export const EASE = [0.16, 1, 0.3, 1] as const

/** Rise and fade in. The explainer's `Reveal`, as props to spread on an `m.div`. */
export const enter = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DURATION.slow, ease: EASE },
} as const

/** Fade only, for something replacing something else in the same place. */
export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATION.base, ease: EASE },
} as const

/** Entries that follow one another, `index * stagger` apart. */
export const STAGGER = 0.12

/**
 * Whether to hold still.
 *
 * `true` under `prefers-reduced-motion: reduce`, in which case a component renders its final
 * state and spreads nothing. Named for what the caller does with it rather than for the media
 * query, because "reduced" is the wrong word for what happens: it stops.
 */
export function useStill(): boolean {
  return useReducedMotion() === true
}
