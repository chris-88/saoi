import { useEffect, useState, type ReactNode } from 'react'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2Icon, UsersIcon } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { fade, useStill } from '@/lib/motion'
import type { PartnerTask, PartnerView } from '@contracts/partner.ts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { IconTile } from '@/components/IconTile'
import { StatusBadge } from '@/components/StatusBadge'
import { SaoiWordmark } from '@/saoirse/SaoiWordmark'
import { callPartner } from '@/partner/partnerClient'
import { isBackendConfigured } from '@/lib/env'
import { routes } from '@/app/routes'

/**
 * §6 Stage 9, §33 — the second applicant's experience.
 *
 * Deliberately small. They see their own tasks and the names and states of the applications
 * they are party to, and nothing else: not the primary's conversation, not the primary's
 * details, not anything they were not asked for (Invariant 7).
 */
export function PartnerJoin(): ReactNode {
  useDocumentTitle('Second applicant')
  const { token } = useParams<{ token: string }>()
  const [view, setView] = useState<PartnerView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(isBackendConfigured)
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isBackendConfigured || token === undefined) return
    let cancelled = false

    callPartner({ action: 'join', token })
      .then((result) => {
        if (!cancelled) setView(result)
      })
      .catch(() => {
        // Whatever went wrong underneath — malformed, voided by a newer invitation, or a
        // case that is gone — it is the same thing from here: this link will not get them in.
        if (!cancelled) {
          setError(
            'That invitation link isn’t valid. If a newer one was sent, use that; otherwise ' +
              'ask for a new one.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [token])

  const outstanding = (view?.tasks ?? []).filter((task) => !task.done && task.kind === 'fact')
  const ready = outstanding.every((task) =>
    task.inputKind === 'boolean' ? true : String(answers[task.id] ?? '').trim().length > 0,
  )

  async function submit(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      const result = await callPartner({
        action: 'submit',
        answers: outstanding.map((task) => ({
          id: task.id,
          value:
            task.inputKind === 'boolean'
              ? answers[task.id] === true
              : task.inputKind === 'number'
                ? Number(answers[task.id] ?? 0)
                : String(answers[task.id] ?? ''),
        })),
      })
      setView(result)
      setAnswers({})
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-background min-h-dvh">
      <header className="bg-card/95 supports-[backdrop-filter]:bg-card/80 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center gap-3 px-4 py-2.5">
          <span className="leading-tight">
            <SaoiWordmark className="h-5" />
            <span className="text-muted-foreground block text-2xs">Second applicant</span>
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md space-y-6 px-4 py-6">
        {loading && <Skeleton className="h-40 w-full" />}

        {error !== null && (
          /*
           * A dead end used to be the whole page: the message, then half a screen of nothing.
           * Somebody who followed a dead link is not at fault and has somewhere to go —
           * the person who sent it, or Saoirse itself.
           */
          <section className="space-y-4">
            <h1 className="text-h3 font-semibold">That link didn’t work</h1>
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <p className="text-muted-foreground text-sm leading-relaxed">
              An invitation keeps working until a newer one is sent. Whoever invited you can send a
              fresh one from their own conversation.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to={routes.saoirse}>Talk to Saoirse yourself</Link>
            </Button>
          </section>
        )}

        {view !== null && (
          <>
            <section className="space-y-4">
              <IconTile tone="deep" size="lg">
                <UsersIcon />
              </IconTile>
              <div className="space-y-1">
                <h1 className="text-h3 font-semibold">
                  {view.partnerName === null ? 'You’ve been invited' : `Hi ${view.partnerName}`}
                </h1>
                <p className="text-muted-foreground text-sm">
                  {view.invitedBy ?? 'Someone'} has asked you to complete your part. You&rsquo;ll
                  only ever see your own details here.
                </p>
              </div>
            </section>

            {view.applications.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">What you&rsquo;re on</h2>
                <Card className="gap-0 divide-y p-0">
                  {view.applications.map((application) => (
                    <div
                      key={application.displayName}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <span className="min-w-0 flex-1 text-sm font-medium text-pretty">
                        {application.displayName}
                      </span>
                      <StatusBadge
                        state={application.waitingOnYou ? 'waiting_partner' : 'in_progress'}
                      />
                    </div>
                  ))}
                </Card>
              </section>
            )}

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Your tasks</h2>

              {view.tasks.length === 0 && (
                <Card className="p-4">
                  <p className="text-muted-foreground text-sm">Nothing needed from you yet.</p>
                </Card>
              )}

              <Card className="gap-0 divide-y p-0">
                {view.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    value={answers[task.id]}
                    onChange={(value) =>
                      setAnswers((current) => ({ ...current, [task.id]: value }))
                    }
                    disabled={saving}
                  />
                ))}
              </Card>

              {outstanding.length > 0 && (
                <Button
                  className="w-full"
                  disabled={!ready || saving}
                  onClick={() => void submit()}
                >
                  {saving ? 'Saving…' : 'Send these'}
                </Button>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function TaskRow({
  task,
  value,
  onChange,
  disabled,
}: {
  task: PartnerTask
  value: string | boolean | undefined
  onChange: (value: string | boolean) => void
  disabled: boolean
}): ReactNode {
  const still = useStill()

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor={task.id} className="text-sm font-normal">
            {task.label}
          </Label>
          {/*
            The whole point of §6 Stage 9: one answer, several journeys. As pills rather than a
            footnote, so one answer visibly serving three applications reads as the point.
          */}
          <p className="mt-1 flex flex-wrap items-center gap-1">
            <span className="text-muted-foreground text-2xs">Used for</span>
            {task.appliesTo.map((name) => (
              <span
                key={name}
                className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
              >
                {name}
              </span>
            ))}
          </p>
        </div>
        {/*
          Settles in place. The list used to be replaced wholesale on submit, so every row that
          had just been answered flashed from an input to a badge; the row stays mounted now,
          keyed on the task, and the badge fades in where the input was.
        */}
        <AnimatePresence initial={false}>
          {task.done && (
            <m.span key="done" className="shrink-0" {...(still ? {} : fade)}>
              <Badge variant="secondary" className="text-2xs">
                <CheckCircle2Icon className="size-3" />
                Done
              </Badge>
            </m.span>
          )}
        </AnimatePresence>
      </div>

      {!task.done &&
        task.kind === 'fact' &&
        (task.inputKind === 'select' ? (
          <Select
            {...(typeof value === 'string' ? { value } : {})}
            onValueChange={onChange}
            disabled={disabled}
          >
            <SelectTrigger id={task.id} className="w-full">
              <SelectValue placeholder="Choose one" />
            </SelectTrigger>
            <SelectContent>
              {(task.options ?? []).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : task.inputKind === 'boolean' ? (
          <Switch
            id={task.id}
            checked={value === true}
            onCheckedChange={onChange}
            disabled={disabled}
          />
        ) : (
          <Input
            id={task.id}
            type={task.inputKind === 'date' ? 'date' : 'text'}
            inputMode={task.inputKind === 'number' ? 'numeric' : 'text'}
            value={String(value ?? '')}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
          />
        ))}

      {!task.done && task.kind !== 'fact' && (
        <p className="text-muted-foreground text-xs">
          {task.kind === 'document' ? 'A document to upload.' : 'Confirmed when you submit.'}
        </p>
      )}
    </div>
  )
}
