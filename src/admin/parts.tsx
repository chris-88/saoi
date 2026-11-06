import type { ReactNode } from 'react'
import { CalendarIcon } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Period } from '@contracts/admin.ts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

/**
 * The pieces every console screen is built from (§12 of the redesign request).
 *
 * They live together because the point of them is consistency: a metric, a key/value row and a
 * confirmation should look the same on every screen, and the surest way to get that is for there
 * to be one of each. Each is a composition of shadcn primitives rather than a new component with
 * chrome of its own.
 */

/** The title, the sentence under it, and whatever acts on the screen. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  readonly title: string
  readonly description?: string
  readonly actions?: ReactNode
}): ReactNode {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && (
          <p className="text-muted-foreground text-sm text-pretty">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/**
 * One number, what it means, and which way it is going.
 *
 * The comparison is passed as the previous window's count rather than a computed percentage, so
 * the card can tell the three cases apart: nothing to compare against, a previous window of zero,
 * and an ordinary change. A prototype a day old is in the middle case for every metric, and
 * "0%" would claim nothing had happened.
 */
export function MetricCard({
  label,
  value,
  previous,
  note,
  chart,
  display,
}: {
  readonly label: string
  readonly value: number
  readonly previous?: number | null | undefined
  readonly note?: string
  readonly chart?: ReactNode
  /**
   * What to print instead of the number.
   *
   * The value still drives the comparison, because a percentage change works the same whether
   * the thing is a count or an amount of money. Only the rendering differs.
   */
  readonly display?: string
}): ReactNode {
  return (
    /*
     * Smaller below the stacking breakpoint, and the explanation goes.
     *
     * Five of these at full size filled an entire phone screen before the case list began, so
     * the first thing anybody saw on a phone was the summary of a list they could not reach.
     * The numbers are what a glance is for; the sentence under each one is for somebody with
     * room to read it.
     */
    <Card className="gap-1 py-4 lg:gap-2 lg:py-6">
      <CardHeader className="px-4 lg:px-6">
        <CardDescription className="text-xs lg:text-sm">{label}</CardDescription>
        <CardTitle className="tabular flex items-baseline gap-2 text-2xl lg:text-3xl">
          {display ?? value.toLocaleString('en-IE')}
          <Comparison value={value} previous={previous} />
        </CardTitle>
      </CardHeader>
      <CardContent className="hidden space-y-2 px-4 lg:block lg:px-6">
        {chart}
        {note !== undefined && <p className="text-muted-foreground text-xs">{note}</p>}
      </CardContent>
    </Card>
  )
}

/**
 * How this window compares with the one before it.
 *
 * Deliberately not coloured green for up and red for down: blocked requests falling is good and
 * conversations falling is not, and the card has no way to know which it is holding. The arrow
 * says what happened; the label says whether to care.
 */
function Comparison({
  value,
  previous,
}: {
  readonly value: number
  readonly previous: number | null | undefined
}): ReactNode {
  // No earlier window — `all time`, or a period that reaches past the first event.
  if (previous === null || previous === undefined) return null

  if (previous === 0) {
    // All of it is new. A percentage of zero is not a number worth printing.
    return value === 0 ? null : (
      <span className="text-muted-foreground text-sm font-normal">all new</span>
    )
  }

  const change = Math.round(((value - previous) / previous) * 100)
  if (change === 0) return <span className="text-muted-foreground text-sm font-normal">level</span>

  return (
    <span className="text-muted-foreground text-sm font-normal">
      {change > 0 ? '↑' : '↓'} {Math.abs(change)}%
    </span>
  )
}

/**
 * Facts, in two columns.
 *
 * A table would draw a grid around five short strings. Values wrap and align right so a column
 * of amounts reads as a column.
 */
export function KeyValueList({
  items,
  className,
}: {
  readonly items: readonly {
    readonly key: string
    readonly value: ReactNode
  }[]
  readonly className?: string
}): ReactNode {
  if (items.length === 0) return null

  return (
    <dl className={cn('divide-y', className)}>
      {items.map((item) => (
        <div key={item.key} className="flex items-baseline justify-between gap-4 py-2 first:pt-0">
          <dt className="text-muted-foreground shrink-0 text-sm">{item.key}</dt>
          <dd className="min-w-0 text-right text-sm">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** One term and its definition, for the catalogue screens. */
export function DefinitionListItem({
  term,
  children,
}: {
  readonly term: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <div className="flex gap-4 py-3">
      <dt className="text-muted-foreground w-32 shrink-0 text-sm">{term}</dt>
      <dd className="min-w-0 flex-1 space-y-1 text-sm">{children}</dd>
    </div>
  )
}

/**
 * Something that happened, as one line.
 *
 * `signal` marks the handful worth watching happen — a plan formed, a milestone reached, a
 * notification sent — so the bookkeeping between them can stay quiet without being hidden.
 */
export function EventRow({
  at,
  describe,
  actor,
  object,
  signal,
}: {
  readonly at: string
  readonly describe: string
  readonly actor?: string
  readonly object?: string
  readonly signal?: boolean
}): ReactNode {
  return (
    <div className={cn('flex items-baseline gap-3 px-4 py-2.5', signal === true && 'bg-primary/5')}>
      <span
        aria-hidden
        className={cn(
          'mt-1.5 size-1.5 shrink-0 rounded-full',
          signal === true ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm', signal !== true && 'text-muted-foreground')}>
          {describe}
        </span>
        {(actor !== undefined || object !== undefined) && (
          <span className="text-muted-foreground block text-xs">
            {[object, actor].filter((part) => part !== undefined).join(' · ')}
          </span>
        )}
      </span>
      <Badge variant="outline" className="text-2xs tabular shrink-0">
        {at}
      </Badge>
    </div>
  )
}

/**
 * Anything irreversible asks once (§2.5).
 *
 * The confirm button repeats what will happen rather than saying "Continue", so the last thing
 * read before the click is the consequence.
 */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  readonly trigger: ReactNode
  readonly title: string
  readonly description: string
  readonly confirmLabel: string
  readonly onConfirm: () => void
}): ReactNode {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** A button that is off, with the reason on hover rather than in permanent small print. */
export function ReasonedButton({
  children,
  reason,
  disabled,
  onClick,
  variant = 'outline',
}: {
  readonly children: ReactNode
  readonly reason: string
  readonly disabled: boolean
  readonly onClick: () => void
  readonly variant?: 'outline' | 'default' | 'ghost'
}): ReactNode {
  return (
    <Button variant={variant} disabled={disabled} onClick={onClick} title={reason}>
      {children}
    </Button>
  )
}

/** How far back the numbers reach. Shared, because two screens count over the same window. */
export function PeriodSelect({
  value,
  onChange,
}: {
  readonly value: Period
  readonly onChange: (next: Period) => void
}): ReactNode {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as Period)}>
      <SelectTrigger className="w-40">
        <CalendarIcon />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="7d">Last 7 days</SelectItem>
        <SelectItem value="30d">Last 30 days</SelectItem>
        <SelectItem value="90d">Last 90 days</SelectItem>
        <SelectItem value="all">All time</SelectItem>
      </SelectContent>
    </Select>
  )
}
