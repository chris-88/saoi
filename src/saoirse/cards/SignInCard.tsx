import type { ReactNode } from 'react'
import { CheckIcon, LockIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { lastKnownAddress } from '@/lib/identity'
import { SignInForm } from '@/saoirse/SignInForm'

type Payload = Extract<CardPayload, { type: 'sign_in' }>

/**
 * §28 — offered once, at the point where signing in protects something that already exists.
 *
 * Deliberately not a wall. Everything on screen stays usable, there is no "maybe later" to
 * dismiss and nothing is withheld: somebody who ignores this carries on exactly as before, and
 * the card stays in the transcript as a record of having been offered.
 */
export function SignInCard({ card, disabled }: { card: Payload; disabled?: boolean }): ReactNode {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex flex-col items-center px-4 pt-5 pb-4 text-center">
        <span className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-full">
          <LockIcon className="size-5" />
        </span>
        <h3 className="mt-3 text-base font-semibold text-balance">{card.title}</h3>

        <ul className="mt-3 space-y-1.5 text-left">
          {card.points.map((point) => (
            <li key={point} className="flex items-start gap-2 text-sm">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <span className="text-muted-foreground leading-relaxed">{point}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2 px-4 pb-4">
        <SignInForm
          {...(disabled === undefined ? {} : { disabled })}
          {...(() => {
            const known = lastKnownAddress()
            return known === null ? {} : { knownAddress: known }
          })()}
        />

        <p className="text-muted-foreground text-center text-xs leading-relaxed">
          {card.reassurance}
        </p>

        <p className="text-center">
          <a
            href={card.whyHref}
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
          >
            What Saoirse does with your details
          </a>
        </p>
      </div>
    </Card>
  )
}
