import { useState, type ReactNode } from 'react'
import { CalendarClockIcon, CheckIcon, FlagIcon, TargetIcon } from 'lucide-react'
import { Settling } from '@/saoirse/cards/Settling'
import type { Card as CardPayload } from '@contracts/cards.ts'
import type { Settled } from '@/saoirse/cardState'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ProgressBar } from '@/components/ProgressBar'
import { IconTile } from '@/components/IconTile'

type Payload = Extract<CardPayload, { type: 'plan_proposal' }>

const euro = (amount: number): string => `€${amount.toLocaleString('en-IE')}`

/**
 * §10 — the plan Saoirse is offering to keep, before the customer has agreed to it.
 *
 * Every number here was computed by the plan engine from the case. The card shows the whole
 * shape of the commitment — the target, the milestones, and when Saoirse will be back — because
 * agreeing to be contacted for months is not something to slip past somebody in a sentence.
 */
export function PlanProposalCard({
  card,
  onConfirm,
  onDecline,
  disabled,
}: {
  card: Payload
  onConfirm?: (planId: string) => Promise<boolean> | boolean
  onDecline?: (planId: string) => Promise<void> | void
  disabled?: boolean
}): ReactNode {
  const [busy, setBusy] = useState(false)
  /**
   * What became of the card, the moment it did.
   *
   * Both decisions settle it. Declining used to leave every control live, so a second tap on
   * "Keep this plan" sent keep against a plan that was already abandoned and the customer saw
   * "That plan cannot move from abandoned" (case ad93c361). The settled wording is the same
   * `cardState` uses on reload, so the card looks identical a second later and a day later.
   */
  const [done, setDone] = useState<Settled | undefined>(undefined)

  const fraction =
    card.targetAmount !== null && card.targetAmount > 0 && card.currentAmount !== null
      ? card.currentAmount / card.targetAmount
      : null

  /*
   * The same wrapper the history path uses, so the card looks identical the instant it is
   * kept and when the conversation is opened again tomorrow. It used to be a different early
   * return here and a greyed-out full card there, which made a reload look like a change.
   */
  return (
    <Settling settled={done}>
      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex items-start gap-3 p-4">
          <IconTile tone="deep">
            <FlagIcon />
          </IconTile>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-pretty">{card.title}</p>
            <p className="text-muted-foreground text-xs">
              A plan I&rsquo;ll keep track of with you, rather than something you have to remember.
            </p>
          </div>
        </div>

        {card.targetAmount !== null && (
          <div className="space-y-2 border-t px-4 py-3">
            <div className="flex items-baseline gap-2">
              <TargetIcon aria-hidden className="text-muted-foreground size-4" />
              <span className="tabular text-sm font-semibold">
                {card.currentAmount === null
                  ? euro(card.targetAmount)
                  : `${euro(card.currentAmount)} of ${euro(card.targetAmount)}`}
              </span>
            </div>

            {fraction !== null && (
              <ProgressBar
                value={fraction}
                label={
                  card.monthsRemaining === null
                    ? 'towards your target'
                    : `about ${String(card.monthsRemaining)} month${card.monthsRemaining === 1 ? '' : 's'} to go`
                }
              />
            )}
          </div>
        )}

        {card.milestones.length > 0 && (
          <ul className="space-y-1.5 border-t px-4 py-3">
            {card.milestones.map((milestone) => (
              <li key={milestone.label} className="flex items-start gap-2.5 text-sm">
                <span
                  aria-hidden
                  className={
                    milestone.achieved
                      ? 'bg-state-done/15 text-state-done mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full'
                      : 'border-input mt-0.5 size-4.5 shrink-0 rounded-full border'
                  }
                >
                  {milestone.achieved && <CheckIcon className="size-3" strokeWidth={3} />}
                </span>
                <span className={milestone.achieved ? 'text-muted-foreground' : 'text-foreground'}>
                  {milestone.label}
                </span>
              </li>
            ))}
          </ul>
        )}

        {card.checkin !== null && (
          <div className="bg-muted/40 space-y-1 border-t px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CalendarClockIcon aria-hidden className="size-4" />
              {card.checkin.purpose}
            </p>
            <p className="text-muted-foreground text-xs">{card.checkin.when}</p>
            {/* §20 — the agenda is written now, so the reason to make contact exists before
              the contact does. */}
            {card.checkin.agenda.length > 0 && (
              <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-4 text-2xs">
                {card.checkin.agenda.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="space-y-2 border-t p-4">
          <Button
            size="sm"
            className="w-full"
            disabled={(disabled ?? false) || busy}
            onClick={() => {
              setBusy(true)
              void Promise.resolve(onConfirm?.(card.planId))
                .then((accepted) => {
                  if (accepted === true) {
                    setDone({
                      label: card.title,
                      note: 'Saved. You can change or stop it any time.',
                    })
                  }
                })
                .finally(() => setBusy(false))
            }}
          >
            {busy ? 'Saving…' : card.confirmLabel}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="w-full"
            disabled={(disabled ?? false) || busy}
            onClick={() => {
              if (onDecline === undefined) return
              setBusy(true)
              /*
               * Settles only once the server has recorded the decision. A failure gives the
               * card back, because then nothing was decided.
               */
              void Promise.resolve(onDecline(card.planId))
                .then(() => {
                  setDone({ label: 'Left for now', note: card.title })
                })
                .catch(() => undefined)
                .finally(() => setBusy(false))
            }}
          >
            Not now
          </Button>
        </div>
      </Card>
    </Settling>
  )
}
