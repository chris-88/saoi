import { useState, type ReactNode } from 'react'
import { ClipboardListIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { IconTile } from '@/components/IconTile'

type Payload = Extract<CardPayload, { type: 'health_form' }>

/**
 * §7.5, Invariant 6 — the only route by which special-category data enters the case.
 *
 * The customer types these themselves. `record_facts` refuses every key on this form, so
 * nothing here can arrive through conversation however the model is asked.
 */
export function HealthFormCard({
  card,
  onSubmit,
  disabled,
}: {
  card: Payload
  onSubmit?: (
    applicationId: string,
    values: readonly { key: string; value: unknown }[],
  ) => Promise<void> | void
  disabled?: boolean
}): ReactNode {
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({})
  const [busy, setBusy] = useState(false)

  const set = (key: string, value: string | boolean) =>
    setAnswers((current) => ({ ...current, [key]: value }))

  const complete = card.fields.every((field) =>
    field.kind === 'boolean' ? true : String(answers[field.key] ?? '').trim().length > 0,
  )

  const submit = () => {
    const values = card.fields.map((field) => {
      const raw = answers[field.key]
      if (field.kind === 'boolean') return { key: field.key, value: raw === true }
      if (field.kind === 'number') return { key: field.key, value: Number(raw ?? 0) }
      return {
        key: field.key,
        value: String(raw ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      }
    })

    setBusy(true)
    void Promise.resolve(onSubmit?.(card.applicationId, values)).finally(() => setBusy(false))
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center gap-3 border-b p-4">
        <IconTile tone="deep">
          <ClipboardListIcon />
        </IconTile>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{card.title}</p>
          <p className="text-muted-foreground text-xs">Only you can answer these.</p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {card.fields.map((field) =>
          field.kind === 'boolean' ? (
            <div key={field.key} className="flex items-center justify-between gap-3">
              <Label htmlFor={field.key} className="text-sm font-normal">
                {field.label}
              </Label>
              <Switch
                id={field.key}
                checked={answers[field.key] === true}
                onCheckedChange={(checked) => set(field.key, checked)}
                disabled={disabled ?? busy}
              />
            </div>
          ) : (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key} className="text-sm font-normal">
                {field.label}
                {field.unit !== null && (
                  <span className="text-muted-foreground"> ({field.unit})</span>
                )}
              </Label>
              <Input
                id={field.key}
                inputMode={field.kind === 'number' ? 'numeric' : 'text'}
                placeholder={field.kind === 'text_list' ? 'Separate with commas, or “none”' : ''}
                value={String(answers[field.key] ?? '')}
                onChange={(event) => set(field.key, event.target.value)}
                disabled={disabled ?? busy}
              />
            </div>
          ),
        )}
      </div>

      <div className="bg-muted/40 border-t p-3">
        <Button
          size="sm"
          className="w-full"
          disabled={(disabled ?? busy) || !complete}
          onClick={submit}
        >
          {busy ? 'Saving…' : 'Send these answers'}
        </Button>
        <p className="text-muted-foreground mt-2 text-center text-2xs">
          These go straight into your application. Saoirse never sees them in the conversation.
        </p>
      </div>
    </Card>
  )
}
