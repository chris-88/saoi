import type { ReactNode } from 'react'
import { SparklesIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { IconTile } from '@/components/IconTile'
import { Reveal } from '@/components/Primitives'
import { STAGGER } from '@/lib/motion'
import { cn } from '@/lib/utils'

type Payload = Extract<CardPayload, { type: 'reuse' }>

/**
 * What the customer was never asked, because the bank already knew (§53).
 *
 * The product's central claim, and until now the one thing it never showed. The rows arrive
 * one at a time, a beat apart, so the room watches the form fill itself in from what was
 * already held. Every word is the server's: the facts, their values and where they came from
 * are read from the case, not written by the model.
 *
 * Something to read, not something to decide. Nothing on it is tappable.
 */
export function ReuseCard({ card }: { card: Payload }): ReactNode {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <IconTile tone="success">
          <SparklesIcon />
        </IconTile>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-balance">{card.title}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            Started {joinNames(card.started)}. These were filled in from what was already held.
          </p>
        </div>
      </div>

      <ul className="divide-y border-t">
        {card.items.map((item, index) => (
          <Reveal key={item.key} mode="mount" delay={index * STAGGER}>
            <li className="flex items-baseline gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-muted-foreground truncate text-xs tabular-nums">{item.value}</p>
              </div>
              {/* Colour plus a word, never colour alone. */}
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.04em]',
                  TONE[item.source] ?? 'bg-muted text-muted-foreground',
                )}
              >
                {item.provenance}
              </span>
            </li>
          </Reveal>
        ))}
      </ul>

      <p className="text-muted-foreground border-t px-4 py-2.5 text-xs leading-relaxed">
        Anything here that is out of date, just say so and it changes everywhere it is used.
      </p>
    </Card>
  )
}

/** Tones by where the fact came from. The same families the rest of the product uses. */
const TONE: Readonly<Record<string, string>> = {
  bank_held: 'bg-success/10 text-success',
  customer_stated: 'bg-primary/10 text-primary',
  partner_stated: 'bg-primary/10 text-primary',
  document_extracted: 'bg-brand-deep/10 text-brand-deep',
  document_verified: 'bg-brand-deep/10 text-brand-deep',
  system_derived: 'bg-muted text-muted-foreground',
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`
}
