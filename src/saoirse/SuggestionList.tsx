import type { ReactNode } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Suggestion = {
  readonly id: string
  readonly label: string
  readonly icon?: ReactNode
}

/**
 * The openers Saoirse offers before the customer has typed anything, and the quick replies it
 * offers afterwards. Real buttons, not decorations: a tap is the same as typing the label.
 */
export function SuggestionList({
  suggestions,
  onSelect,
  disabled,
  className,
}: {
  suggestions: readonly Suggestion[]
  onSelect?: ((suggestion: Suggestion) => void) | undefined
  disabled?: boolean | undefined
  className?: string | undefined
}): ReactNode {
  if (suggestions.length === 0) return null

  return (
    <ul className={cn('grid gap-2', className)}>
      {suggestions.map((suggestion) => (
        <li key={suggestion.id}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect?.(suggestion)}
            className="border-input bg-card text-primary hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60 [&>svg]:size-4"
          >
            {suggestion.icon}
            <span className="flex-1 text-left">{suggestion.label}</span>
            <ChevronRightIcon aria-hidden className="text-muted-foreground size-4" />
          </button>
        </li>
      ))}
    </ul>
  )
}
