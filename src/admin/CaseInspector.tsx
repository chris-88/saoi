import { useState, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellIcon, CopyIcon, EyeOffIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusDot } from '@/components/StatusDot'
import { queryKeys } from '@/lib/queryKeys'
import { adminApi } from '@/admin/adminClient'
import { PlanControls } from '@/admin/PlanControls'
import { GoalInsight } from '@/admin/GoalInsight'
import type { ApplicationState } from '@domain/state-machine.ts'

const EVENT_LABELS: Record<string, string> = {
  received_by_bank: 'Received by the bank',
  information_requested: 'Ask for more information',
  information_supplied: 'Information supplied',
  documents_verified: 'Documents checked',
  assessment_approved: 'Approve',
  assessment_declined: 'Decline',
  completed: 'Complete',
}

/**
 * §40, §41, §42 — the case behind the conversation, and the controls that move it.
 *
 * Every button here is a state-machine transition, bar the document check, which marks what was
 * sent in and moves nothing. The server only offers the ones the machine will actually accept,
 * so nobody can reach an impossible state live.
 *
 * Split in two because a page that opens with everything on it is a page nobody reads. What a
 * person handling the call needs — applications, the plan, the notification — is always on
 * screen; what the engines concluded is a click away, because it is the most interesting part
 * of the build and the least useful part of a phone call.
 */
