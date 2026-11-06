import { useState, type ReactNode } from 'react'
import { LayersIcon, SparklesIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { IconTile } from '@/components/IconTile'
import type { ProductChoice } from '@/saoirse/cards/ProductOptionsCard'

type Payload = Extract<CardPayload, { type: 'arrangement' }>

/**
 * How the customer's money should be split across accounts, with one tap to start all of it.
 *
 * The moment a live conversation got the wrong way round. Saoirse offered a choice of two savings
 * accounts; the customer replied with the right answer worked out alone, the lump sum locked
 * away, €200 a month for the bonus, the rest where it earns most. This card is that answer,
 * arriving before they have to work it out, from the engine rather than from anybody's memory
 * of a rate table (§40).
 *
 * Every figure on it is the server's. The bonus is kept apart from the interest, visibly,
 * because it is conditional and a single headline figure would quietly promise it.
 */
export function ArrangementCard({
  card,
  onSelect,
  disabled,
}: {
  card: Payload
  onSelect?: (products: readonly ProductChoice[]) => Promise<void> | void
  disabled?: boolean
}): ReactNode {
  const [busy, setBusy] = useState(false)

  const start = () => {
    if (!onSelect || busy) return
    setBusy(true)
    // A card that has committed stays spent. Only a failure restores it.
    void Promise.resolve(
      onSelect(
        card.allocations.map((allocation) => ({
          product: allocation.product,
          catalogueId: allocation.catalogueId,
        })),
      ),
    ).catch(() => setBusy(false))
  }

  const count = COUNT_WORDS[card.allocations.length] ?? String(card.allocations.length)

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <IconTile tone="primary">
          <LayersIcon />
        </IconTile>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-balance">{card.title}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            Worked out from what you told me and the published rates. Nothing starts until you say.
          </p>
        </div>
      </div>

      <ul className="divide-y border-t">
        {card.allocations.map((allocation) => (
          <li key={allocation.catalogueId} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-semibold">{allocation.name}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {money(allocation.amount)}
                <span className="text-muted-foreground font-normal">
                  {allocation.cadence === 'monthly' ? ' a month' : ' once'}
                </span>
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {allocation.rate}
              {allocation.termMonths !== null && allocation.cadence === 'once'
                ? ` · back before you need it`
                : ''}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed">{allocation.job}</p>
            {allocation.watch.length > 0 && (
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {allocation.watch[0]}
              </p>
            )}
          </li>
        ))}
      </ul>

      {/*
        Interest and bonus on separate lines, deliberately. One is arithmetic on a published
        rate; the other depends on a mortgage drawn down within a window. Adding them into one
        number is how a conditional €2,000 becomes a promise.
      */}
      <div className="bg-muted/40 space-y-1.5 border-t px-4 py-3 text-xs">
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">Interest in the first year, roughly</span>
          <span className="font-semibold tabular-nums">{money(card.firstYearInterest)}</span>
        </p>
        {card.bonus !== null && (
          <div>
            <p className="flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-1.5">
                <SparklesIcon aria-hidden className="text-state-done size-3.5" />
                First-time-buyer bonus, on top
              </span>
              <span className="font-semibold tabular-nums">{money(card.bonus.amount)}</span>
            </p>
            <ul className="text-muted-foreground mt-1 space-y-0.5 pl-5">
              {card.bonus.conditions.map((condition) => (
                <li key={condition} className="list-disc">
                  {condition}
                </li>
              ))}
            </ul>
          </div>
        )}
        {card.notes.map((note) => (
          <p key={note} className="text-muted-foreground leading-relaxed">
            {note}
          </p>
        ))}
      </div>

      <div className="border-t p-3">
        <Button
          className="w-full"
          disabled={(disabled ?? false) || busy || !onSelect}
          onClick={start}
        >
          {busy ? 'Starting…' : `Start all ${count}`}
        </Button>
        <p className="text-muted-foreground mt-2 text-center text-xs leading-relaxed">
          Or say what you would change. Nothing here is fixed until you apply.
        </p>
      </div>
    </Card>
  )
}

const COUNT_WORDS: Readonly<Record<number, string>> = { 2: 'two', 3: 'three', 4: 'four' }

const money = (amount: number): string => `€${Math.round(amount).toLocaleString('en-IE')}`
