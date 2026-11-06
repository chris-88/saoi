import type { ReactNode } from 'react'
import { CheckIcon, XIcon } from 'lucide-react'
import type { ApplicationState } from '@domain/state-machine.ts'
import { stateLabel } from '@domain/state-machine.ts'
import { cn } from '@/lib/utils'

/**
 * An application's state, as the design boards render it: a pill carrying a colour AND the
 * state's own words.
 *
 * Colour is never the only signal — partly because §14 requires the state to be stated, and
 * partly because roughly one man in twelve could not tell the amber from the green.
 */
const TONE: Record<ApplicationState, { dot: string; chip: string }> = {
  not_started: { dot: 'bg-state-idle', chip: 'bg-muted text-muted-foreground' },
  in_progress: { dot: 'bg-state-progress', chip: 'bg-accent text-accent-foreground' },
  waiting_customer: { dot: 'bg-state-waiting', chip: 'bg-warning text-warning-foreground' },
  waiting_partner: { dot: 'bg-state-waiting', chip: 'bg-warning text-warning-foreground' },
  ready: { dot: 'bg-state-progress', chip: 'bg-accent text-accent-foreground' },
  submitted: { dot: 'bg-state-progress', chip: 'bg-accent text-accent-foreground' },
  under_review: { dot: 'bg-state-review', chip: 'bg-state-review/10 text-state-review' },
  info_required: { dot: 'bg-state-waiting', chip: 'bg-warning text-warning-foreground' },
  approved: { dot: 'bg-state-done', chip: 'bg-success/12 text-success' },
  declined: { dot: 'bg-state-declined', chip: 'bg-destructive/10 text-destructive' },
  paused: { dot: 'bg-state-idle', chip: 'bg-muted text-muted-foreground' },
  completed: { dot: 'bg-state-done', chip: 'bg-success/12 text-success' },
}

export function StatusBadge({
  state,
  className,
}: {
  state: ApplicationState
  className?: string
}): ReactNode {
  const tone = TONE[state]
  const icon =
    state === 'approved' || state === 'completed' ? (
      <CheckIcon aria-hidden className="size-3" />
    ) : state === 'declined' ? (
      <XIcon aria-hidden className="size-3" />
    ) : (
      <span aria-hidden className={cn('size-1.5 rounded-full', tone.dot)} />
    )

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium',
        tone.chip,
        className,
      )}
    >
      {icon}
      {stateLabel(state)}
    </span>
  )
}
