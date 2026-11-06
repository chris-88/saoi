import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { MessageSquareHeartIcon, StarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { runCaseAction } from '@/lib/caseActions'
import { cn } from '@/lib/utils'

/**
 * "Tell us what you think" (§44).
 *
 * A rating of the whole conversation rather than of one reply, from the menu rather than
 * from the transcript, because the question is different: not "was that answer right" but
 * "was this worth your time". It asks for an address only if they want a reply, and says so.
 *
 * The same `give_feedback` action as the thumbs, with `kind: 'session'`, and for the same
 * reason the result is not told to Saoirse: this is about the conversation, not part of it.
 */
const schema = z.object({
  rating: z.number().int().min(1, 'Pick a number first.').max(5),
  comment: z.string().trim().max(2000, 'That is longer than the box will take.'),
  // Empty is "no reply wanted". The contract's own check runs again on the server.
  replyTo: z.union([
    z.literal(''),
    z.string().trim().email('That does not look like an address.').max(200),
  ]),
})

type Values = z.infer<typeof schema>

const STARS = [1, 2, 3, 4, 5] as const

export function FeedbackSheet({ caseId }: { readonly caseId: string | null }): ReactNode {
  const [open, setOpen] = useState(false)
  const [thanked, setThanked] = useState(false)

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { rating: 0, comment: '', replyTo: '' },
  })

  const send = useMutation({
    mutationFn: (values: Values) => {
      if (caseId === null) throw new Error('Nothing to give feedback on yet.')
      return runCaseAction({
        action: 'give_feedback',
        caseId,
        kind: 'session',
        rating: values.rating,
        ...(values.comment.length === 0 ? {} : { comment: values.comment }),
        ...(values.replyTo.length === 0 ? {} : { replyTo: values.replyTo }),
      })
    },
    onSuccess: () => {
      setThanked(true)
      // Long enough to read the thanks; short enough that nobody reaches for the close.
      window.setTimeout(() => setOpen(false), 1400)
    },
  })

  const change = (next: boolean): void => {
    setOpen(next)
    if (next) {
      // A fresh form each time it opens. What they sent last time has been sent.
      form.reset()
      send.reset()
      setThanked(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="w-full" disabled={caseId === null}>
          <MessageSquareHeartIcon className="size-4" />
          Tell us what you think
        </Button>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        className="mx-auto max-w-md rounded-t-xl pb-[max(1rem,var(--safe-bottom))]"
      >
        <SheetHeader className="pb-0">
          <SheetTitle>What did you make of it?</SheetTitle>
          <SheetDescription>
            A person reads these. Nothing you say here goes to Saoirse.
          </SheetDescription>
        </SheetHeader>

        {thanked ? (
          <p className="text-success px-4 py-6 text-center text-sm font-medium">
            Thanks. That helps more than you would think.
          </p>
        ) : (
          <Form {...form}>
            <form
              className="space-y-4 px-4 pb-2"
              onSubmit={(event) => void form.handleSubmit((values) => send.mutate(values))(event)}
            >
              <FormField
                control={form.control}
                name="rating"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Out of five</FormLabel>
                    <FormControl>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        className="w-full"
                        value={field.value === 0 ? '' : String(field.value)}
                        onValueChange={(next) => {
                          // Radix clears to '' on a second tap; a rating cannot be unchosen.
                          if (next !== '') field.onChange(Number(next))
                        }}
                        onBlur={field.onBlur}
                      >
                        {STARS.map((star) => (
                          <ToggleGroupItem
                            key={star}
                            value={String(star)}
                            aria-label={`${String(star)} out of 5`}
                            className="flex-1"
                          >
                            <StarIcon
                              aria-hidden
                              className={cn(
                                'size-5 transition-colors',
                                field.value >= star
                                  ? 'fill-primary text-primary'
                                  : 'text-muted-foreground',
                              )}
                            />
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="comment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Anything to add?</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder="What worked, what did not, what you expected."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="replyTo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" inputMode="email" {...field} />
                    </FormControl>
                    <FormDescription>Only if you would like a reply.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {send.isError && <p className="text-destructive text-xs">{send.error.message}</p>}

              <Button type="submit" className="w-full" disabled={send.isPending}>
                {send.isPending ? 'Sending…' : 'Send'}
              </Button>
            </form>
          </Form>
        )}
      </SheetContent>
    </Sheet>
  )
}
