import { useEffect, useState } from 'react'

/**
 * Holds a flag on for a moment after it goes off (spec §6).
 *
 * Turns come back in about a second, and sometimes much less. Without this the thinking state
 * can appear and vanish inside a frame, which reads as a flicker rather than as an answer
 * arriving. It only ever extends: the answer is never delayed, and the text streams in
 * underneath regardless.
 *
 * The clear is always scheduled rather than sometimes immediate — a `setTimeout` of zero still
 * runs after the render, which keeps every state change here out of the render pass. `Date.now`
 * is only ever called inside an effect, never while rendering.
 */
export function useMinimumDuration(active: boolean, ms: number): boolean {
  /** When the flag last came on, or 0 when it is not being held. */
  const [since, setSince] = useState(0)

  useEffect(() => {
    if (!active) return
    const started = Date.now()
    const timer = setTimeout(() => setSince(started), 0)
    return () => clearTimeout(timer)
  }, [active])

  useEffect(() => {
    if (active || since === 0) return

    const timer = setTimeout(() => setSince(0), Math.max(0, ms - (Date.now() - since)))
    return () => clearTimeout(timer)
  }, [active, since, ms])

  return active || since !== 0
}
