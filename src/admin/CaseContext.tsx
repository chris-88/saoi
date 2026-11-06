import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { StatusDot } from '@/components/StatusDot'
import { KeyValueList } from '@/admin/parts'
import { euro, tokens } from '@/lib/utils'
import type { ApplicationState } from '@domain/state-machine.ts'
import type { AdminCase } from '@contracts/admin.ts'

/**
 * Who this is and what the engines made of them (§5, the customer/context pane).
 *
 * Separated from the conversation because they answer different questions. The middle pane is
 * "what happened"; this is "what is true". Somebody reading a transcript to decide what to do
 * next needs both at once, which is the whole argument for three panes rather than tabs on one.
 */
export function CaseContext({ data }: { readonly data: AdminCase }): ReactNode {
  return (
    <Tabs defaultValue="customer" className="flex h-full min-h-0 flex-col gap-0">
      <div className="border-b p-3">
        <TabsList className="w-full">
          <TabsTrigger value="customer" className="text-xs">
            Customer
          </TabsTrigger>
          <TabsTrigger value="goals" className="text-xs">
            Goals
          </TabsTrigger>
          <TabsTrigger value="applications" className="text-xs">
            Applications
          </TabsTrigger>
        </TabsList>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <TabsContent value="customer" className="space-y-4">
          <Customer data={data} />
        </TabsContent>

        <TabsContent value="goals" className="space-y-4">
          <Goals goals={data.goals} needs={data.needs} />
        </TabsContent>

        <TabsContent value="applications" className="space-y-4">
          <Applications applications={data.applications} plans={data.plans} />
        </TabsContent>
      </div>
    </Tabs>
  )
}

