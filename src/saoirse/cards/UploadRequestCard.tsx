import { useRef, useState, type ReactNode } from 'react'
import { CheckIcon, FileTextIcon, UploadIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IconTile } from '@/components/IconTile'

type Payload = Extract<CardPayload, { type: 'upload_request' }>

/** What the bucket accepts. Stated here too so the picker does not offer the rest. */
const ACCEPT = 'image/png,image/jpeg,image/heic,application/pdf'
const MAX_BYTES = 10 * 1024 * 1024

/**
 * §6 Stage 7 — a document arrives here or not at all.
 *
 * The customer picks a file and the server stores it. Nothing is marked verified: a payslip
 * that needs checking stays outstanding until the bank says otherwise, because saying
 * otherwise on screen would make the card disagree with the case (Invariant 2).
 */
export function UploadRequestCard({
  card,
  onUpload,
  disabled,
}: {
  card: Payload
  onUpload?: (requestId: string, file: File, documentType: string) => Promise<void>
  disabled?: boolean
}): ReactNode {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const choose = async (file: File | undefined) => {
    if (!file) return
    setError(null)

    // Checked here as well as on the server, so a 10MB mistake does not cost an upload.
    if (file.size > MAX_BYTES) {
      setError('That file is larger than 10MB. Try a smaller one.')
      return
    }

    setBusy(true)
    try {
      await onUpload?.(card.requestId, file, card.documentType)
      setDone(file.name)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That upload did not work.')
    } finally {
      setBusy(false)
    }
  }

  if (done !== null) {
    return (
      <Card className="gap-0 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="bg-state-done/15 text-state-done grid size-9 shrink-0 place-items-center rounded-xl"
          >
            <CheckIcon className="size-4.5" strokeWidth={3} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{card.label} received</span>
            <span className="text-muted-foreground block truncate text-xs">{done}</span>
          </span>
        </div>
      </Card>
    )
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start gap-3 p-4">
        <IconTile tone="primary">
          <FileTextIcon />
        </IconTile>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-pretty">{card.label}</p>
          <p className="text-muted-foreground text-xs">
            For your {card.applicationName.toLowerCase()}. A photo or a PDF, up to 10MB.
          </p>
        </div>
      </div>

      <div className="space-y-2 border-t p-4">
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label={`Choose a file for ${card.label}`}
          onChange={(event) => {
            void choose(event.target.files?.[0])
            // Cleared so picking the same file again after a failure still fires onChange.
            event.target.value = ''
          }}
        />
        <Button
          size="sm"
          className="w-full"
          disabled={(disabled ?? false) || busy}
          onClick={() => input.current?.click()}
        >
          <UploadIcon />
          {busy ? 'Sending…' : 'Choose a file'}
        </Button>
        {error !== null && <p className="text-destructive text-xs">{error}</p>}
      </div>
    </Card>
  )
}
