import { useState, type ReactNode } from 'react'
import { ArrowRightIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ProductIcon } from '@/components/ProductIcon'
import { Settling } from '@/saoirse/cards/Settling'
import type { Settled } from '@/saoirse/cardState'
import { cn } from '@/lib/utils'

type Payload = Extract<CardPayload, { type: 'product_options' }>
type Option = Payload['options'][number]
export type ProductChoice = { product: string; catalogueId?: string }

/**
 * What identifies a row.
 *
 * It used to be the product kind, which was fine until two rows shared one. SuperSaver and the
 * 31-Day Notice Account are both `savings`: they collided on the React key, and ticking
 * either box ticked both, because the selection was a list of kinds.
 */
const identify = (option: Option): string => option.catalogueId ?? option.product

/**
 * §8, §49 — Saoirse explains why something might fit; the customer chooses.
 *
 * Nothing is pre-selected and declining is offered beside accepting, because §49 is explicit
 * that discovery must not become cross-selling. Selecting calls `case-action`, which is what
 * actually creates applications (Invariant 1).
 */
export function ProductOptionsCard({
  card,
  onSelect,
  onDecline,
  disabled,
}: {
  card: Payload
  onSelect?: (products: readonly ProductChoice[]) => Promise<void> | void
  onDecline?: (products: readonly ProductChoice[]) => Promise<void> | void
  disabled?: boolean
}): ReactNode {
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)
  /**
   * What became of the card, the moment it did.
   *
   * The same shape `cardState` works out from the database on reload, so the card settles to
   * the identical thing whether the tap landed a second ago or a day ago.
   */
  const [done, setDone] = useState<Settled | undefined>(undefined)

  const named = (keys: readonly string[]): readonly string[] =>
    card.options
      .filter((option) => keys.includes(identify(option)))
      .map((option) => option.displayName)

  const toggle = (key: string) =>
    setChosen((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    )

  const choices = (keys: readonly string[]): readonly ProductChoice[] =>
    card.options
      .filter((option) => keys.includes(identify(option)))
      .map((option) => ({
        product: option.product,
        ...(option.catalogueId === undefined ? {} : { catalogueId: option.catalogueId }),
      }))

  const run = (
    fn: ((products: readonly ProductChoice[]) => Promise<void> | void) | undefined,
    products: readonly ProductChoice[],
    outcome: Settled,
  ) => {
    if (!fn || products.length === 0 || busy) return
    setBusy(true)

    /**
     * A card that has committed stays spent.
     *
     * `busy` used to clear on completion, which put a live "Not right now" back on screen while
     * Saoirse was still answering the first one. Choosing and declining are decisions, not controls,
     * and the card stays in the transcript afterwards as a record of what was decided. Only a
     * failure gives it back, because then nothing was decided.
     */
    void Promise.resolve(fn(products))
      .then(() => setDone(outcome))
      .catch(() => {
        setBusy(false)
      })
  }

  return (
    <Settling settled={done}>
      <Card className="gap-0 overflow-hidden p-0">
        <ul className="divide-y">
          {card.options.map((option) => {
            const key = identify(option)
            const selected = chosen.includes(key)

            return (
              <li key={key}>
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors',
                    selected ? 'bg-accent/40' : 'hover:bg-muted/50',
                  )}
                >
                  <ProductIcon product={option.product} />

                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-balance">
                        {option.displayName}
                      </span>
                      {option.previouslyDeclined && (
                        <Badge variant="secondary" className="text-2xs shrink-0">
                          Declined before
                        </Badge>
                      )}
                    </span>
                    <span className="text-muted-foreground block text-xs">{option.oneLine}</span>
                    <span className="text-foreground/75 block text-xs">{option.reason}</span>
                  </span>

                  <Checkbox
                    className="mt-1"
                    checked={selected}
                    onCheckedChange={() => toggle(key)}
                    disabled={disabled ?? busy}
                    aria-label={`Choose ${option.displayName}`}
                  />
                </label>
              </li>
            )
          })}
        </ul>

        <div className="bg-muted/40 space-y-2 border-t p-3">
          <Button
            size="sm"
            className="w-full"
            disabled={(disabled ?? busy) || chosen.length === 0}
            onClick={() =>
              run(onSelect, choices(chosen), {
                label: `Started ${named(chosen).join(' and ')}`,
                note:
                  chosen.length === 1
                    ? 'It is in your list, and you can pick it up whenever you like.'
                    : 'They are all in your list, and you can pick any of them up whenever you like.',
              })
            }
          >
            {chosen.length === 0
              ? 'Choose what to look at'
              : `Start ${String(chosen.length)} ${chosen.length === 1 ? 'application' : 'applications'}`}
            <ArrowRightIcon />
          </Button>

          {onDecline !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground w-full"
              disabled={disabled ?? busy}
              onClick={() =>
                run(onDecline, choices(card.options.map(identify)), {
                  label: 'Not for now',
                  note: card.options.map((option) => option.displayName).join(' and '),
                })
              }
            >
              Not right now
            </Button>
          )}
        </div>
      </Card>
    </Settling>
  )
}
