import type { ReactNode } from 'react'
import { WalletIcon } from 'lucide-react'
import type { Card as CardPayload } from '@contracts/cards.ts'
import { Card } from '@/components/ui/card'
import { IconTile } from '@/components/IconTile'
import { Reveal } from '@/components/Primitives'
import { STAGGER } from '@/lib/motion'

type Payload = Extract<CardPayload, { type: 'accounts_overview' }>

/**
 * One view of the customer's money, across the accounts they linked.
 *
 * Something to read, not something to decide: nothing on it is tappable. Every figure is the
 * server's, built from the linked rows and their transactions, and the salary and the regular
 * outgoings are detected there, not guessed by the model. The rows arrive a beat apart, as the
 * reuse card's do, because this is the other moment the room should watch something fill in
 * from what was already there.
 *
 * Savings held is the figure that matters: it is what a transfer is offered against.
 */
export function AccountsOverviewCard({ card }: { card: Payload }): ReactNode {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <IconTile tone="primary">
          <WalletIcon />
        </IconTile>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-balance">Your money, in one place</h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            As of {dateTime(card.asOf)}, through Nexus.
          </p>
        </div>
      </div>

      <ul className="divide-y border-t">
        {card.accounts.map((account, index) => (
          <Reveal key={account.id} mode="mount" delay={index * STAGGER}>
            <li className="flex items-baseline gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {account.bank}
                  <span className="text-muted-foreground font-normal">
                    {' '}
                    · {account.displayName}
                  </span>
                </p>
                <p className="text-muted-foreground text-xs tabular-nums">{account.ibanMasked}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {money(account.balance)}
              </span>
            </li>
          </Reveal>
        ))}
      </ul>

      {/* This month so far. Two figures, no arithmetic between them: the gap is for Saoirse to say. */}
      <div className="grid grid-cols-2 divide-x border-t">
        <div className="px-4 py-3">
          <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
            In this month
          </p>
          <p className="text-state-done mt-0.5 text-lg font-semibold tabular-nums">
            {money(card.month.moneyIn)}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
            Out this month
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{money(card.month.moneyOut)}</p>
        </div>
      </div>

      <div className="space-y-2.5 border-t px-4 py-3 text-sm">
        {card.salary !== null && (
          <p>
            <span className="font-medium">Pay</span>
            <span className="text-muted-foreground">
              {' '}
              {money(card.salary.amount)} from {card.salary.employer}, last on{' '}
              {day(card.salary.lastOn)}
            </span>
          </p>
        )}

        {card.regular.length > 0 && (
          <div>
            <p className="font-medium">Regular outgoings</p>
            <ul className="mt-1 space-y-0.5">
              {card.regular.map((item) => (
                <li
                  key={`${item.label}-${String(item.amount)}`}
                  className="text-muted-foreground flex items-baseline justify-between gap-3 text-xs"
                >
                  <span className="min-w-0 truncate">{item.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {money(item.amount)} {item.cadence}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="bg-muted/40 flex items-baseline justify-between gap-3 border-t px-4 py-3">
        <span className="text-sm font-medium">In savings</span>
        <span className="text-xl font-semibold tabular-nums">{money(card.savingsHeld)}</span>
      </div>
    </Card>
  )
}

const money = (amount: number): string => `€${Math.round(amount).toLocaleString('en-IE')}`

/** "25 Sep", or the string as sent when it is not a date the browser can read. */
function day(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })
}

function dateTime(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleString('en-IE', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
}
