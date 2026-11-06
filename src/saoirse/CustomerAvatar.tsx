import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import customerAvatar from '@/assets/avatars/customer.svg'
import partnerAvatar from '@/assets/avatars/partner.svg'

/**
 * The person on the other side of the conversation, from the asset pack.
 *
 * Decorative: the bubble it sits beside is already attributed by its position and colour, so
 * the avatar adds nothing for a screen reader and is hidden from one.
 */
export function CustomerAvatar({
  role = 'primary',
  className,
}: {
  role?: 'primary' | 'partner'
  className?: string
}): ReactNode {
  return (
    <img
      src={role === 'partner' ? partnerAvatar : customerAvatar}
      alt=""
      aria-hidden
      className={cn('size-8 shrink-0 rounded-full', className)}
    />
  )
}
