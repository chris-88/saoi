import { useState, type ReactNode } from 'react'
import { CheckIcon, LandmarkIcon, LockIcon } from 'lucide-react'
import type { Card as CardPayload, CONSENT_SCOPE } from '@contracts/cards.ts'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { IconTile } from '@/components/IconTile'
import { Reveal } from '@/components/Primitives'
import { Settling } from '@/saoirse/cards/Settling'
import type { Settled } from '@/saoirse/cardState'
import { cn } from '@/lib/utils'

type Payload = Extract<CardPayload, { type: 'connect_accounts' }>
type Bank = Payload['banks'][number]
type Scope = (typeof CONSENT_SCOPE)[number]

/**
 * What each line of the consent means, in the customer's terms.
 *
 * The scope is the contract's, so the panel can only ever list what the server will actually
 * read. Payments is the one worth being exact about: it is permission to move money, and the
 * line says when that happens so nobody allows it thinking it is read-only.
 */
const SCOPE_LINES: Readonly<Record<Scope, { readonly label: string; readonly detail: string }>> = {
  balances: { label: 'Balances', detail: 'what is in each account now' },
  transactions: { label: 'Transactions', detail: 'the last 90 days, in and out' },
  payments: { label: 'Payments', detail: 'move money only when you tap' },
}

/**
 * The consent moment: linking the accounts the customer holds elsewhere.
 *
 * Open banking is simulated end to end here, but the shape of the consent is the real one. A
 * bank is picked, the aggregator says exactly what it will share and for how long, and the
 * customer allows it or does not. Nothing is read before the tap, and the tap is the only
 * thing that reads anything (Invariant 1). The panel is written in the aggregator's idiom,
 * not Saoirse's, because that is who the customer is giving permission to.
 *
 * No logos. There are none in the repo and no third-party assets are added for a prototype,
 * so a bank is a name on a tile.
 */
export function ConnectAccountsCard({
  card,
  onAllow,
  onDecline,
  disabled,
}: {
  card: Payload
  onAllow?: (bank: Bank['id'], scope: readonly Scope[]) => Promise<void> | void
  onDecline?: () => Promise<void> | void
  disabled?: boolean
}): ReactNode {
  const [picked, setPicked] = useState<Bank | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * What became of the card, the moment it did.
   *
   * The same shape `cardState` works out from the database on reload, so the card settles to
   * the identical thing whether the tap landed a second ago or a day ago.
   */
  const [done, setDone] = useState<Settled | undefined>(undefined)

  const allow = () => {
    if (!onAllow || picked === null || busy) return
    setBusy(true)
    const bank = picked
    // A card that has committed stays spent. Only a failure restores it.
    void Promise.resolve(onAllow(bank.id, card.scope))
      .then(() =>
        setDone({
          label: `Linked ${bank.name}`,
          note: `Shared through Nexus for ${String(card.consentDays)} days. Stop it any time from the menu.`,
        }),
      )
      .catch(() => setBusy(false))
  }

  const decline = () => {
    if (!onDecline || busy) return
    setBusy(true)
    void Promise.resolve(onDecline())
      .then(() =>
        setDone({ label: 'Not linked', note: 'Saoirse works from what you tell it instead.' }),
      )
      .catch(() => setBusy(false))
  }

  const off = (disabled ?? false) || busy

  return (
    <Settling settled={done}>
      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex items-start gap-3 px-4 pt-4 pb-3">
          <IconTile tone="primary">
            <LandmarkIcon />
          </IconTile>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-balance">Link your other accounts</h3>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{card.why}</p>
          </div>
        </div>

        {/*
          Tiles rather than a list, so six banks fit above the fold on a phone and the pick
          reads as a pick. `aria-pressed` carries the selection for a screen reader; the
          colour alone never does.
        */}
        <div className="grid grid-cols-2 gap-2 border-t px-4 py-3 sm:grid-cols-3">
          {card.banks.map((bank) => {
            const selected = picked?.id === bank.id
            return (
              <button
                key={bank.id}
                type="button"
                aria-pressed={selected}
                disabled={off}
                onClick={() => setPicked(selected ? null : bank)}
                className={cn(
                  'focus-visible:ring-ring flex h-12 items-center justify-center rounded-lg border px-2 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60',
                  selected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'bg-background hover:bg-muted/50',
                )}
              >
                <span className="truncate">{bank.name}</span>
              </button>
            )
          })}
        </div>

        {picked === null ? (
          <div className="bg-muted/40 border-t p-3">
            <p className="text-muted-foreground mb-2 text-center text-xs leading-relaxed">
              Pick a bank to see exactly what would be shared.
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground w-full"
              disabled={off || !onDecline}
              onClick={decline}
            >
              Not now
            </Button>
          </div>
        ) : (
          <Reveal mode="mount" key={picked.id}>
            <ConsentPanel
              bank={picked}
              scope={card.scope}
              days={card.consentDays}
              busy={busy}
              disabled={off || !onAllow}
              onAllow={allow}
              onDecline={decline}
            />
          </Reveal>
        )}

        <p className="text-muted-foreground/80 flex items-center justify-center gap-1.5 border-t px-4 py-2 text-[11px]">
          <LockIcon aria-hidden className="size-3" />
          Nexus · secure link, simulated
        </p>
      </Card>
    </Settling>
  )
}

/**
 * The aggregator's own screen, as a panel inside the card.
 *
 * Written as Nexus, in the second person about Saoirse, because that is how a real consent reads:
 * the customer is telling a third party what it may pass on. Every line is from the contract's
 * scope; the panel cannot promise less than will be read.
 */
function ConsentPanel({
  bank,
  scope,
  days,
  busy,
  disabled,
  onAllow,
  onDecline,
}: {
  bank: Bank
  scope: readonly Scope[]
  days: number
  busy: boolean
  disabled: boolean
  onAllow: () => void
  onDecline: () => void
}): ReactNode {
  return (
    <div className="bg-muted/40 border-t">
      <div className="space-y-2.5 px-4 pt-3 pb-3">
        <p className="text-sm font-semibold">
          Nexus will share your {bank.name} accounts with Saoirse:
        </p>
        <ul className="space-y-1.5">
          {scope.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm">
              <span
                aria-hidden
                className="bg-state-done/15 text-state-done mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full"
              >
                <CheckIcon className="size-3" strokeWidth={3} />
              </span>
              <span className="min-w-0">
                <span className="font-medium">{SCOPE_LINES[item].label}</span>
                <span className="text-muted-foreground">: {SCOPE_LINES[item].detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-xs leading-relaxed">
          For {String(days)} days, and you can stop it any time from the menu.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t p-3">
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          disabled={disabled}
          onClick={onDecline}
        >
          Not now
        </Button>
        <Button size="sm" disabled={disabled} onClick={onAllow}>
          {busy ? 'Linking…' : 'Allow'}
        </Button>
      </div>
    </div>
  )
}
