import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * How far an application has got. The boards show a percentage beside the bar, so the number
 * is announced rather than left to the eye.
 */
export function ProgressBar({
  value,
  label,
  className,
}: {
  /** 0 to 1. */
  value: number
  label?: string
  className?: string
}): ReactNode {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100)

  return (
    <div className={cn('space-y-1', className)}>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
        className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
      >
        <div
          className="bg-primary h-full rounded-full transition-[width] duration-500"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      {label !== undefined && (
        <p className="text-muted-foreground tabular text-2xs">
          {label} · {percent}%
        </p>
      )}
    </div>
  )
}
