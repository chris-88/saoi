import type { ReactNode } from 'react'
import { m } from 'motion/react'
import { ShareIcon, SquarePlusIcon } from 'lucide-react'
import { DURATION, EASE, useStill } from '@/lib/motion'

/**
 * The two taps that put Saoirse on an iPhone's home screen.
 *
 * In one place because it is wanted in three: the card that offers the home screen after
 * signing in, and the two spots where somebody asks for notifications in Safari and cannot
 * have them until the app is installed. That last case used to get a sentence saying so,
 * which is an instruction with no instruction. The person has just said what they want, and
 * the only thing between them and it is two taps we already know how to show.
 *
 * iOS only. There is no install API there; the Share sheet is the route, and the glyph
 * breathes so the eye finds the one it is about to look for on the toolbar.
 */
export function InstallSteps({ lead }: { readonly lead?: string }): ReactNode {
  const still = useStill()

  return (
    <div>
      {lead !== undefined && (
        <p className="text-muted-foreground px-4 pt-3 text-xs leading-relaxed">{lead}</p>
      )}
      <ol className="divide-y">
        <li className="flex items-center gap-3 px-4 py-3">
          <m.span
            aria-hidden
            className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg"
            {...(still
              ? {}
              : {
                  animate: { scale: [1, 1.08, 1], opacity: [1, 0.75, 1] },
                  transition: { duration: DURATION.slow * 4, ease: EASE, repeat: Infinity },
                })}
          >
            <ShareIcon className="size-4" />
          </m.span>
          <p className="text-sm leading-snug">
            Tap <span className="font-semibold">Share</span> at the bottom of Safari.
          </p>
        </li>
        <li className="flex items-center gap-3 px-4 py-3">
          <span
            aria-hidden
            className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg"
          >
            <SquarePlusIcon className="size-4" />
          </span>
          <p className="text-sm leading-snug">
            Then <span className="font-semibold">Add to Home Screen</span>.
          </p>
        </li>
      </ol>
    </div>
  )
}
