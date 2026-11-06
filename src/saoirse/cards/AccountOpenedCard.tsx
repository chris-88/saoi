import { useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon, PartyPopperIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { IconTile } from '@/components/IconTile'
import { Reveal } from '@/components/Primitives'
import { STAGGER } from '@/lib/motion'

type Payload = Extract<CardPayload, { type: 'account_opened' }>

/**
 * The account is open (§6 Stage 13).
 *
 * The closing moment of a first account, and the one card a customer might keep: the account's
 * name and number, where the debit card is going, and what to do next, each line arriving a
 * beat after the last. Every word is the server's, read from the case. The number is synthetic
 * and the small print says so, because an IBAN on a prototype is a number nobody should pay
 * into.
 *
 * Something to read, not something to decide. The one button copies.
 */
export function AccountOpenedCard({ card }: { card: Payload }): ReactNode {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    try {
      // Without the spaces: a form that wants an IBAN typed wants it unbroken.
      void navigator.clipboard
        .writeText(card.iban.replace(/\s+/g, ''))
        .then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
        // Refused often enough that failing loudly would be worse than the button quietly doing
        // nothing; the number is on screen either way.
        .catch(() => undefined)
    } catch {
      // No clipboard at all, as on a page served over plain http. The same answer.
    }
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <IconTile tone="success">
          <PartyPopperIcon />
        </IconTile>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-balance">Your account is open</h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{card.displayName}</p>
        </div>
      </div>

      <div className="border-t px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-[10.5px] font-semibold tracking-[0.08em] uppercase">
              IBAN
            </p>
            <p className="font-mono text-sm tabular-nums">{card.iban}</p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="text-muted-foreground mt-1.5 text-xs">BIC {card.bic}</p>
      </div>

      {card.cardTo !== null && (
        <p className="border-t px-4 py-2.5 text-sm leading-relaxed">
          Your debit card is on its way to <span className="font-medium">{card.cardTo}</span>.
        </p>
      )}

      <div className="border-t px-4 pt-3 pb-2">
        <p className="text-sm font-medium">What to do next</p>
        <ul className="mt-1">
          {card.next.map((step, index) => (
            <Reveal key={step} mode="mount" delay={index * STAGGER}>
              <li className="flex items-start gap-2 py-1.5 text-sm">
                <CheckIcon className="text-success mt-0.5 size-4 shrink-0" />
                <span className="text-muted-foreground leading-relaxed">{step}</span>
              </li>
            </Reveal>
          ))}
        </ul>
      </div>

      <p className="text-muted-foreground border-t px-4 py-2.5 text-xs leading-relaxed">
        Illustrative IBAN. This is a prototype: nothing has been opened.
      </p>
    </Card>
  )
}
