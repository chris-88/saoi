import type { ReactNode } from 'react'
import { ActivityIcon } from 'lucide-react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { cn } from '@/lib/utils'
import type { AdminOverview } from '@contracts/admin.ts'

/**
 * §38 — what is happening, as it happens.
 *
 * The console already follows the case live over Realtime, so this can be left on screen and an
 * audience can watch a plan form, a milestone land and a check-in come due, rather than being
 * told it happened. Signals are the things worth watching; the bookkeeping between them stays
 * quiet so the moments that matter are legible.
 */
export function ActivityFeed({
  activity,
}: {
  readonly activity: AdminOverview['activity']
}): ReactNode {
  if (activity.length === 0) return null

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Live activity</CardTitle>
        <CardDescription>Updates as it happens.</CardDescription>
        <CardAction>
          <span className="flex items-center gap-1.5">
            {/* A quiet pulse, because "live" is a claim better shown than written. */}
            <span className="relative flex size-2">
              <span className="bg-primary absolute inline-flex size-full animate-ping rounded-full opacity-60" />
              <span className="bg-primary relative inline-flex size-2 rounded-full" />
            </span>
            <span className="text-muted-foreground text-xs">live</span>
          </span>
        </CardAction>
      </CardHeader>

      <CardContent className="px-0">
        <ScrollArea className="h-80">
          <div className="divide-y">
            {activity.map((item, index) => (
              <div
                key={`${item.at}-${String(index)}`}
                className={cn(
                  'flex items-baseline gap-3 px-6 py-2.5',
                  item.signal && 'bg-primary/5',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-1.5 size-1.5 shrink-0 rounded-full',
                    item.signal ? 'bg-primary' : 'bg-muted-foreground/30',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-sm',
                      item.signal ? 'font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {item.describe}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {item.caseLabel} · {item.actor}
                  </span>
                </span>
                <Badge variant="outline" className="text-2xs tabular shrink-0">
                  {new Date(item.at).toLocaleTimeString()}
                </Badge>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

/** Worth its own component: a feed with nothing in it looks broken rather than quiet. */
export function ActivityPlaceholder(): ReactNode {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ActivityIcon />
        </EmptyMedia>
        <EmptyTitle>Nothing yet</EmptyTitle>
        <EmptyDescription>
          Start a conversation and every fact, offer and decision appears here as it happens.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
