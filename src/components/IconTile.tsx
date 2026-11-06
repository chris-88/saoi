import type { ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * The tinted rounded square that fronts every product, account and task row.
 * Tones are tokens, so a tile never invents a colour.
 */
const iconTileVariants = cva('grid shrink-0 place-items-center rounded-xl [&>svg]:size-[55%]', {
  variants: {
    tone: {
      primary: 'bg-primary/10 text-primary',
      deep: 'bg-brand-deep/10 text-brand-deep',
      success: 'bg-success/10 text-success',
      warning: 'bg-warning-border/35 text-warning-foreground',
      neutral: 'bg-muted text-muted-foreground',
      // Product accents, so a list of products reads as several things rather than one.
      mortgage: 'bg-product-mortgage/10 text-product-mortgage',
      loan: 'bg-product-personal-loan/10 text-product-personal-loan',
      protection: 'bg-product-protection/10 text-product-protection',
    },
    size: {
      sm: 'size-8',
      md: 'size-10',
      lg: 'size-12',
    },
  },
  defaultVariants: { tone: 'primary', size: 'md' },
})

export type IconTileProps = VariantProps<typeof iconTileVariants> & {
  children: ReactNode
  className?: string
}

export function IconTile({ children, tone, size, className }: IconTileProps): ReactNode {
  return (
    <span aria-hidden className={cn(iconTileVariants({ tone, size }), className)}>
      {children}
    </span>
  )
}
