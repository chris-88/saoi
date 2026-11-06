import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Saoirse's icon, from `brand/saoirse-face.svg`.
 *
 * A ring with a squared top-left corner and two square eyes:
 * the thing in the middle of the opening screen is the same object as the mark, which is the point: the thing in the middle of the opening
 * screen and the first letter of the name are one object.
 *
 * Drawn here rather than imported as a file so it can take a colour. The artwork is a single
 * colour; `currentColor` is what lets the same component sit in the brand teal, in a muted
 * header, and on a dark ground without a second asset.
 *
 * Square, 64 by 64: a ring with a squared top-left corner. `preserveAspectRatio` keeps it
 * honest inside a slot rather than stretching the ring into an oval.
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
      viewBox="0 0 64 64"
      fill="none"
      className={cn('size-full', breathing && 'saoirse-mark-breathe', className)}
      {...(labelled
        ? { role: 'img' as const, 'aria-label': title }
        : { 'aria-hidden': true as const })}
    >
      <g stroke="currentColor">
        <path
          d="M7 32C7 18.1929 18.1929 7 32 7C45.8071 7 57 18.1929 57 32C57 45.8071 45.8071 57 32 57C18.1929 57 7 45.8071 7 32ZM7 32V0"
          strokeWidth="14"
        />
        <path d="M22 29H28" strokeWidth="6" />
        <path d="M37 29H43" strokeWidth="6" />
      </g>
    </svg>
  )
}
