import { useState, type ReactNode } from 'react'
import { ArrowDownIcon, ArrowRightLeftIcon, LockIcon, ShieldCheckIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { IconTile } from '@/components/IconTile'
import { Settling } from '@/saoirse/cards/Settling'
import { settledTransfer, type Settled } from '@/saoirse/cardState'

type Payload = Extract<CardPayload, { type: 'transfer' }>

/**
 * Moving money from a linked account into something that has just opened.
 *
 * The payment leg of the consent. Every figure is the server's: which account, how much, how
 * often and why come from the case and the linked rows, and the model never does the
 * arithmetic. The tap initiates it and nothing more. Settlement is the receiving bank's to
 * report, which here means the console, and a later turn narrates it; this card never says
 * the money has landed, because from where it sits it cannot know (Invariant 2).
 *
 * The strip above the buttons says what the tap is in law: a PSD2 payment initiation, passed
 * to the customer's bank by the aggregator. It was added for the showcase, where a room saw
 * money move and had no way to tell that this is the access banks already have to provide,
 * and it stays because a customer deserves the same line before they tap.
 */
export function TransferCard({
  card,
  onMove,
  onDecline,
  disabled,
}: {
  card: Payload
  onMove?: (transfer: {
    fromAccountId: string
    toApplicationId: string | null
    amount: number
    cadence: Payload['cadence']
  }) => Promise<void> | void
  onDecline?: (toLabel: string) => Promise<void> | void
  disabled?: boolean
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Settled | undefined>(undefined)

  const run = (fn: (() => Promise<void> | void) | undefined, outcome: Settled) => {
    if (!fn || busy) return
    setBusy(true)
    // A card that has committed stays spent. Only a failure restores it.
    void Promise.resolve(fn())
      .then(() => setDone(outcome))
      .catch(() => setBusy(false))
  }

  const move = () =>
    run(
      onMove &&
        (() =>
          onMove({
            fromAccountId: card.fromAccountId,
            toApplicationId: card.toApplicationId,
            amount: card.amount,
            cadence: card.cadence,
          })),
      settledTransfer(card),
    )

  const decline = () =>
    run(onDecline && (() => onDecline(card.toLabel)), {
      label: 'Not moved',
      note: 'The money stays where it is. Say the word if you change your mind.',
    })

  const off = (disabled ?? false) || busy

  return (
    <Settling settled={done}>
      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex items-start gap-3 px-4 pt-4 pb-3">
          <IconTile tone="success">
            <ArrowRightLeftIcon />
          </IconTile>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-balance">
              {card.cadence === 'monthly' ? 'Move it across each month' : 'Move it across'}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{card.why}</p>
          </div>
        </div>

        <div className="border-t px-4 py-4 text-center">
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{money(card.amount)}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {card.cadence === 'monthly' ? 'each month' : 'once'}
          </p>
        </div>

        <dl className="space-y-2 border-t px-4 py-3 text-sm">
          <div className="flex items-baseline gap-3">
            <dt className="text-muted-foreground w-10 shrink-0 text-xs">From</dt>
            <dd className="min-w-0 flex-1 truncate font-medium">{card.fromLabel}</dd>
          </div>
          <div className="text-muted-foreground pl-13" aria-hidden>
            <ArrowDownIcon className="size-3.5" />
          </div>
          <div className="flex items-baseline gap-3">
            <dt className="text-muted-foreground w-10 shrink-0 text-xs">To</dt>
            <dd className="min-w-0 flex-1 truncate font-medium">{card.toLabel}</dd>
          </div>
        </dl>

        <div className="bg-primary/5 flex items-start gap-2.5 border-t px-4 py-3">
          <ShieldCheckIcon aria-hidden className="text-primary mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 text-xs leading-relaxed">
            <p className="font-semibold">
              <span className="bg-primary text-primary-foreground mr-1.5 rounded px-1.5 py-px text-[10px] font-bold tracking-wide">
                PSD2
              </span>
              Payment initiation
            </p>
            <p className="text-muted-foreground mt-0.5">
              Your tap is the instruction. Nexus passes it to your bank, and nothing moves before
              that.
            </p>
          </div>
        </div>

        <div className="bg-muted/40 grid grid-cols-2 gap-2 border-t p-3">
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            disabled={off || !onDecline}
            onClick={decline}
          >
            Not now
          </Button>
          <Button size="sm" disabled={off || !onMove} onClick={move}>
            {busy ? 'Sending…' : 'Move it'}
          </Button>
        </div>

        <p className="text-muted-foreground/80 flex items-center justify-center gap-1.5 border-t px-4 py-2 text-[11px]">
          <LockIcon aria-hidden className="size-3" />
          Nexus · PSD2 payment, simulated
        </p>
      </Card>
    </Settling>
  )
}

const money = (amount: number): string => `€${Math.round(amount).toLocaleString('en-IE')}`
