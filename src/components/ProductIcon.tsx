import type { ReactNode } from 'react'
import {
  CreditCardIcon,
  HomeIcon,
  PiggyBankIcon,
  ShieldCheckIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react'
import type { Product } from '@domain/journey.ts'
import { cn } from '@/lib/utils'

/**
 * A product in a tinted tile, as every board renders them.
 *
 * Each product carries its own colour so a list of them reads as distinct things rather than
 * rows of the same blue. The mapping is keyed by the domain's `Product` union, so a new
 * product cannot be added without choosing how it looks.
 */
const PRODUCTS: Record<Product, { icon: ReactNode; tint: string; ink: string }> = {
  mortgage: {
    icon: <HomeIcon />,
    tint: 'bg-product-mortgage/10',
    ink: 'text-product-mortgage',
  },
  current_account: {
    icon: <WalletIcon />,
    tint: 'bg-product-current-account/10',
    ink: 'text-product-current-account',
  },
  joint_account: {
    icon: <UsersIcon />,
    tint: 'bg-product-joint-account/10',
    ink: 'text-product-joint-account',
  },
  credit_card: {
    icon: <CreditCardIcon />,
    tint: 'bg-product-credit-card/10',
    ink: 'text-product-credit-card',
  },
  personal_loan: {
    icon: <PiggyBankIcon />,
    tint: 'bg-product-personal-loan/10',
    ink: 'text-product-personal-loan',
  },
  savings: {
    icon: <PiggyBankIcon />,
    tint: 'bg-product-savings/10',
    ink: 'text-product-savings',
  },
  protection: {
    icon: <ShieldCheckIcon />,
    tint: 'bg-product-protection/10',
    ink: 'text-product-protection',
  },
}

export function ProductIcon({
  product,
  size = 'md',
  className,
}: {
  product: Product
  size?: 'sm' | 'md' | 'lg'
  className?: string
}): ReactNode {
  const style = PRODUCTS[product]

  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-xl [&>svg]:size-[52%]',
        size === 'sm' && 'size-9',
        size === 'md' && 'size-11',
        size === 'lg' && 'size-12',
        style.tint,
        style.ink,
        className,
      )}
    >
      {style.icon}
    </span>
  )
}
