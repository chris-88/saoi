import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { HandshakeIcon, MessageCircleQuestionIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Textarea } from '@/components/ui/textarea'
import { readArrivalSource } from '@/lib/arrival'
import { registerInterest } from '@/lib/session'
import { cn } from '@/lib/utils'

/**
 * "Want to work on this?" (§44).
 *
 * The one ask the public pages make. After the show and tell the question is no longer
 * whether the thing works but who takes it further, and the people who might are the ones
 * reading this page. One line of why, a short form, and a thank-you in its place once sent.
 *
 * The `website` field is a honeypot: visually hidden, out of the tab order, filled only by
 * something that fills every field. The server refuses anything sent in it, and its message is
 * what gets shown, so a real person who somehow lands in it sees why rather than a shrug.
 */
const schema = z.object({
  name: z.string().trim().min(2, 'Your name, so we know who to write to.').max(120),
  email: z.string().trim().email('That does not look like an address.').max(200),
  organisation: z.string().trim().max(120),
  role: z.string().trim().max(120),
  interest: z
    .string()
    .trim()
    .min(5, 'A sentence is plenty.')
    .max(2000, 'That is longer than the box will take.'),
  // A boolean here so the box can start unticked; the contract's literal `true` is sent
  // only once it has been.
  consent: z.boolean().refine((ticked) => ticked, 'We can only write to you if you say so.'),
  website: z.string().max(200),
})

type Values = z.infer<typeof schema>

const COPY = {
  collaborate: {
    heading: 'Want to work on this?',
    lead: 'Saoirse is a proof of concept. If you’d like to take it further, in a bank or alongside one, leave your details.',
    label: 'What you’d bring',
    placeholder: 'A bank, a team, a problem this would solve, or just curiosity.',
    consent: 'You can contact me about this',
    thanks: 'Thanks. You’ll hear back from a person, not a system.',
  },
  question: {
    heading: 'Ask a question',
    lead: 'Anything the showcase raised and did not answer. Questions are answered by a person, by email, after the session.',
    label: 'Your question',
    placeholder: 'What would you like to know?',
    consent: 'You can reply to me by email',
    thanks: 'Thanks. You’ll get an answer from a person, not a system.',
  },
} as const

export function Collaborate({
  page,
  kind = 'collaborate',
  className,
}: {
  /** Which page the form was on, kept as the source when the address carried none. */
  readonly page: 'landing' | 'how-it-works' | 'ask'
  /** An offer to work on this, or a question to answer. */
  readonly kind?: 'collaborate' | 'question'
  readonly className?: string
}): ReactNode {
  const [sent, setSent] = useState(false)
  const copy = COPY[kind]

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      organisation: '',
      role: '',
      interest: '',
      consent: false,
      website: '',
    },
  })

  const register = useMutation({
    mutationFn: (values: Values) =>
      registerInterest({
        kind,
        name: values.name,
        email: values.email,
        ...(values.organisation.length === 0 ? {} : { organisation: values.organisation }),
        ...(values.role.length === 0 ? {} : { role: values.role }),
        interest: values.interest,
        consent: true,
        source: readArrivalSource() ?? page,
        ...(values.website.length === 0 ? {} : { website: values.website }),
      }),
    onSuccess: () => setSent(true),
  })

  return (
    <section className={cn('scroll-mt-20', className)} id="collaborate">
      <Card className="max-w-2xl">
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              {kind === 'question' ? (
                <MessageCircleQuestionIcon className="text-primary size-5" aria-hidden />
              ) : (
                <HandshakeIcon className="text-primary size-5" aria-hidden />
              )}
              {copy.heading}
            </h2>
            <p className="text-muted-foreground text-sm text-pretty">{copy.lead}</p>
          </div>

          {sent ? (
            <p className="text-success text-sm font-medium" role="status">
              {copy.thanks}
            </p>
          ) : (
            <Form {...form}>
              <form
                className="space-y-4"
                onSubmit={(event) =>
                  void form.handleSubmit((values) => register.mutate(values))(event)
                }
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input autoComplete="name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" autoComplete="email" inputMode="email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="organisation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Organisation</FormLabel>
                        <FormControl>
                          <Input autoComplete="organization" {...field} />
                        </FormControl>
                        <FormDescription>Optional.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Role</FormLabel>
                        <FormControl>
                          <Input autoComplete="organization-title" {...field} />
                        </FormControl>
                        <FormDescription>Optional.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="interest"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{copy.label}</FormLabel>
                      <FormControl>
                        <Textarea rows={3} placeholder={copy.placeholder} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="consent"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-start gap-3">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(checked) => field.onChange(checked === true)}
                            onBlur={field.onBlur}
                            name={field.name}
                            ref={field.ref}
                            className="mt-0.5"
                          />
                        </FormControl>
                        <FormLabel className="font-normal leading-snug">{copy.consent}</FormLabel>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/*
                  The honeypot. Hidden from sight and from the tab order, named for what a
                  form-filler expects to find, never shown to a person. `aria-hidden` keeps it
                  out of a screen reader's form mode too.
                */}
                <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
                  <label htmlFor={`collaborate-website-${kind}`}>Website</label>
                  <input
                    id={`collaborate-website-${kind}`}
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    {...form.register('website')}
                  />
                </div>

                {register.isError && (
                  <p className="text-destructive text-sm" role="alert">
                    {register.error.message}
                  </p>
                )}

                <Button type="submit" disabled={register.isPending}>
                  {register.isPending ? 'Sending…' : 'Send'}
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
