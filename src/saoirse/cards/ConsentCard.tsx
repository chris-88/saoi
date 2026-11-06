import { useState, type ReactNode } from 'react'
import { LockIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IconTile } from '@/components/IconTile'

type Payload = Extract<CardPayload, { type: 'consent' }>

/**
 * §7.5 — the gate in front of anything sensitive.
 *
 * The customer is shown exactly what will be asked before a single question is put to them,
 * and nothing happens unless they tap. Declining is a real option, not a dead end.
 */
export function ConsentCard({
  card,
  onConsent,
  disabled,
}: {
  card: Payload
  onConsent?: (applicationId: string, requirementId: string) => Promise<void> | void
  disabled?: boolean
}): ReactNode {
  const [busy, setBusy] = useState(false)

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start gap-3 p-4">
        <IconTile tone="deep">
          <LockIcon />
        </IconTile>
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-semibold">{card.title}</p>
          <p className="text-muted-foreground text-xs leading-relaxed">{card.explanation}</p>
        </div>
      </div>

      <div className="border-t px-4 py-3">
        <p className="text-muted-foreground mb-2 text-2xs tracking-wide uppercase">
          What you&rsquo;ll be asked
        </p>
        <ul className="space-y-1.5 text-sm">
          {card.covers.map((item) => (
            <li key={item} className="relative pl-4 leading-snug">
              <span
                aria-hidden
                className="bg-border absolute top-[0.5em] left-0 size-1.5 rounded-full"
              />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-muted/40 border-t p-3">
        <Button
          size="sm"
          className="w-full"
          disabled={disabled ?? busy}
          onClick={() => {
            setBusy(true)
            void Promise.resolve(onConsent?.(card.applicationId, card.requirementId)).finally(() =>
              setBusy(false),
            )
          }}
        >
          {busy ? 'Saving…' : card.confirmLabel}
        </Button>
        <p className="text-muted-foreground mt-2 text-center text-2xs">
          You can say no. The rest of the application carries on either way.
        </p>
      </div>
    </Card>
  )
}
