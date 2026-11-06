import { useState, type ReactNode } from 'react'
import { PauseIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IconTile } from '@/components/IconTile'

type Payload = Extract<CardPayload, { type: 'pause_prompt' }>

/**
 * §6 Stage 8 — the advisory that holds an application back.
 *
 * Both choices are presented plainly and neither is pre-selected: Saoirse explains the trade-off,
 * the customer decides. The explanation comes from the deterministic advisory rule, not from
 * the model's judgement.
 */
export function PausePromptCard({
  card,
  onDecide,
  disabled,
}: {
  card: Payload
  onDecide?: (applicationId: string, decision: 'pause' | 'continue') => Promise<void> | void
  disabled?: boolean
}): ReactNode {
  const [busy, setBusy] = useState(false)

  const decide = (decision: 'pause' | 'continue') => {
    setBusy(true)
    void Promise.resolve(onDecide?.(card.applicationId, decision)).finally(() => setBusy(false))
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start gap-3 p-4">
        <IconTile tone="warning">
          <PauseIcon />
        </IconTile>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold">{card.advisoryTitle}</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {card.advisoryExplanation}
          </p>
        </div>
      </div>

      <div className="bg-muted/40 grid grid-cols-2 gap-2 border-t p-3">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled ?? busy}
          onClick={() => decide('continue')}
        >
          Keep going
        </Button>
        <Button size="sm" disabled={disabled ?? busy} onClick={() => decide('pause')}>
          Hold it for now
        </Button>
      </div>
    </Card>
  )
}
