import { useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRightIcon, MailIcon, StarIcon, ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/admin/parts'
import { adminApi } from '@/admin/adminClient'
import { queryKeys } from '@/lib/queryKeys'
import { routes } from '@/app/routes'
import { cn } from '@/lib/utils'
import type { FeedbackItem, Period } from '@contracts/admin.ts'

/**
 * What people said (§44).
 *
 * Newest first, because the point of reading it is to find out what the last person thought.
 * A thumbs carries the reply it was on, trimmed, so a thumbs-down can be read without opening
 * the case; the link is there for when it needs to be.
 */
export function FeedbackScreen({ period }: { readonly period: Period }): ReactNode {
  const feedback = useQuery({
    queryKey: queryKeys.admin.feedback(period),
    queryFn: () => adminApi.listFeedback(period),
  })

  const items = useMemo(
    () => [...(feedback.data?.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [feedback.data],
  )

  const summary = useMemo(() => summarise(items), [items])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feedback"
        description="A thumbs on a reply, or a rating of the whole conversation from the menu. Nothing here was shown to Saoirse."
      />

      {feedback.isError && (
        <Alert variant="destructive">
          <AlertDescription>{feedback.error.message}</AlertDescription>
        </Alert>
      )}

      {feedback.isPending && (
        <div className="space-y-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      )}

      {feedback.data !== undefined && items.length === 0 && (
        <Empty className="border border-dashed py-16">
          <EmptyHeader>
            <EmptyTitle>Nothing said yet</EmptyTitle>
            <EmptyDescription>
              Nobody has rated a reply or the conversation in this window.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {items.length > 0 && (
        <>
          <p className="text-muted-foreground text-sm">
            {summary.thumbsUp} up, {summary.thumbsDown} down on replies
            {summary.ratings > 0 &&
              `; the conversation rated ${summary.average} out of 5 by ${String(summary.ratings)}`}
            .
          </p>

          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id}>
                <FeedbackRow item={item} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function FeedbackRow({ item }: { readonly item: FeedbackItem }): ReactNode {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="space-y-2 px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Rating item={item} />
          <Badge variant="outline" className="text-2xs">
            {item.kind === 'turn' ? 'reply' : 'conversation'}
          </Badge>
          <span className="text-muted-foreground text-xs">{when(item.createdAt)}</span>
          <span className="flex-1" />
          <Link
            to={routes.admin.case(item.caseId)}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
          >
            Open the case
            <ArrowUpRightIcon className="size-3" />
          </Link>
        </div>

        {item.comment !== null && item.comment.length > 0 && (
          <p className="text-sm whitespace-pre-wrap">{item.comment}</p>
        )}

        {item.about !== null && item.about.length > 0 && (
          <blockquote className="text-muted-foreground border-l-2 pl-3 text-xs leading-relaxed">
            {item.about}
          </blockquote>
        )}

        {item.replyTo !== null && (
          <a
            href={`mailto:${item.replyTo}`}
            className="text-primary inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
          >
            <MailIcon className="size-3" />
            {item.replyTo}
          </a>
        )}
      </CardContent>
    </Card>
  )
}

/** A thumb for a reply; five stars, the chosen number filled, for a conversation. */
export function Rating({
  item,
}: {
  readonly item: Pick<FeedbackItem, 'kind' | 'rating'>
}): ReactNode {
  if (item.kind === 'turn') {
    return item.rating > 0 ? (
      <span className="text-success inline-flex items-center" aria-label="Thumbs up">
        <ThumbsUpIcon className="size-4" />
      </span>
    ) : (
      <span className="text-destructive inline-flex items-center" aria-label="Thumbs down">
        <ThumbsDownIcon className="size-4" />
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`${String(item.rating)} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <StarIcon
          key={star}
          aria-hidden
          className={cn(
            'size-3.5',
            star <= item.rating ? 'fill-primary text-primary' : 'text-muted-foreground/40',
          )}
        />
      ))}
    </span>
  )
}

function summarise(items: readonly FeedbackItem[]) {
  const turns = items.filter((item) => item.kind === 'turn')
  const sessions = items.filter((item) => item.kind === 'session')
  const total = sessions.reduce((sum, item) => sum + item.rating, 0)
  return {
    thumbsUp: turns.filter((item) => item.rating > 0).length,
    thumbsDown: turns.filter((item) => item.rating < 0).length,
    ratings: sessions.length,
    average: sessions.length === 0 ? '0' : (total / sessions.length).toFixed(1),
  }
}

function when(iso: string): string {
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
