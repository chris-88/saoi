import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { SaoirseMark } from '@/saoirse/SaoirseMark'

/**
 * Saoirse's mark at a fixed size, for headers and nameplates.
 *
 * It used to draw its own face — a white robot on a blue disc, from the original asset pack —
 * which meant the product had two marks: that one in every header, and the mark from the
 * opening-transition spec in the conversation itself. The whole point of that spec is that the
 * thing waiting in the middle of the screen becomes the thing talking to you, which does not
 * survive a different logo sitting above it.
 *
 * So this is now the same component the chat uses, sized. The app icon is the one place that
 * still carries its own copy, because an icon has no page to inherit a colour from
 * (`public/favicon.svg`).
 */
export function SaoirseAvatar({
  className,
  size = 'md',
}: {
  readonly className?: string
  readonly size?: 'sm' | 'md' | 'lg'
}): ReactNode {
  return (
    <span
      className={cn(
        'text-saoi-primary inline-grid shrink-0 place-items-center',
        size === 'sm' && 'size-7',
        size === 'md' && 'size-9',
        size === 'lg' && 'size-12',
        className,
      )}
    >
      <SaoirseMark />
    </span>
  )
}
