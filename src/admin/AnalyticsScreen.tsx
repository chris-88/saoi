import { useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts'
import { StarIcon, ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { MetricCard, PageHeader } from '@/admin/parts'
import { sentence } from '@/lib/utils'
import { adminApi } from '@/admin/adminClient'
import { queryKeys } from '@/lib/queryKeys'
import { insightsFor } from '@domain/insights.ts'
import type { Analytics, Period } from '@contracts/admin.ts'

/** Which event type stands for each headline, so the sparkline and the number agree. */
const SPARKS = {
  conversations: 'message:customer',
  applications: 'application_created',
  goals: 'goal_identified',
  blocked: 'request_blocked',
} as const

/**
 * What the console has actually seen (§9).
 *
 * Seven panels, not the spec's nine, plus the four about arrivals added after the show and
 * tell (§44). Channel mix and new-versus-returning are not here because there is no channel
 * field and no identity across sessions, and §9 is explicit that a dashboard should not be
 * populated with numbers that have nothing behind them. Two empty panels would say less about
 * the product than their absence does.
 */
export function AnalyticsScreen({ period }: { readonly period: Period }): ReactNode {
  const analytics = useQuery({
    queryKey: queryKeys.admin.analytics(period),
    queryFn: () => adminApi.analytics(period),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Counted from events. Every number here is something that happened, not something modelled."
      />

      {analytics.isError && (
        <Alert variant="destructive">
          <AlertDescription>{analytics.error.message}</AlertDescription>
        </Alert>
      )}

      {analytics.isPending && <Loading />}

      {analytics.data !== undefined && <Panels data={analytics.data} />}
    </div>
  )
}

function Panels({ data }: { readonly data: Analytics }): ReactNode {
  const byType = useMemo(() => {
    const map = new Map<string, { day: string; count: number }[]>()
    for (const row of data.series) {
      map.set(row.type, [...(map.get(row.type) ?? []), { day: row.day, count: row.count }])
    }
    return map
  }, [data.series])

  /* Both sides, because "how busy was it" and "how much did Saoirse say back" are different
     questions and the gap between the two lines is the more interesting one. */
  const volume = useMemo(() => {
    const asked = byType.get('message:customer') ?? []
    const replied = new Map((byType.get('message:assistant') ?? []).map((r) => [r.day, r.count]))
    return asked.map((row) => ({
      day: row.day,
      asked: row.count,
      replied: replied.get(row.day) ?? 0,
    }))
  }, [byType])
  const nothing = data.totals.conversations === 0

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:gap-4 xl:grid-cols-4">
        <MetricCard
          label="Conversations"
          value={data.totals.conversations}
          previous={data.previous?.conversations}
          note="Cases somebody spoke in, counted once each."
          chart={<Spark points={byType.get(SPARKS.conversations) ?? []} />}
        />
        <MetricCard
          label="Applications"
          value={data.totals.applications}
          previous={data.previous?.applications}
          note="Started in this window."
          chart={<Spark points={byType.get(SPARKS.applications) ?? []} />}
        />
        <MetricCard
          label="Goals discovered"
          value={data.totals.goals}
          previous={data.previous?.goals}
          note="Counted once per goal per conversation."
          chart={<Spark points={byType.get(SPARKS.goals) ?? []} />}
        />
        <MetricCard
          label="Turned away"
          value={data.totals.blocked}
          previous={data.previous?.blocked}
          note="Stopped at the gate, before any model saw it."
          chart={<Spark points={byType.get(SPARKS.blocked) ?? []} />}
        />
      </div>

      <Insights data={data} />

      <Arrivals data={data} />

      {nothing ? (
        <Empty className="border border-dashed py-16">
          <EmptyHeader>
            <EmptyTitle>Nothing in this window</EmptyTitle>
            <EmptyDescription>
              Counted from {data.from.slice(0, 10)} to {data.to.slice(0, 10)}. Widen the period, or
              have a conversation.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Panel
            title="Conversation volume"
            description={`Messages a day, ${data.from.slice(0, 10)} to ${data.to.slice(0, 10)}. The gap between the lines is how much Saoirse says back.`}
          >
            <Volume points={volume} />
          </Panel>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Panel
              title="Application funnel"
              description="Where applications stand now. Each stage counts everything that reached it or went past it."
            >
              <Funnel stages={data.funnel} />
            </Panel>

            <Panel
              title="What conversations came to"
              description="How far each one got, from everything that happened to it."
            >
              <Outcomes outcomes={data.outcomes} />
            </Panel>

            <Panel
              title="Goals discovered"
              description="What Saoirse worked out people were after, most often first."
            >
              <TopGoals goals={data.topGoals} />
            </Panel>

            <Panel
              title="What was turned away"
              description="Which rule stopped it. Nothing here reached a model."
            >
              <Guardrails categories={data.guardrails} />
            </Panel>
          </div>
        </>
      )}
    </>
  )
}

/**
 * What the numbers add up to, as rules rather than judgement.
 *
 * Computed in the domain and tested, for the same reason the advisories are: this console's
 * headline claim is that the engine is deterministic, and it cannot have one corner of itself
 * guessing. Every line here restates something visible in the panels below it.
 */
function Insights({ data }: { readonly data: Analytics }): ReactNode {
  const insights = useMemo(
    () =>
      insightsFor({
        conversations: data.totals.conversations,
        goals: data.totals.goals,
        applications: data.totals.applications,
        blocked: data.totals.blocked,
        outcomes: data.outcomes,
        topGoals: data.topGoals,
        funnel: data.funnel,
      }),
    [data],
  )

  if (insights.length === 0) return null

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {insights.map((insight) => (
        <Card key={insight.id} className="gap-0 py-3">
          <CardContent className="flex gap-2.5 px-4">
            <span
              aria-hidden
              className={
                insight.tone === 'watch'
                  ? 'bg-warning mt-1.5 size-2 shrink-0 rounded-full'
                  : insight.tone === 'good'
                    ? 'bg-success mt-1.5 size-2 shrink-0 rounded-full'
                    : 'bg-muted-foreground/40 mt-1.5 size-2 shrink-0 rounded-full'
              }
            />
            <p className="min-w-0 flex-1 text-sm">{insight.text}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/**
 * What happened after the show and tell (§44).
 *
 * Four panels about arrivals rather than applications: how far people got, where they came
 * from, where the conversation stopped, and what they said. Counted from cases rather than
 * from messages, so the first step includes the people who opened Saoirse and typed nothing,
 * which is exactly the drop worth seeing. Shown even when nobody spoke, for that reason.
 */
function Arrivals({ data }: { readonly data: Analytics }): ReactNode {
  const arrived = data.journey.reduce((most, step) => Math.max(most, step.count), 0)
  const anyFeedback = data.feedback.thumbsUp + data.feedback.thumbsDown + data.feedback.ratings > 0

  if (arrived === 0 && data.sources.length === 0 && !anyFeedback) return null

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Panel
        title="Where arrivals got to"
        description="Each step counts the cases that reached it. The grey figure is the drop from the step before."
      >
        <Journey steps={data.journey} />
      </Panel>

      <div className="grid gap-4">
        <Panel
          title="Where they came from"
          description="The source on the address they arrived by. Unknown is a plain link, or a code printed before there was one."
        >
          <Sources sources={data.sources} />
        </Panel>

        <FeedbackTile feedback={data.feedback} />
      </div>

      <Panel
        title="Where it stalled"
        description="The point a conversation stopped moving, by what the detectors saw."
      >
        <Stalls stalls={data.stalls} />
      </Panel>
    </div>
  )
}

/** The same bars as the application funnel, with the drop said as a count as well as a share. */
function Journey({ steps }: { readonly steps: Analytics['journey'] }): ReactNode {
  const widest = Math.max(...steps.map((step) => step.count), 1)

  if (steps.length === 0 || steps.every((step) => step.count === 0)) {
    return <Nothing>Nobody has arrived in this window.</Nothing>
  }

  return (
    <div className="space-y-3">
      {steps.map((step, index) => {
        const previous = steps[index - 1]
        const dropped =
          previous === undefined || previous.count === 0 ? null : previous.count - step.count

        return (
          <div key={step.step} className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 text-sm">{step.label}</span>
              {dropped !== null && dropped > 0 && previous !== undefined && (
                <span className="text-muted-foreground tabular text-2xs">
                  −{dropped} ({Math.round((dropped / previous.count) * 100)}%)
                </span>
              )}
              <span className="tabular text-sm font-medium">{step.count}</span>
            </div>
            <Progress value={(step.count / widest) * 100} className="h-2" />
          </div>
        )
      })}
    </div>
  )
}

function Sources({ sources }: { readonly sources: Analytics['sources'] }): ReactNode {
  if (sources.length === 0) return <Nothing>No arrivals in this window.</Nothing>

  const most = Math.max(...sources.map((entry) => entry.count), 1)
  const total = sources.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <div className="space-y-3">
      {sources.map((entry) => (
        <div key={entry.source} className="space-y-1">
          <div className="flex items-baseline gap-2">
            <Badge variant="secondary" className="text-2xs shrink-0">
              {entry.source}
            </Badge>
            <span className="flex-1" />
            <span className="text-muted-foreground tabular text-2xs">
              {Math.round((entry.count / total) * 100)}%
            </span>
            <span className="tabular text-sm font-medium">{entry.count}</span>
          </div>
          <Progress value={(entry.count / most) * 100} className="h-2" />
        </div>
      ))}
    </div>
  )
}

function Stalls({ stalls }: { readonly stalls: Analytics['stalls'] }): ReactNode {
  if (stalls.length === 0 || stalls.every((entry) => entry.count === 0)) {
    return <Nothing>Nothing stalled in this window, or nothing was detected.</Nothing>
  }

  const most = Math.max(...stalls.map((entry) => entry.count), 1)

  return (
    <div className="space-y-3">
      {stalls.map((entry) => (
        <div key={entry.type} className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 text-sm">{entry.label}</span>
            <span className="tabular text-sm font-medium">{entry.count}</span>
          </div>
          <Progress value={(entry.count / most) * 100} className="h-2" />
        </div>
      ))}
    </div>
  )
}

/**
 * Three figures in one card rather than three cards.
 *
 * Thumbs up and down are one pair, and a rating is a different question asked in a different
 * place, so they sit together under one heading and the metric row above stays four wide.
 */
function FeedbackTile({ feedback }: { readonly feedback: Analytics['feedback'] }): ReactNode {
  const total = feedback.thumbsUp + feedback.thumbsDown

  return (
    <Card className="gap-1 py-4 lg:gap-2 lg:py-6">
      <CardHeader className="px-4 lg:px-6">
        <CardDescription className="text-xs lg:text-sm">Feedback</CardDescription>
        <CardTitle className="tabular flex flex-wrap items-baseline gap-x-4 gap-y-1 text-2xl lg:text-3xl">
          <span className="inline-flex items-baseline gap-1.5">
            <ThumbsUpIcon className="text-success size-4 self-center" aria-hidden />
            {feedback.thumbsUp}
          </span>
          <span className="inline-flex items-baseline gap-1.5">
            <ThumbsDownIcon className="text-destructive size-4 self-center" aria-hidden />
            {feedback.thumbsDown}
          </span>
          <span className="inline-flex items-baseline gap-1.5">
            <StarIcon className="fill-primary text-primary size-4 self-center" aria-hidden />
            {feedback.averageRating === null ? '–' : feedback.averageRating.toFixed(1)}
            <span className="text-muted-foreground text-sm font-normal">
              of {String(feedback.ratings)}
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 lg:px-6">
        <p className="text-muted-foreground text-xs">
          {total === 0 && feedback.ratings === 0
            ? 'Nobody has rated a reply or the conversation yet.'
            : `${String(total)} ${total === 1 ? 'thumb' : 'thumbs'} on replies; the average is of ${String(feedback.ratings)} ${feedback.ratings === 1 ? 'rating' : 'ratings'} out of five from the menu.`}
        </p>
      </CardContent>
    </Card>
  )
}

function Panel({
  title,
  description,
  children,
}: {
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

const sparkConfig = { count: { label: 'Count', color: 'var(--chart-1)' } } satisfies ChartConfig

/**
 * The shape of the number above it, with no axes.
 *
 * A sparkline that cannot be read off is doing its job: the figure is the fact, and this says
 * whether it arrived steadily or all at once.
 */
function Spark({
  points,
}: {
  readonly points: readonly { day: string; count: number }[]
}): ReactNode {
  if (points.length < 2) return null

  return (
    <ChartContainer config={sparkConfig} className="h-10 w-full">
      <AreaChart data={[...points]} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <Area
          dataKey="count"
          type="linear"
          stroke="var(--color-count)"
          fill="var(--color-count)"
          fillOpacity={0.15}
          strokeWidth={1.5}
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

const volumeConfig = {
  asked: { label: 'Asked', color: 'var(--chart-1)' },
  replied: { label: 'Saoirse replied', color: 'var(--chart-2)' },
} satisfies ChartConfig

function Volume({
  points,
}: {
  readonly points: readonly { day: string; asked: number; replied: number }[]
}): ReactNode {
  /*
   * One point is not a line. Over `all time` on a database that was reset today the window is a
   * single day, and an area chart of one value draws a correct, empty rectangle — which reads as
   * a broken chart rather than as a short history.
   */
  if (points.length < 2) {
    return (
      <Nothing>
        {points.length === 0
          ? 'Nothing was said in this window.'
          : 'A single day so far. A line needs two.'}
      </Nothing>
    )
  }

  return (
    <ChartContainer config={volumeConfig} className="h-56 w-full">
      <AreaChart data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(value: string) => value.slice(5)}
        />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          dataKey="asked"
          type="linear"
          stroke="var(--color-asked)"
          fill="var(--color-asked)"
          fillOpacity={0.15}
          strokeWidth={2}
          isAnimationActive={false}
        />
        <Area
          dataKey="replied"
          type="linear"
          stroke="var(--color-replied)"
          fill="var(--color-replied)"
          fillOpacity={0.1}
          strokeWidth={2}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

/**
 * The funnel as bars rather than a tapering shape.
 *
 * A drawn funnel implies each stage is a subset of the one before, which is true here, and
 * implies the widths are to scale, which in a prototype with single-digit counts they would not
 * usefully be. Bars against the widest stage say the same thing and can be read.
 */
function Funnel({ stages }: { readonly stages: Analytics['funnel'] }): ReactNode {
  const widest = Math.max(...stages.map((stage) => stage.count), 1)

  if (stages.every((stage) => stage.count === 0)) {
    return <Nothing>No application has been started in this window.</Nothing>
  }

  return (
    <div className="space-y-3">
      {stages.map((stage, index) => {
        const previous = stages[index - 1]
        const dropped =
          previous === undefined || previous.count === 0
            ? null
            : Math.round(((previous.count - stage.count) / previous.count) * 100)

        return (
          <div key={stage.stage} className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 text-sm">{stage.label}</span>
              {dropped !== null && dropped > 0 && (
                <span className="text-muted-foreground tabular text-2xs">−{dropped}%</span>
              )}
              <span className="tabular text-sm font-medium">{stage.count}</span>
            </div>
            <Progress value={(stage.count / widest) * 100} className="h-2" />
          </div>
        )
      })}
    </div>
  )
}

const OUTCOME_COLOURS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const

/** Wraps, and is total — there are five outcomes and five colours, but neither is load-bearing. */
function colourFor(index: number): string {
  return OUTCOME_COLOURS[index % OUTCOME_COLOURS.length] ?? OUTCOME_COLOURS[0]
}

function Outcomes({ outcomes }: { readonly outcomes: Analytics['outcomes'] }): ReactNode {
  const config = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        outcomes.map((entry, index) => [
          entry.outcome,
          { label: entry.label, color: colourFor(index) },
        ]),
      ),
    [outcomes],
  )

  if (outcomes.length === 0) return <Nothing>No conversation has finished anything yet.</Nothing>

  const total = outcomes.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <div className="space-y-4">
      <ChartContainer config={config} className="mx-auto h-44 w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="outcome" hideLabel />} />
          <Pie
            data={[...outcomes]}
            dataKey="count"
            nameKey="outcome"
            innerRadius={44}
            strokeWidth={2}
          >
            {outcomes.map((entry, index) => (
              <Cell key={entry.outcome} fill={colourFor(index)} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>

      {/* The legend carries the definition. A slice called "explored" that nobody can define is
          a number people argue about rather than act on. */}
      <div className="space-y-2">
        {outcomes.map((entry, index) => (
          <div key={entry.outcome} className="flex gap-2.5">
            <span
              aria-hidden
              className="mt-1.5 size-2 shrink-0 rounded-[2px]"
              style={{ background: colourFor(index) }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 text-sm">{entry.label}</span>
                <span className="text-muted-foreground tabular text-2xs">
                  {Math.round((entry.count / total) * 100)}%
                </span>
                <span className="tabular text-sm font-medium">{entry.count}</span>
              </div>
              <p className="text-muted-foreground text-2xs">{entry.note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const goalConfig = {
  count: { label: 'Conversations', color: 'var(--chart-2)' },
} satisfies ChartConfig

function TopGoals({ goals }: { readonly goals: Analytics['topGoals'] }): ReactNode {
  if (goals.length === 0) {
    return <Nothing>Saoirse has not established what anybody is after in this window.</Nothing>
  }

  return (
    <ChartContainer
      config={goalConfig}
      className="w-full"
      style={{ height: goals.length * 34 + 16 }}
    >
      <BarChart data={[...goals]} layout="vertical" margin={{ left: 0, right: 16 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          dataKey="name"
          type="category"
          tickLine={false}
          axisLine={false}
          width={150}
          tick={{ fontSize: 12 }}
        />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

function Guardrails({ categories }: { readonly categories: Analytics['guardrails'] }): ReactNode {
  if (categories.length === 0) {
    return <Nothing>Nothing has been turned away in this window.</Nothing>
  }

  const most = Math.max(...categories.map((entry) => entry.count), 1)

  return (
    <div className="space-y-3">
      {categories.map((entry) => (
        <div key={entry.category} className="space-y-1">
          <div className="flex items-baseline gap-2">
            <Badge variant="secondary" className="text-2xs shrink-0">
              {sentence(entry.category.replaceAll('_', ' '))}
            </Badge>
            <span className="flex-1" />
            <span className="tabular text-sm font-medium">{entry.count}</span>
          </div>
          <Progress value={(entry.count / most) * 100} className="h-2" />
        </div>
      ))}
    </div>
  )
}

function Nothing({ children }: { readonly children: ReactNode }): ReactNode {
  return <p className="text-muted-foreground py-6 text-center text-sm">{children}</p>
}

function Loading(): ReactNode {
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-36" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </>
  )
}
