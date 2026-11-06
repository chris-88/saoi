import type { ReactNode } from 'react'
import { useState } from 'react'
import { BellIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pushPermission, type SubscribeResult } from '@/lib/push'
import { isInstalled, platform } from '@/lib/installed'
import { InstallSteps } from '@/saoirse/InstallSteps'
import { CheckIcon, ClockIcon, UsersIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/StatusBadge'
import { ProgressBar } from '@/components/ProgressBar'
import { ProductIcon } from '@/components/ProductIcon'

type Payload = Extract<CardPayload, { type: 'status' }>
type Application = Payload['applications'][number]

/** A mortgage has more requirements than belong in a chat card, so the rest are counted. */
const VISIBLE_STEPS = 5

/**
 * §14, §59 — rendered entirely from the case. Whatever Saoirse wrote alongside it, this is what is
 * actually true, and the state's own label always accompanies the colour.
 */
export function StatusCard({
  card,
  onEnableNotifications,
}: {
  card: Payload
  onEnableNotifications?: () => Promise<SubscribeResult>
}): ReactNode {
  if (card.applications.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-muted-foreground text-sm">Nothing in progress yet.</p>
      </Card>
    )
  }

  return (
    <Card className="gap-0 divide-y p-0">
      {card.applications.map((application) => (
        <ApplicationRow key={application.id} application={application} />
      ))}
      {onEnableNotifications === undefined ? null : <NotifyRow onEnable={onEnableNotifications} />}
    </Card>
  )
}

/**
 * "Tell me when this moves."
 *
 * Only here, under things that are actually in progress, because that is the only point at
 * which it is a sensible question. It disappears once allowed, and says something useful when
 * it cannot work rather than failing quietly — on an iPhone in a tab the Push API simply does
 * not exist, and "nothing happened" is the worst possible answer to a tap.
 */
function NotifyRow({ onEnable }: { onEnable: () => Promise<SubscribeResult> }): ReactNode {
  const [state, setState] = useState<SubscribeResult | { state: 'idle' } | { state: 'asking' }>(
    () => (pushPermission() === 'granted' ? { state: 'subscribed' } : { state: 'idle' }),
  )

  if (state.state === 'subscribed') {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 p-3 text-xs">
        <BellIcon className="size-3" />
        You will get a notification when something changes.
      </p>
    )
  }

  return (
    <div className="space-y-1.5 p-3">
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={state.state === 'asking'}
        onClick={() => {
          setState({ state: 'asking' })
          void onEnable().then(setState)
        }}
      >
        <BellIcon />
        {state.state === 'asking' ? 'Asking…' : 'Tell me when something changes'}
      </Button>
      {state.state === 'denied' ? (
        <p className="text-muted-foreground text-xs">
          Notifications are blocked for this site. Your browser settings can turn them back on.
        </p>
      ) : null}
      {state.state === 'unsupported' && platform() === 'ios' && !isInstalled() ? (
        /*
         * The person has just asked for notifications, and on an iPhone in Safari the only
         * thing between them and it is two taps. Show the taps, not a sentence about them.
         */
        <div className="-mx-3 -mb-3 border-t">
          <InstallSteps lead="Notifications need Saoirse on your home screen first. Two taps:" />
        </div>
      ) : state.state === 'unsupported' || state.state === 'failed' ? (
        <p className="text-muted-foreground text-xs">{state.reason}</p>
      ) : null}
    </div>
  )
}

function ApplicationRow({ application }: { application: Application }): ReactNode {
  // Submitted work is with the bank, so progress is complete from the customer's side.
  const settled =
    application.state === 'submitted' ||
    application.state === 'under_review' ||
    application.state === 'approved' ||
    application.state === 'completed'

  const total = application.steps.length
  const done = application.steps.filter((step) => step.done).length

  /**
   * What is left, not what is finished. A mortgage carries nearly forty requirements and the
   * first several are always the identity the bank already holds, so listing them in order
   * filled the card with ticks and told the customer nothing they could act on. The count of
   * what is done is in the bar; the list is the answer to "what do you need from me".
   */
  const remaining = application.steps.filter((step) => !step.done)
  const shown = remaining.slice(0, VISIBLE_STEPS)
  const hidden = remaining.length - shown.length

  return (
    <div className="space-y-3 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <ProductIcon product={application.product} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-pretty">{application.displayName}</span>
          {application.waitingOn === 'partner' && (
            <span className="text-muted-foreground block text-xs">Waiting for your partner</span>
          )}
        </span>
        <StatusBadge state={application.state} />
      </div>

      {!settled && total > 0 && (
        <ProgressBar value={done / total} label={`${String(done)} of ${String(total)} done`} />
      )}

      {!settled && total > 0 && remaining.length === 0 && (
        <p className="text-state-done flex items-center gap-2 text-sm">
          <CheckIcon aria-hidden className="size-4" strokeWidth={3} />
          Everything we need is in. Ready to review.
        </p>
      )}

      {!settled && shown.length > 0 && (
        <ul className="space-y-1.5">
          {shown.map((step) => (
            <li key={step.label} className="flex items-start gap-2.5 text-sm">
              <StepMark waitingOnPartner={step.waitingOnPartner} />
              <span className="text-foreground">{step.label}</span>
            </li>
          ))}
          {hidden > 0 && (
            <li className="text-muted-foreground pl-[1.625rem] text-xs">
              and {hidden} more to come
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/**
 * The icon carries the meaning and the text beside it names the step, so waiting on the
 * customer and waiting on their partner are distinguishable without colour.
 */
function StepMark({ waitingOnPartner }: { waitingOnPartner: boolean }): ReactNode {
  if (waitingOnPartner) {
    return (
      <span
        title="With your partner"
        className="bg-state-waiting/15 text-state-waiting mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full"
      >
        <UsersIcon aria-hidden className="size-3" />
        <span className="sr-only">With your partner</span>
      </span>
    )
  }

  return (
    <span
      title="Still to do"
      className="bg-state-progress/15 text-state-progress mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full"
    >
      <ClockIcon aria-hidden className="size-3" />
      <span className="sr-only">Still to do</span>
    </span>
  )
}
