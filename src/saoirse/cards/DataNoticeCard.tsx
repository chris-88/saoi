import type { ReactNode } from 'react'
import { ShieldCheckIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'

type Payload = Extract<CardPayload, { type: 'data_notice' }>

/**
 * What is kept, said once, at the moment it starts being true.
 *
 * Quieter than every other card on purpose. It is not a decision and there is nothing to tap
 * through — the basis for processing here is running the service somebody asked for, not their
 * agreement, so a button saying "I accept" would be theatre. It informs, and the conversation
 * carries on around it.
 *
 * The copy is the server's. Nothing here is written by the model.
 */
export function DataNoticeCard({ card }: { card: Payload }): ReactNode {
  return (
    <Card className="bg-muted/40 gap-0 border-dashed p-4 shadow-none">
      <div className="flex gap-3">
        <ShieldCheckIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-semibold">{card.title}</p>
          <ul className="text-muted-foreground space-y-1 text-xs leading-relaxed">
            {card.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <a
            className="text-muted-foreground hover:text-foreground inline-block text-xs underline"
            href={card.noticeHref}
            target="_blank"
            rel="noreferrer"
          >
            How your data is used
          </a>
        </div>
      </div>
    </Card>
  )
}
