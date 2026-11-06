import type { ReactNode } from 'react'
import { CheckIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The moment something is actually done.
 *
 * Not a card the model asks for: it is rendered by whichever component completed the action, so
 * it can only appear after the server confirmed it (Invariant 2). The model can describe a
 * submit all it likes — this tick only exists because `case-action` returned.
 */
export function ConfirmationCard({
  title,
  body,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  className,
}: {
  title: string
  body: string
  primaryLabel?: string
  onPrimary?: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  className?: string
}): ReactNode {
  return (
    <Card
      className={cn(
        'from-state-done/10 items-center gap-0 bg-gradient-to-b to-transparent px-5 py-6 text-center',
        className,
      )}
    >
      <span
        aria-hidden
        className="bg-state-done grid size-14 place-items-center rounded-full text-white shadow-sm"
      >
        <CheckIcon className="size-7" strokeWidth={3} />
      </span>

      <h3 className="mt-4 text-base font-semibold text-balance">{title}</h3>
      <p className="text-muted-foreground mt-1.5 text-sm text-pretty">{body}</p>

      {(onPrimary ?? onSecondary) && (
        <div className="mt-5 flex w-full flex-col gap-2">
          {onPrimary && primaryLabel && (
            <Button type="button" onClick={onPrimary} className="w-full">
              {primaryLabel}
            </Button>
          )}
          {onSecondary && secondaryLabel && (
            <Button type="button" variant="outline" onClick={onSecondary} className="w-full">
              {secondaryLabel}
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}
