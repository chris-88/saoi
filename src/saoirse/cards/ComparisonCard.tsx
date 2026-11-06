import { useState, type ReactNode } from 'react'
import { ArrowRightIcon, CheckIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Payload = Extract<CardPayload, { type: 'comparison' }>

/**
 * Several products from the catalogue, side by side (§51).
 *
 * Not a product picker: tapping one starts nothing, it asks Saoirse to go through that one. The
 * catalogue holds nine savings accounts and six credit cards, and describing four of them in a
 * paragraph asks somebody to hold four descriptions in their head while deciding — which is the
 * thing a comparison is for.
 *
 * Every word except the reason was read from the catalogue by the server. There is no product
 * detail in this file on purpose.
 */
export function ComparisonCard({
  card,
  onChoose,
  disabled,
}: {
  card: Payload
  onChoose?: (option: { id: string; name: string }) => Promise<void> | void
  disabled?: boolean
}): ReactNode {
  const [chosen, setChosen] = useState<string | null>(null)

  const choose = (option: { id: string; name: string }) => {
    if (disabled === true || chosen !== null) return
    setChosen(option.id)
    void Promise.resolve(onChoose?.(option)).catch(() => setChosen(null))
  }

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="space-y-0.5 p-4 pb-3">
        <p className="text-sm font-semibold">{card.title}</p>
        <p className="text-muted-foreground text-xs">
          Tap whichever you want to hear more about. Nothing starts from here.
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
                  <span className="min-w-0 flex-1 text-base font-semibold">{option.name}</span>
                  {picked && <CheckIcon className="text-primary size-4 shrink-0" />}
                </div>

                <p className="text-muted-foreground mt-1 text-xs">{option.oneLine}</p>

                {/*
                  Above the reason and in the largest type on the row. "How much are you giving
                  me for saving with you" is the question a deposit account is answering, and a
                  card that put features first made three accounts look interchangeable when one
                  of them pays a full percentage point more.
                */}
                {option.rate !== null && (
                  <div className="mt-2">
                    <p className="text-lg leading-tight font-semibold">{option.rate}</p>
                    {option.rateNote !== null && (
                      <p className="text-muted-foreground text-xs">{option.rateNote}</p>
                    )}
                  </div>
                )}

                {/* The reason is the model's and sits apart from the catalogue's own words, so
                    nobody reads "because you said you were saving monthly" as a product fact. */}
                <p className="mt-2 text-sm">{option.reason}</p>

                {option.highlights.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {option.highlights.map((highlight) => (
                      <Badge
                        key={highlight}
                        variant="secondary"
                        /*
                         * Badges default to `whitespace-nowrap shrink-0`, which is right for a
                         * word and wrong for a sentence: "Branch access and next-working-day
                         * online withdrawal" is a real feature string and it ran off the card.
                         * Wrapping keeps the fact whole rather than truncating a product term.
                         */
                        className="text-2xs max-w-full shrink text-left font-normal whitespace-normal"
                      >
                        {highlight}
                      </Badge>
                    ))}
                  </div>
                )}

                {option.endsIn !== null && (
                  <p className="text-muted-foreground mt-2 text-2xs">
                    Goes to {option.endsIn} — Saoirse takes you to the door, not through it.
                  </p>
                )}

                <Button
                  size="sm"
                  variant={picked ? 'default' : 'outline'}
                  className="mt-3 w-full"
                  disabled={disabled === true || chosen !== null}
                  onClick={() => choose({ id: option.id, name: option.name })}
                >
                  {picked ? 'Talking it through…' : 'Tell me about this one'}
                  <ArrowRightIcon />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      <p className="text-muted-foreground bg-muted/40 border-t px-4 py-2.5 text-2xs">
        Product details are illustrative synthetic figures for a demo bank. Rates and terms can
        change, so check the product pages for today&rsquo;s figures.
      </p>
    </Card>
  )
}
