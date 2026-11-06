import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Saoirse's icon, from `brand/saoirse-face.svg`.
 *
 * A lowercase `b` — a stem and a ring for its bowl — with two eyes inside the bowl. It is the
 * same letter that opens the wordmark, which is the point: the thing in the middle of the
 * opening screen and the first letter of the name are one object.
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
      <circle cx="32" cy="40" r="24.5" fill="none" stroke="currentColor" strokeWidth="15" />
      <circle cx="26" cy="37" r="3" fill="currentColor" />
      <circle cx="37" cy="37" r="3" fill="currentColor" />
      <path
        d="M0 7.5C0 3.35786 3.35786 0 7.5 0C11.6421 0 15 3.35786 15 7.5V40H0V7.5Z"
        fill="currentColor"
      />
    </svg>
  )
}
