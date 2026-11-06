import type { ReactNode } from 'react'
import type { ApplicationState } from '@domain/state-machine.ts'
import { cn } from '@/lib/utils'

/**
 * The coloured dot beside an application.
 *
 * The mapping lives here, keyed by the state machine's own union, so a new state cannot be
 * added without deciding how it reads on screen. Colour is never the only signal — every use
 * pairs this with the state's label (§14).
 */
const STATE_TONE: Record<ApplicationState, string> = {
  not_started: 'bg-state-idle',
  in_progress: 'bg-state-progress',
  waiting_customer: 'bg-state-waiting',
  waiting_partner: 'bg-state-waiting',
  ready: 'bg-state-progress',
  submitted: 'bg-state-progress',
  under_review: 'bg-state-progress',
  info_required: 'bg-state-waiting',
  approved: 'bg-state-done',
  declined: 'bg-destructive',
  paused: 'bg-state-idle',
  completed: 'bg-state-done',
}

export function StatusDot({
  state,
  className,
}: {
  state: ApplicationState
  className?: string
}): ReactNode {
  return (
    <span
      aria-hidden
      className={cn('size-2 shrink-0 rounded-full', STATE_TONE[state], className)}
    />
  )
}
