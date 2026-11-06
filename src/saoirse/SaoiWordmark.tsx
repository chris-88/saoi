import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The Saoi wordmark, from `brand/saoi-name.svg` (viewBox 258 x 67).
 *
 * Drawn outlines, not type, so it renders identically everywhere. It takes its colour from
 * `currentColor`: set a `text-*` class. Sized by height, the width follows the artwork.
 * The two masks cut the transparent gaps in the `s` and the `i`; their ids are per instance
 * because several wordmarks can be on one page.
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
  const id = useId().replace(/:/g, '')
  const sGap = `saoi-s-gap-${id}`
  const iGap = `saoi-i-gap-${id}`
  return (
    <svg
      viewBox="0 0 258 67"
      fill="none"
      role="img"
      aria-label="Saoi"
      className={cn('text-saoi-primary h-7 w-auto', className)}
      {...(transitionName === undefined ? {} : { style: { viewTransitionName: transitionName } })}
    >
      <defs>
        <mask id={sGap} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="67">
          <rect width="64" height="67" fill="#fff" />
          <path
            d="M18.8092 41.5C16.324 37.1954 10.8196 35.7205 6.51501 38.2058C2.21038 40.6911 0.735505 46.1954 3.22079 50.5L11.015 46L18.8092 41.5ZM11.015 46L3.22079 50.5C2.40237 49.0825 4.89315 55.1029 9.07162 59.0809C13.9324 63.7085 21.298 67 32.0151 67V58V49C25.2321 49 22.5307 47.0415 21.4829 46.0441C19.7529 44.3971 20.4937 44.4175 18.8092 41.5L11.015 46Z"
            fill="#000"
          />
          <path
            d="M45.2208 26.5C47.7061 30.8046 53.2104 32.2795 57.515 29.7942C61.8196 27.3089 63.2945 21.8046 60.8092 17.5L53.015 22L45.2208 26.5ZM53.015 22L60.8092 17.5C61.6277 18.9175 59.1369 12.8971 54.9584 8.91908C50.0976 4.29152 42.732 0.999999 32.0150 0.999998L32.015 10L32.015 19C38.798 19 41.4994 20.9585 42.5471 21.9559C44.2771 23.6029 43.5363 23.5825 45.2208 26.5L53.015 22Z"
            fill="#000"
          />
        </mask>
        <mask id={iGap} maskUnits="userSpaceOnUse" x="237" y="0" width="21" height="67">
          <rect x="237" width="21" height="67" fill="#fff" />
          <circle cx="247.5" cy="10.5" r="10.5" fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${sGap})`}>
        <path d="M8.01498 35H56.015" stroke="currentColor" strokeWidth="16" strokeLinecap="round" />
        <path d="M56.015 35C56.015 35 57.515 58 32.015 58" stroke="currentColor" strokeWidth="16" />
        <path
          d="M32.0254 10C6.57114 9.99999 8.01501 35.5 8.01501 35.5"
          stroke="currentColor"
          strokeWidth="16"
        />
      </g>
      <path
        d="M17.9432 42C15.7341 38.1737 10.8414 36.8627 7.01501 39.0718C3.18867 41.2809 1.87767 46.1737 4.08681 50L11.015 46L17.9432 42ZM11.015 46L4.08681 50C3.40744 48.8233 5.71869 54.5082 9.76114 58.3567C14.4101 62.7825 21.5166 66 32.0151 66V58V50C25.0135 50 22.053 47.9675 20.7934 46.7683C18.9274 44.9918 19.4886 44.6767 17.9432 42L11.015 46Z"
        fill="currentColor"
      />
      <path
        d="M46.0868 26C48.2959 29.8263 53.1887 31.1373 57.015 28.9282C60.8414 26.7191 62.1524 21.8263 59.9432 18L53.015 22L46.0868 26ZM53.015 22L59.9432 18C60.6226 19.1767 58.3113 13.4918 54.2689 9.64335C49.6199 5.21746 42.5135 2 32.015 2L32.015 10L32.015 18C39.0165 18 41.9771 20.0325 43.2366 21.2317C45.1027 23.0082 44.5414 23.3233 46.0868 26L53.015 22Z"
        fill="currentColor"
      />
      <rect x="30" y="50" width="4" height="16" fill="currentColor" />
      <rect x="30" y="2" width="4" height="16" fill="currentColor" />
      <circle cx="112" cy="35" r="24.5" stroke="currentColor" strokeWidth="15" />
      <path
        d="M144 59.5C144 63.6421 140.642 67 136.5 67C132.358 67 129 63.6421 129 59.5V33H144V59.5Z"
        fill="currentColor"
      />
      <circle cx="192" cy="35" r="24.5" stroke="currentColor" strokeWidth="15" />
      <path
        d="M255 59.5C255 63.6421 251.642 67 247.5 67C243.358 67 240 63.6421 240 59.5V10.5C240 6.35786 243.358 3 247.5 3C251.642 3 255 6.35786 255 10.5V59.5Z"
        fill="currentColor"
        mask={`url(#${iGap})`}
      />
      <circle cx="247.5" cy="10.5" r="7.5" fill="currentColor" />
    </svg>
  )
}
