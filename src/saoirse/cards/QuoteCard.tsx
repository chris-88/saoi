import { useState, type ReactNode } from 'react'
import { ArrowRightIcon, CheckIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Payload = Extract<CardPayload, { type: 'quote' }>

/**
 * Options to compare, with the trade-off visible (§51).
 *
 * Not a product picker. Choosing one does not start anything — it asks Saoirse to go through that
 * option properly and to keep asking how the customer means to use and repay it, which is the
 * part a repayment figure on its own cannot do.
 *
 * Every figure here was computed by the server from the catalogue. The card renders them and
 * nothing else; there is no arithmetic in this file on purpose.
 */
export function QuoteCard({
  card,
  onDiscuss,
  disabled,
}: {
  card: Payload
  onDiscuss?: (option: { id: string; name: string }) => Promise<void> | void
  disabled?: boolean
}): ReactNode {
  const [chosen, setChosen] = useState<string | null>(null)

  const discuss = (option: { id: string; name: string }) => {
    if (disabled === true || chosen !== null) return
    setChosen(option.id)
    void Promise.resolve(onDiscuss?.(option)).catch(() => setChosen(null))
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="space-y-0.5 p-4 pb-3">
        <p className="text-sm font-semibold">
          Here{' '}
          {card.options.length === 1 ? 'is 1 option' : `are ${String(card.options.length)} options`}{' '}
          to compare
        </p>
        <p className="text-muted-foreground text-xs">
          Illustrative options for discussion, based on {card.basis}.
        </p>
      </div>

      <ul className="space-y-2 px-3 pb-3">
        {card.options.map((option) => {
          const picked = chosen === option.id

          return (
            <li key={option.id}>
              <div
                className={cn(
                  'rounded-xl border p-3 transition-colors',
                  picked && 'border-primary bg-primary/5',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold">{option.name}</span>
                  {option.highlight !== null && (
                    <Badge variant="secondary" className="text-2xs">
                      {option.highlight}
                    </Badge>
                  )}
                  {picked && <CheckIcon className="text-primary ml-auto size-4" />}
                </div>

                {/*
                  The headline first and largest: it is the number the decision turns on, and
                  burying it in a row of equals would make this a spreadsheet.
                */}
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                  <Figure label={option.headline.label} value={option.headline.value} lead />
                  {option.figures.map((figure) => (
                    <Figure key={figure.label} label={figure.label} value={figure.value} />
                  ))}
                </div>

                {option.footnote !== null && (
                  <p className="text-muted-foreground mt-2 text-xs">{option.footnote}</p>
                )}

                <Button
                  size="sm"
                  variant={picked ? 'default' : 'outline'}
                  className="mt-3 w-full"
                  disabled={disabled === true || chosen !== null}
                  onClick={() => discuss({ id: option.id, name: option.name })}
                >
                  {picked ? 'Talking it through…' : 'Discuss this option'}
                  <ArrowRightIcon />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      <p className="text-muted-foreground bg-muted/40 border-t px-4 py-2.5 text-2xs">
        Rates are illustrative and invented for this prototype. Real terms would come from the live
        product pages.
      </p>
    </Card>
  )
}

function Figure({
  label,
  value,
  lead,
}: {
  readonly label: string
  readonly value: string
  readonly lead?: boolean
}): ReactNode {
  return (
    <span className="min-w-0">
      <span className="text-muted-foreground block text-2xs">{label}</span>
      <span className={cn('block tabular', lead === true ? 'text-base font-semibold' : 'text-sm')}>
        {value}
      </span>
    </span>
  )
}
