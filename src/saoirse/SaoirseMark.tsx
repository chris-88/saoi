import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Saoirse's icon, from `brand/saoirse-face.svg`.
 *
 * A stem with a flat-topped end and a ring for its bowl, with two square eyes inside the bowl:
 * the first letter of the name, which is the point: the thing in the middle of the opening
 * screen and the first letter of the name are one object.
 *
 * Drawn here rather than imported as a file so it can take a colour. The artwork is a single
 * colour; `currentColor` is what lets the same component sit in the brand teal, in a muted
 * header, and on a dark ground without a second asset.
 *
 * Not square — 64 by 72, because the stem rises above the bowl. `preserveAspectRatio` keeps it
 * honest inside a square slot rather than stretching the ring into an oval.
 */
export function SaoirseMark({
  className,
  breathing = false,
  title,
}: {
  readonly className?: string
  /**
   * Idle motion, for the hero state only (opening-transition spec §3).
   *
   * A slow scale, and nothing else. No bounce, no halo, no spin — the spec is explicit about
   * which of those reads as present and which reads as a gimmick.
   */
  readonly breathing?: boolean
  /**
   * An accessible name. Omitted where visible "Saoirse" text sits beside it, which is the usual
   * case — a decorative repeat of an adjacent word is noise to a screen reader (spec §16).
   */
  readonly title?: string
}): ReactNode {
  const labelled = title !== undefined

  return (
    <svg
      viewBox="0 0 64 72"
      className={cn('size-full', breathing && 'saoirse-mark-breathe', className)}
      {...(labelled
        ? { role: 'img' as const, 'aria-label': title }
        : { 'aria-hidden': true as const })}
    >
      <g stroke="currentColor">
        <path
          d="M7 40C7 26.1929 18.1929 15 32 15C45.8071 15 57 26.1929 57 40C57 53.8071 45.8071 65 32 65C18.1929 65 7 53.8071 7 40ZM7 40V0"
          strokeWidth="14"
        />
        <path d="M22 37H28" strokeWidth="6" />
        <path d="M37 37H43" strokeWidth="6" />
      </g>
    </svg>
  )
}
