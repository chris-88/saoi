import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { SaoirseMark } from '@/saoirse/SaoirseMark'
import { CustomerAvatar } from '@/saoirse/CustomerAvatar'

export type ChatAuthor = 'assistant' | 'customer'

/**
 * One turn in the conversation. Saoirse speaks on the left in a light bubble, the customer on the
 * right in the action colour.
 *
 * Portable by construction: no tenant and no shell imports (Invariant 11).
 */
export function ChatBubble({
  author,
  children,
  showAvatar = true,
  first = false,
}: {
  author: ChatAuthor
  children: ReactNode
  showAvatar?: boolean
  /** The first Saoirse turn, which is where the opening transition lands. */
  first?: boolean
}): ReactNode {
  const isSaoirse = author === 'assistant'

  return (
    <div
      className={cn('flex w-full items-start gap-2', isSaoirse ? 'justify-start' : 'justify-end')}
    >
      {isSaoirse &&
        (showAvatar ? (
          <span
            /*
             * The landing point for the opening transition (spec §5).
             *
             * Only the first Saoirse turn carries the name: `view-transition-name` has to be unique
             * on the page, and a transcript of six replies would otherwise declare it six times
             * and the browser would animate none of them.
             */
            {...(first === true ? { style: { viewTransitionName: 'saoirse-avatar' } } : {})}
            className="text-saoi-primary size-8 shrink-0 self-start"
          >
            <SaoirseMark />
          </span>
        ) : (
          <span className="size-8 shrink-0" />
        ))}

      <div
        className={cn(
          'max-w-[85%] rounded-chat px-3.5 py-2.5 text-sm leading-relaxed',
          isSaoirse
            ? 'bg-muted text-foreground rounded-bl-sm'
            : 'bg-primary text-primary-foreground rounded-br-sm',
        )}
      >
        {children}
      </div>

      {!isSaoirse &&
        (showAvatar ? (
          <CustomerAvatar className="self-start" />
        ) : (
          <span className="size-8 shrink-0" />
        ))}
    </div>
  )
}