/** Identity, and the facts behind it with where each came from. */
function Customer({ data }: { readonly data: AdminCase }): ReactNode {
  const { customer } = data

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{customer.name ?? 'Not yet named'}</CardTitle>
          <CardDescription>
            {customer.authLevel === 'authenticated' ? 'Signed in' : 'Not signed in'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KeyValueList
            items={[
              { key: 'First said something', value: when(customer.firstSeen) },
              { key: 'Last said something', value: when(customer.lastSeen) },
              {
                // The honest answer to "returning customer" with no sign-in to track.
                key: 'Days active',
                value:
                  customer.daysActive === 0
                    ? 'not yet'
                    : `${String(customer.daysActive)}${customer.daysActive > 1 ? ', came back' : ''}`,
              },
              { key: 'Messages sent', value: customer.messages },
              /*
               * The number the whole argument rests on.
               *
               * Four applications is only a claim until there is a time beside it, and the
               * honest time is active rather than wall-clock: somebody who starts in the
               * morning and finishes after lunch spent minutes in the conversation, not hours.
               * When they did leave and come back, that is said rather than hidden, because a
               * figure smaller than the clock needs to explain itself.
               */
              {
                key: 'Time in conversation',
                value:
                  customer.timing.activeMinutes === 0
                    ? 'not yet'
                    : `${minutes(customer.timing.activeMinutes)}${
                        customer.timing.sittings > 1
                          ? ` · ${String(customer.timing.sittings)} sittings`
                          : ''
                      }`,
              },
              ...(data.applications.length > 0
                ? [
                    {
                      key: 'Applications started',
                      value: `${String(data.applications.length)} — from the one conversation`,
                    },
                  ]
                : []),
              /*
               * Uploads are not messages, so without this line a conversation where somebody
               * photographed three payslips reads as a quiet one.
               */
              ...(data.documents.length > 0
                ? [
                    {
                      key: 'Documents sent',
                      value: `${String(data.documents.length)} — ${[
                        ...new Set(data.documents.map((document) => document.type)),
                      ].join(', ')}`,
                    },
                  ]
                : []),
              {
                /*
                 * The tokens are measured — every response reports what it used. The euro is
                 * those multiplied by prices held in `domain/cost.ts`, which is the estimated
                 * part and the reason this says "about".
                 */
                key: 'Tokens used',
                value: tokens(data.cost.tokens),
              },
              {
                key: 'Cost to run',
                value: `about ${euro(data.cost.euro)}`,
              },
              /*
               * Shown even at zero — especially at zero.
               *
               * These are Web Push, sent from an Edge Function to the browser's own push
               * service, so there is no per-message charge and no sender to register. An SMS
               * would be billed every time. A cost line that only appeared when there was
               * something to charge for would never make that point.
               */
              ...(data.notifications.sent > 0
                ? [
                    {
                      key: 'Notifications',
                      value: `${String(data.notifications.sent)} sent, ${String(data.notifications.delivered)} delivered — ${euro(data.notifications.euro)}`,
                    },
                  ]
                : []),
              ...(data.cost.measuredTurns < data.cost.turns
                ? [
                    {
                      key: 'Counted',
                      value: `${String(data.cost.measuredTurns)} of ${String(data.cost.turns)} turns — the rest averaged`,
                    },
                  ]
                : []),
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What Saoirse knows</CardTitle>
          <CardDescription>
            {data.facts.length === 0
              ? 'Nothing recorded yet.'
              : `${String(data.facts.length)} facts, each with where it came from.`}
          </CardDescription>
        </CardHeader>
        {data.facts.length > 0 && (
          <CardContent className="space-y-2">
            {data.facts.map((fact) => (
              <div key={`${fact.key}-${fact.value}`} className="space-y-0.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground text-xs">{fact.label}</span>
                  <span className="min-w-0 text-right text-sm">{fact.value}</span>
                </div>
                <Badge variant="outline" className="text-2xs">
                  {fact.source.replaceAll('_', ' ')}
                </Badge>
              </div>
            ))}
          </CardContent>
        )}
      </Card>
    </>
  )
}

/** What the engines concluded, with how sure they are. */
function Goals({
  goals,
  needs,
}: {
  readonly goals: AdminCase['goals']
  readonly needs: AdminCase['needs']
}): ReactNode {
  const raised = goals.filter((goal) => goal.tier !== 'latent')
  const established = needs.filter((need) => need.confidence > 0 || need.state !== 'latent')

  if (raised.length === 0 && established.length === 0) {
    return (
      <Empty className="border border-dashed py-10">
        <EmptyHeader>
          <EmptyTitle>Nothing established</EmptyTitle>
          <EmptyDescription>Saoirse has not worked out what they are after yet.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <>
      {raised.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Goals</CardTitle>
            <CardDescription>Where they are trying to get to.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {raised.map((goal) => (
              <Scored
                key={goal.id}
                name={goal.name}
                state={goal.tier.replaceAll('_', ' ')}
                confidence={goal.confidence}
                because={goal.evidence[0]}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {established.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Needs</CardTitle>
            <CardDescription>What is required along the way.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {established.map((need) => (
              <Scored
                key={need.id}
                name={need.name}
                state={need.state.replaceAll('_', ' ')}
                confidence={need.confidence}
                because={need.evidence[0]}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </>
  )
}

/**
 * One conclusion, with the evidence bar beside it.
 *
 * The bar is there because a number between nought and one means nothing at a glance, and this
 * pane is read at a glance.
 */
function Scored({
  name,
  state,
  confidence,
  because,
}: {
  readonly name: string
  readonly state: string
  readonly confidence: number
  readonly because: string | undefined
}): ReactNode {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium">{name}</span>
        <Badge variant="secondary" className="text-2xs shrink-0">
          {state}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <Progress value={confidence * 100} className="h-1" />
        <span className="text-muted-foreground tabular shrink-0 text-2xs">
          {confidence.toFixed(2)}
        </span>
      </div>
      {because !== undefined && <p className="text-muted-foreground text-2xs">{because}</p>}
    </div>
  )
}

/** What is actually in flight, and what it is waiting on. */
function Applications({
  applications,
  plans,
}: {
  readonly applications: AdminCase['applications']
  readonly plans: AdminCase['plans']
}): ReactNode {
  if (applications.length === 0 && plans.length === 0) {
    return (
      <Empty className="border border-dashed py-10">
        <EmptyHeader>
          <EmptyTitle>Nothing started</EmptyTitle>
          <EmptyDescription>No applications and no plan on this case.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <>
      {applications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Applications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {applications.map((application) => (
              <div key={application.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <StatusDot state={application.state as ApplicationState} />
                  <span className="min-w-0 flex-1 text-sm font-medium">
                    {application.displayName}
                  </span>
                  <Badge variant="secondary" className="text-2xs shrink-0">
                    {application.stateLabel}
                  </Badge>
                </div>
                {application.outstanding.length > 0 && (
                  <p className="text-muted-foreground pl-5 text-2xs">
                    Waiting on {application.outstanding.slice(0, 3).join(', ')}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {plans.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plans</CardTitle>
            <CardDescription>Goals that outlive any one application.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {plans.map((plan) => (
              <div key={plan.id} className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 text-sm font-medium">{plan.title}</span>
                  <Badge variant="secondary" className="text-2xs shrink-0">
                    {plan.status}
                  </Badge>
                </div>
                {plan.targetAmount !== null && plan.currentAmount !== null && (
                  <>
                    <Progress
                      value={Math.min(100, (plan.currentAmount / plan.targetAmount) * 100)}
                      className="h-1"
                    />
                    <p className="text-muted-foreground tabular text-2xs">
                      €{plan.currentAmount.toLocaleString('en-IE')} of €
                      {plan.targetAmount.toLocaleString('en-IE')}
                      {plan.monthsRemaining !== null &&
                        ` · about ${String(plan.monthsRemaining)} months to go`}
                    </p>
                  </>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  )
}

/** Minutes as somebody would say them. */
function minutes(value: number): string {
  if (value < 60) return `${String(value)} min`
  const hours = Math.floor(value / 60)
  const rest = value % 60
  return rest === 0 ? `${String(hours)} hr` : `${String(hours)} hr ${String(rest)} min`
}

function when(value: string | null): string {
  if (value === null) return 'not yet'
  return `${value.slice(0, 10)} ${value.slice(11, 16)}`
}
