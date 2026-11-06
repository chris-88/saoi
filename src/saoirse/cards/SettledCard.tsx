import type { ReactNode } from 'react'
import { CheckIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'

/**
 * What a card becomes once its decision has been made.
 *
 * A settled card used to render in full, greyed out, with a line of green text underneath it.
 * That left the whole offer on screen — every option, every rate, both buttons — in a state
 * that said "this is over" while still looking like something to read and decide. A kept plan
 * took most of a screen to say it had been kept.
 *
 * The plan card already did the right thing the moment it was tapped: it collapsed to a check
 * and a line. It just could not survive a reload, because that state was local and the settled
 * path knew nothing about it. This is that shape, in one place, used by both — so a card looks
 * the same when the tap lands and when the conversation is opened again a day later.
 */
export function SettledCard({
  label,
  note,
}: {
  /** What happened, in the customer's terms. */
  label: string
  /** One line of reassurance or detail, where there is something worth adding. */
  note?: string | undefined
}): ReactNode {
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
          <span className="block text-sm font-semibold text-balance">{label}</span>
          {note !== undefined && (
            <span className="text-muted-foreground block text-xs">{note}</span>
          )}
        </span>
      </div>
    </Card>
  )
}
