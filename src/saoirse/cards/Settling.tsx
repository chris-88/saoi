import type { ReactNode } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { SettledCard } from '@/saoirse/cards/SettledCard'
import type { Settled } from '@/saoirse/cardState'
import { fade, useStill } from '@/lib/motion'

/**
 * A card becoming what happened to it.
 *
 * The offer and its outcome used to swap in a single render, both when the tap landed and when
 * the conversation was opened again later. Now they cross-fade, and the same component does it
 * on both paths, so a card looks the same the instant it settles and a day afterwards.
 *
 * Opacity only, with the outgoing card finishing before the incoming one starts. A height
 * animation would be nicer and is not allowed: it triggers layout, and the first motion rule is
 * that nothing here does. Under reduced motion there is no cross-fade, just the outcome.
 */
export function Settling({
  settled,
  children,
}: {
  readonly settled: Settled | undefined
  readonly children: ReactNode
}): ReactNode {
  const still = useStill()

  const outcome =
    settled === undefined ? null : (
      <SettledCard
        label={settled.label}
        {...(settled.note === undefined ? {} : { note: settled.note })}
      />
    )

  if (still) return outcome ?? children

  return (
    <AnimatePresence mode="wait" initial={false}>
      {outcome === null ? (
        <m.div key="live" {...fade}>
          {children}
        </m.div>
      ) : (
        <m.div key="settled" {...fade}>
          {outcome}
        </m.div>
      )}
    </AnimatePresence>
  )
}
