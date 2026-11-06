import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The Saoi wordmark, from `brand/saoi-name.svg` (viewBox 0 0 254 64).
 *
 * Stroked paths, not type, so it renders identically everywhere. It takes its colour from
 * `currentColor`: set a `text-*` class. Sized by height, the width follows the artwork.
 * One mask cuts the gaps; its id is per instance because several wordmarks can be on one page.
 *
 * Do not put it inside a shadcn `Button`: Button forces `size-4` on descendant svgs.
 */
export function SaoiWordmark({
  className,
  transitionName,
}: {
  readonly className?: string
  /** A `view-transition-name`, where this is the same object as one on another page. */
  readonly transitionName?: string
}): ReactNode {
  const cut = `saoi-cut-${useId().replace(/:/g, '')}`
  return (
    <svg
      viewBox="0 0 254 64"
      fill="none"
      role="img"
      aria-label="Saoi"
      className={cn('text-saoi-primary h-7 w-auto', className)}
      {...(transitionName === undefined ? {} : { style: { viewTransitionName: transitionName } })}
    >
      <defs>
        <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="254" height="64">
          <rect width="254" height="64" fill="#fff" />
          <path d="M240 21.5L254 21.5" stroke="#000" strokeWidth="7" />
          <path d="M43 21.5L64 21.5" stroke="#000" strokeWidth="7" />
          <path d="M21 42.5L2.73771e-07 42.5" stroke="#000" strokeWidth="7" />
        </mask>
      </defs>
      <g stroke="currentColor" strokeWidth="14" mask={`url(#${cut})`}>
        <path d="M247 0V64" />
        <path d="M167 32C167 17.6406 177.641 7 192 7C206.359 7 217 17.6406 217 32C217 46.3594 206.359 57 192 57C177.641 57 167 46.3594 167 32Z" />
        <path d="M137 32C137 17.6406 126.359 7 112 7C97.6406 7 87 17.6406 87 32C87 46.3594 97.6406 57 112 57C126.359 57 137 46.3594 137 32ZM137 32V64" />
        <path d="M7 32C7 17.6406 17.6406 7 32 7C46.3594 7 57 17.6406 57 32M7 32C7 46.3594 17.6406 57 32 57C46.3594 57 57 46.3594 57 32M7 32H57" />
      </g>
    </svg>
  )
}
