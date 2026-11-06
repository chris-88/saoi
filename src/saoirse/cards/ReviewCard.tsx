import { useState, type ReactNode } from 'react'
import { FileCheckIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconTile } from '@/components/IconTile'
import { ConfirmationCard } from '@/saoirse/cards/ConfirmationCard'

type Payload = Extract<CardPayload, { type: 'review' }>

const INTRO: Record<Payload['confirmations'][number]['kind'], string> = {
  declaration: 'Declaration',
  confirmation: 'Your consent',
  reuse: 'Still right?',
}

/**
 * §48 — nothing is submitted silently.
 *
 * Everything shown is built from the case by the server, not written by the model. Nothing is
 * ticked in advance, and submit stays disabled until every confirmation is made by hand: a
 * declaration nobody actually read is worth nothing.
 */
export function ReviewCard({
  card,
  onSubmit,
  disabled,
}: {
  card: Payload
  onSubmit?: (applicationId: string, confirmations: readonly string[]) => Promise<boolean> | boolean
  disabled?: boolean
}): ReactNode {
  const [agreed, setAgreed] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Only after the server accepted it. Saoirse's reply arrives separately and is not evidence.
  if (submitted) {
    return (
      <ConfirmationCard
        title="Application submitted"
        body={`Your ${card.displayName.toLowerCase()} application is with us. Saoirse will tell you the moment anything changes.`}
      />
    )
  }

  const outstanding = card.confirmations.filter((item) => !agreed.includes(item.requirementId))
  const canSubmit = outstanding.length === 0 && !busy && disabled !== true

  const toggle = (requirementId: string) =>
    setAgreed((current) =>
      current.includes(requirementId)
        ? current.filter((id) => id !== requirementId)
        : [...current, requirementId],
    )

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center gap-3 border-b p-4">
        <IconTile tone="deep">
          <FileCheckIcon />
        </IconTile>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{card.displayName}</p>
          <p className="text-muted-foreground text-xs">Check this before it goes.</p>
        </div>
      </div>

      {card.summary.length > 0 && (
        <dl className="divide-y">
          {card.summary.map((row) => (
            <div key={row.label} className="flex items-baseline gap-3 px-4 py-2.5">
              <dt className="text-muted-foreground min-w-0 flex-1 text-xs">{row.label}</dt>
              <dd className="tabular text-right text-sm font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {card.confirmations.length > 0 && (
        <ul className="divide-y border-t">
          {card.confirmations.map((item) => (
            <li key={item.requirementId}>
              <label className="flex cursor-pointer gap-3 px-4 py-3">
                <Checkbox
                  className="mt-0.5"
                  checked={agreed.includes(item.requirementId)}
                  onCheckedChange={() => toggle(item.requirementId)}
                  disabled={disabled ?? busy}
                  aria-label={item.label}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-muted-foreground block text-2xs uppercase tracking-wide">
                    {INTRO[item.kind]}
                  </span>
                  <span className="block text-sm">{item.label}</span>
                  {item.knownValue !== null && (
                    <span className="text-muted-foreground tabular block text-xs">
                      {item.knownValue}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="bg-muted/40 border-t p-3">
        <Button
          size="sm"
          className="w-full"
          disabled={!canSubmit}
          onClick={() => {
            setBusy(true)
            void Promise.resolve(onSubmit?.(card.applicationId, agreed))
              .then((accepted) => {
                if (accepted === true) setSubmitted(true)
              })
              .finally(() => setBusy(false))
          }}
        >
          {busy
            ? 'Submitting…'
            : outstanding.length > 0
              ? `${String(outstanding.length)} left to confirm`
              : card.confirmLabel}
        </Button>
      </div>
    </Card>
  )
}
