import { useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { runCaseAction } from '@/lib/caseActions'
import { cn } from '@/lib/utils'

/**
 * Two thumbs under a reply (§44).
 *
 * Quiet until hovered, because a rating control under every sentence Saoirse says would make the
 * transcript look like a survey. A thumbs-up is one tap. A thumbs-down opens one optional line
 * inline, where the reply is, rather than a dialog that takes them away from it.
 *
 * It goes to `case-action` like any other tap, and unlike every other tap the result is not
 * told to Saoirse: feedback is about the conversation, not part of it, and a reply that thanked
 * you for rating the previous reply would be exactly the kind of thing being rated.
 *
 * What was given is kept here and nowhere else on the client. The contract offers no read, so
 * a reload shows the thumbs again; a second rating on the same reply is the server's to keep
 * or collapse.
 */
export function TurnFeedback({
  caseId,
  messageId,
}: {
  readonly caseId: string
  readonly messageId: string
}): ReactNode {
  const [given, setGiven] = useState<1 | -1 | null>(null)
  const [commenting, setCommenting] = useState(false)
  const [comment, setComment] = useState('')

  const give = useMutation({
    mutationFn: (input: { readonly rating: 1 | -1; readonly comment: string }) => {
      const trimmed = input.comment.trim()
      return runCaseAction({
        action: 'give_feedback',
        caseId,
        kind: 'turn',
        messageId,
        rating: input.rating,
        ...(trimmed.length === 0 ? {} : { comment: trimmed }),
      })
    },
    onSuccess: (_result, input) => {
      setGiven(input.rating)
      setCommenting(false)
    },
  })

  if (given !== null) {
    return (
      <div className="text-muted-foreground flex items-center gap-1 pl-10 text-xs">
        <span className="text-primary inline-flex size-6 items-center justify-center" aria-hidden>
          {given === 1 ? (
            <ThumbsUpIcon className="size-3.5" />
          ) : (
            <ThumbsDownIcon className="size-3.5" />
          )}
        </span>
        <span>Thanks</span>
      </div>
    )
  }

  return (
    <div className="group pl-10">
      <div
        className={cn(
          'flex items-center gap-0.5 transition-opacity duration-200',
          // Faded until the pointer is near, and always visible once one is open or focused,
          // so a keyboard user is never aiming at something they cannot see.
          commenting
            ? 'opacity-100'
            : 'opacity-40 group-hover:opacity-100 has-[:focus-visible]:opacity-100',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="This reply was helpful"
          className="text-muted-foreground hover:text-primary"
          disabled={give.isPending}
          onClick={() => give.mutate({ rating: 1, comment: '' })}
        >
          <ThumbsUpIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="This reply was not helpful"
          aria-expanded={commenting}
          className={cn('text-muted-foreground hover:text-primary', commenting && 'text-primary')}
          disabled={give.isPending}
          onClick={() => setCommenting((open) => !open)}
        >
          <ThumbsDownIcon />
        </Button>
      </div>

      {commenting && (
        <form
          className="mt-1 flex max-w-[85%] items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            give.mutate({ rating: -1, comment })
          }}
        >
          <Input
            autoFocus
            value={comment}
            maxLength={500}
            placeholder="What was wrong? (optional)"
            aria-label="What was wrong"
            className="h-8 text-sm"
            disabled={give.isPending}
            onChange={(event) => setComment(event.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={give.isPending}>
            {give.isPending ? 'Sending…' : 'Send'}
          </Button>
        </form>
      )}

      {give.isError && <p className="text-destructive mt-1 text-xs">{give.error.message}</p>}
    </div>
  )
}