export function CaseInspector({
  caseId,
  show = 'all',
}: {
  readonly caseId: string
  readonly show?: 'handling' | 'reasoning' | 'all'
}): ReactNode {
  const queryClient = useQueryClient()
  const [notification, setNotification] = useState<{
    message: string
    url: string
    subscriptions: number
    delivered: number
  } | null>(null)

  /*
   * What the team is asking for, per application. The default is the wording the demo has
   * always used; a presenter can make it anything the customer will recognise. §41
   */
  const [requestDetails, setRequestDetails] = useState<Record<string, string>>({})
  const requestDetailFor = (applicationId: string): string =>
    requestDetails[applicationId] ?? 'one more payslip'

  /*
   * The default copy, editable rather than fixed.
   *
   * §35 keeps what the system sends by itself deliberately uninformative, because a
   * notification is read on a lock screen by whoever is holding the phone. A presenter typing
   * a sentence and choosing to send it is a different act, so this starts from the safe
   * wording and lets them change it — with the card saying where it will be read.
   */
  const [title, setTitle] = useState('Saoirse')
  const [body, setBody] = useState(
    'Saoirse has an update about something you\u2019re working on with us. Open Saoirse to pick it up.',
  )

  const inspection = useQuery({
    queryKey: queryKeys.admin.caseInspection(caseId),
    queryFn: () => adminApi.inspect(caseId),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.admin.caseInspection(caseId),
    })
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.cases() })
  }

  const simulate = useMutation({
    mutationFn: adminApi.simulate,
    onSuccess: refresh,
  })

  const notify = useMutation({
    mutationFn: () => adminApi.notify(caseId, { title: title.trim(), body: body.trim() }),
    onSuccess: (result) => {
      setNotification(result)
      refresh()
    },
  })

  if (inspection.isPending) return <Skeleton className="h-64 w-full" />
  if (inspection.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{inspection.error.message}</AlertDescription>
      </Alert>
    )
  }

  const data = inspection.data

  return (
    <div className="space-y-6">
      {show !== 'reasoning' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Applications and events</CardTitle>
            </CardHeader>
            <CardContent className="divide-y px-0 [&>*]:px-6">
              {data.applications.length === 0 && (
                <p className="text-muted-foreground p-4 text-sm">No applications on this case.</p>
              )}
              {data.applications.map((application) => (
                <div key={application.id} className="space-y-3 p-4">
                  <div className="flex items-center gap-3">
                    <StatusDot state={application.state as ApplicationState} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{application.displayName}</p>
                      <p className="text-muted-foreground text-xs">
                        {application.stateLabel}
                        {application.outstanding.length > 0 &&
                          ` · ${String(application.outstanding.length)} outstanding`}
                      </p>
                    </div>
                  </div>

                  {application.canSimulate.length > 0 ? (
                    <div className="space-y-2">
                      {application.canSimulate.includes('information_requested') && (
                        <div className="space-y-1">
                          <Label htmlFor={`request-detail-${application.id}`} className="text-xs">
                            What the team is asking for
                          </Label>
                          <Input
                            id={`request-detail-${application.id}`}
                            value={requestDetailFor(application.id)}
                            maxLength={120}
                            className="h-8 text-xs"
                            onChange={(event) =>
                              setRequestDetails((current) => ({
                                ...current,
                                [application.id]: event.target.value,
                              }))
                            }
                          />
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        {application.canSimulate.map((event) => (
                          <Button
                            key={event}
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            disabled={simulate.isPending}
                            onClick={() => {
                              // The server supplies the default when the box is empty, so a
                              // cleared field is the one-click button, not an error.
                              const detail = requestDetailFor(application.id).trim()
                              simulate.mutate({
                                applicationId: application.id,
                                event: event as Parameters<typeof adminApi.simulate>[0]['event'],
                                ...(event === 'information_requested' && detail.length > 0
                                  ? { detail }
                                  : {}),
                              })
                            }}
                          >
                            {EVENT_LABELS[event] ?? event}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-2xs">
                      Nothing the state machine will accept from here.
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notify</CardTitle>
              <CardDescription>
                A separate, deliberate action. The link needs a sign-in before anything is shown,
                and carries nothing about the case. §35, §42
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="notify-title" className="text-xs">
                  Title
                </Label>
                <Input
                  id="notify-title"
                  value={title}
                  maxLength={40}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <Label htmlFor="notify-body" className="text-xs">
                  Message
                </Label>
                <Textarea
                  id="notify-body"
                  value={body}
                  maxLength={150}
                  rows={3}
                  onChange={(event) => setBody(event.target.value)}
                />
                {/*
                  Said here rather than in a footnote, because this is the moment somebody is
                  deciding what to write. A phone shows it to whoever is holding it.
                */}
                <p className="text-muted-foreground text-xs">
                  This lands on a lock screen, where anyone holding the phone can read it.{' '}
                  {String(body.trim().length)}/150.
                </p>
              </div>

              <Button
                size="sm"
                variant="outline"
                disabled={notify.isPending || title.trim().length === 0 || body.trim().length === 0}
                onClick={() => notify.mutate()}
              >
                <BellIcon />
                {notify.isPending ? 'Sending…' : 'Send the notification'}
              </Button>

              {notification !== null && (
                <div className="space-y-2 rounded-lg border p-3">
                  {/*
                    What actually happened, not "sent". Nobody subscribed means nothing was
                    delivered, and that is worth learning here rather than from a dark phone.
                  */}
                  <p className="text-sm font-medium">
                    {notification.subscriptions === 0
                      ? 'Nobody on this case has notifications switched on.'
                      : `Delivered to ${String(notification.delivered)} of ${String(notification.subscriptions)} ${notification.subscriptions === 1 ? 'device' : 'devices'}.`}
                  </p>
                  <p className="text-muted-foreground text-sm">{notification.message}</p>
                  <div className="flex gap-2">
                    <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-2xs">
                      {notification.url}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void navigator.clipboard.writeText(notification.url)}
                    >
                      <CopyIcon />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <PlanControls caseId={caseId} plans={data.plans} onChanged={refresh} />
        </>
      )}

      {show !== 'handling' && (
        <>
          {/*
        Goals before needs, because that is the hierarchy: a goal is where they are going, a
        need is what is required along the way (§3).
      */}
          <GoalInsight data={data} />

          {/* §27 — a parked need is otherwise invisible: it looks exactly like one never raised. */}
          {data.parked.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Parked, and what brings it back</CardTitle>
              </CardHeader>
              <CardContent className="divide-y px-0 [&>*]:px-6">
                {data.parked.map((item) => (
                  <div key={item.needId} className="flex items-baseline gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{item.name}</span>
                      <span className="text-muted-foreground block text-2xs">
                        {item.reason}
                        {item.revisitWhen !== null &&
                          ` · returns when ${item.revisitWhen.replaceAll('_', ' ')}`}
                      </span>
                    </span>
                    <Badge variant={item.ready ? 'default' : 'secondary'} className="text-2xs">
                      {item.ready ? 'ready to raise' : 'waiting'}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {(data.needs.length > 0 || data.watches.length > 0) && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">What Saoirse makes of this, and why</h2>

              {data.needs.length > 0 && (
                <Card className="gap-0 divide-y p-0">
                  {data.needs.map((need) => (
                    <div key={need.id} className="space-y-1 px-4 py-2.5">
                      <div className="flex items-baseline gap-3">
                        <span className="min-w-0 flex-1 text-sm font-medium">{need.name}</span>
                        <span className="text-muted-foreground tabular text-2xs">
                          {need.confidence.toFixed(2)}
                        </span>
                        <Badge variant="secondary" className="text-2xs">
                          {need.state.replaceAll('_', ' ')}
                        </Badge>
                      </div>
                      {/* The audit trail: why this appeared, in the customer's own terms. */}
                      {need.evidence.length > 0 && (
                        <p className="text-muted-foreground text-2xs">
                          {need.evidence.join(' · ')}
                        </p>
                      )}
                      {need.reason !== null && (
                        <p className="text-muted-foreground text-2xs italic">{need.reason}</p>
                      )}
                    </div>
                  ))}
                </Card>
              )}

              {data.planSteps.length > 0 && (
                <Card className="gap-0 p-4">
                  <p className="text-sm font-medium">The plan</p>
                  <ol className="text-muted-foreground mt-1.5 list-decimal space-y-0.5 pl-4 text-xs">
                    {data.planSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </Card>
              )}

              {data.watches.length > 0 && (
                <Card className="gap-0 divide-y p-0">
                  {data.watches.map((watch) => (
                    <div key={watch.createdAt} className="flex items-baseline gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1 text-xs">
                        The bank is watching for {watch.describe}
                      </span>
                      <Badge variant={watch.met ? 'default' : 'secondary'} className="text-2xs">
                        {watch.met ? 'met' : 'waiting'}
                      </Badge>
                    </div>
                  ))}
                </Card>
              )}
            </section>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Context, with provenance</CardTitle>
            </CardHeader>
            <CardContent className="divide-y px-0 [&>*]:px-6">
              {data.facts.map((fact, index) => (
                <div
                  key={`${fact.key}-${String(index)}`}
                  className="flex items-baseline gap-3 px-4 py-2"
                >
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                    {fact.label}
                  </span>
                  <span className="tabular max-w-[45%] truncate text-right text-xs">
                    {fact.sensitive ? (
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <EyeOffIcon className="size-3" />
                        held
                      </span>
                    ) : (
                      fact.value
                    )}
                  </span>
                  <Badge variant="secondary" className="text-2xs shrink-0">
                    {fact.source.replaceAll('_', ' ')}
                  </Badge>
                  {fact.superseded && (
                    <Badge variant="outline" className="text-2xs shrink-0">
                      superseded
                    </Badge>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Event log</CardTitle>
            </CardHeader>
            <CardContent className="divide-y px-0 [&>*]:px-6">
              {data.events.map((event, index) => (
                <div
                  key={`${event.at}-${String(index)}`}
                  className={`flex items-center gap-3 px-4 py-2${event.signal ? ' bg-primary/[0.03]' : ''}`}
                >
                  {/* Plain words, with the raw type kept on hover for when it is the type you want. */}
                  <span className="min-w-0 flex-1 truncate text-xs" title={event.type}>
                    {event.describe}
                  </span>
                  <Badge variant="secondary" className="text-2xs">
                    {event.actor}
                  </Badge>
                  <span className="text-muted-foreground tabular text-2xs">
                    {new Date(event.at).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
