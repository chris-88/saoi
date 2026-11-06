import { useRef, useState, type ReactNode } from 'react'
import { PaperclipIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IconTile } from '@/components/IconTile'

type Payload = Extract<CardPayload, { type: 'form_upload' }>

/**
 * A document the bank's own form asks for.
 *
 * The limits shown are the control's own, read out of the published definition. Accepting a
 * file the real journey would reject would make the packet a fiction, and the whole point of
 * the packet is that it is not one.
 *
 * What ends up in the submission is a reference: which file answered which control. The bytes
 * go to private storage and the production hashes are left empty, because the service that
 * issues them is not ours and a fabricated signature is a forged credential.
 */
export function FormUploadCard({
  card,
  onAttach,
  disabled,
}: {
  readonly card: Payload
  readonly onAttach?: (
    formApplicationId: string,
    fieldId: string,
    file: File,
  ) => Promise<void> | void
  readonly disabled?: boolean
}): ReactNode {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [attached, setAttached] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const accept = card.acceptedExtensions.map((extension) => `.${extension}`).join(',')

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start gap-3 p-4">
        <IconTile tone="deep">
          <PaperclipIcon />
        </IconTile>
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-semibold">{card.label || 'A document is needed'}</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {card.formName} asks for this.
            {card.acceptedExtensions.length > 0 &&
              ` ${card.acceptedExtensions.join(', ').toUpperCase()}`}
            {card.maxFileSizeMb !== null && `, up to ${String(card.maxFileSizeMb)}MB`}.
          </p>
        </div>
      </div>

      <div className="border-t px-4 py-3">
        <input
          ref={input}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file || !onAttach) return

            setBusy(true)
            setError(null)
            void Promise.resolve(onAttach(card.formApplicationId, card.fieldId, file))
              .then(() => {
                setAttached(file.name)
              })
              .catch((caught: unknown) => {
                setError(caught instanceof Error ? caught.message : 'That did not go through.')
              })
              .finally(() => {
                setBusy(false)
              })
          }}
        />

        {attached === null ? (
          <Button
            className="w-full"
            variant="outline"
            disabled={disabled === true || busy}
            onClick={() => input.current?.click()}
          >
            {busy ? 'Attaching…' : 'Choose a file'}
          </Button>
        ) : (
          <p className="text-muted-foreground text-xs">Attached {attached}.</p>
        )}

        {error !== null && <p className="text-destructive mt-2 text-xs">{error}</p>}
      </div>
    </Card>
  )
}
