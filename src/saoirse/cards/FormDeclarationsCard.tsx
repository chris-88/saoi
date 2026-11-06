import { useState, type ReactNode } from 'react'
import { FileCheckIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconTile } from '@/components/IconTile'

type Payload = Extract<CardPayload, { type: 'form_declarations' }>

/**
 * The declarations the real application form requires, shown in its own words.
 *
 * Every other answer on a form can be carried over from something the customer said once. A
 * declaration cannot: it is only a declaration if the person read it and acted. So the wording
 * is the published wording, each one is ticked individually, and the confirm button does
 * nothing until all of them are.
 *
 * The model has no way to produce this outcome. `record_form_answers` refuses a checkbox field
 * whatever it is sent, so the only path from "the customer agreed" to a value in the packet
 * runs through this card (Invariant 1).
 */
export function FormDeclarationsCard({
  card,
  onConfirm,
  disabled,
}: {
  readonly card: Payload
  readonly onConfirm?: (applicationId: string, fieldIds: readonly string[]) => Promise<void> | void
  readonly disabled?: boolean
}): ReactNode {
  const [ticked, setTicked] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)

  const all = card.declarations.map((declaration) => declaration.fieldId)
  const complete = all.every((fieldId) => ticked.includes(fieldId))

  const toggle = (fieldId: string) => {
    setTicked((current) =>
      current.includes(fieldId) ? current.filter((id) => id !== fieldId) : [...current, fieldId],
    )
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start gap-3 p-4">
        <IconTile tone="deep">
          <FileCheckIcon />
        </IconTile>
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-semibold">Before this can be submitted</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {card.formName} needs each of these confirmed. They are the bank&rsquo;s words, not
            mine.
          </p>
        </div>
      </div>

      <div className="space-y-3 border-t px-4 py-3">
        {card.declarations.map((declaration) => (
          <label
            key={declaration.fieldId}
            className="flex cursor-pointer items-start gap-3 text-xs leading-relaxed"
          >
            <Checkbox
              checked={ticked.includes(declaration.fieldId)}
              onCheckedChange={() => toggle(declaration.fieldId)}
              disabled={disabled === true || busy}
              className="mt-0.5 shrink-0"
            />
            <span>{declaration.wording}</span>
          </label>
        ))}
      </div>

      <div className="border-t px-4 py-3">
        <Button
          className="w-full"
          disabled={!complete || disabled === true || busy}
          onClick={() => {
            if (!onConfirm) return
            setBusy(true)
            void Promise.resolve(onConfirm(card.applicationId, all)).finally(() => {
              setBusy(false)
            })
          }}
        >
          {busy ? 'Recording…' : 'I confirm all of the above'}
        </Button>
      </div>
    </Card>
  )
}
