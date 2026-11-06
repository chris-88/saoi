import type { ReactNode } from 'react'
import { PencilIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  GOAL_CATALOGUE_VERSION,
  type GoalBlueprint,
  type LifeEventCluster,
} from '@domain/goals/types.ts'
import { SIGNAL_STRENGTHS, type NeedDefinition } from '@domain/needs/types.ts'
import { factCatalogue } from '@domain/facts.ts'
import { sentence } from '@/lib/utils'
import type { CatalogueOverrideDto } from '@contracts/admin.ts'

/**
 * The detail half of master/detail (§6).
 *
 * One card per question somebody actually asks about a goal: what is it, what raises it, what
 * does it need to know, how do you know it is progressing, when do you come back to it, what
 * holds it back, and what sits around it. Seven, because that is how many questions there are.
 */
export function GoalDetail({
  goal,
  override,
  onEdit,
}: {
  readonly goal: GoalBlueprint
  readonly override: CatalogueOverrideDto | undefined
  readonly onEdit: () => void
}): ReactNode {
  return (
    <div className="space-y-4">
      <Head
        name={goal.name}
        summary={goal.description}
        onEdit={onEdit}
        badges={[
          { text: goal.category.replaceAll('_', ' ') },
          ...(goal.draws === null
            ? [{ text: 'costs nothing', tone: 'outline' as const }]
            : [{ text: `draws on ${goal.draws.replaceAll('_', ' ')}`, tone: 'outline' as const }]),
        ]}
      />

      <Pane title="Definition" description="Where this came from, and how much of it is wired up.">
        <Rows
          items={[
            { label: 'Identifier', value: goal.id },
            { label: 'Catalogue', value: `version ${GOAL_CATALOGUE_VERSION}` },
            {
              /*
               * The honest status. `linkedNeeds` empty means the engine will recognise the goal
               * and track a plan for it but has no product route to offer — which is a real
               * distinction between twenty-six goals, and the only one the code can answer.
               */
              label: 'Status',
              value:
                goal.linkedNeeds.length > 0
                  ? `routes to ${goal.linkedNeeds.length === 1 ? 'a need' : `${String(goal.linkedNeeds.length)} needs`}`
                  : 'recognised and tracked, no product route',
            },
            ...lifecycle(override),
          ]}
        />
      </Pane>

      <Pane
        title="Raised when"
        description="Conditions over facts, combined so several weak ones add up without any being decisive."
      >
        <div className="space-y-3">
          {goal.signals.map((signal) => (
            <Signal
              key={signal.id}
              describe={signal.describe}
              strength={signal.strength}
              declaration={signal.declaration === true}
            />
          ))}
        </div>
      </Pane>

      <Pane
        title="Needs to know"
        description="In the order worth asking. Anything already known is not asked again."
      >
        <ol className="space-y-1.5">
          {goal.informationNeeded.map((key, index) => (
            <li key={key} className="flex gap-3">
              <span className="text-muted-foreground tabular w-4 shrink-0 text-xs">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                {factCatalogue[key]?.label ?? key}
                <span className="text-muted-foreground block text-2xs">{key}</span>
              </span>
            </li>
          ))}
        </ol>
      </Pane>

      <Pane
        title="Milestones"
        description="How the engine can tell this is moving, with no stored progress anywhere."
      >
        <div className="space-y-3">
          {goal.milestones.map((milestone) => (
            <div key={milestone.id} className="space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 text-sm font-medium">{milestone.label}</span>
                {goal.completion.includes(milestone.id) && (
                  <Badge variant="default" className="text-2xs shrink-0">
                    completes the goal
                  </Badge>
                )}
                <Badge variant="secondary" className="text-2xs shrink-0">
                  {milestone.category}
                </Badge>
              </div>
              <p className="text-muted-foreground text-xs">{detects(milestone.binding)}</p>
            </div>
          ))}
        </div>
      </Pane>

      {goal.checkins.length > 0 && (
        <Pane
          title="Check-ins"
          description="Why Saoirse would come back to this unprompted, and what it would want to cover."
        >
          <div className="space-y-4">
            {goal.checkins.map((checkin, index) => (
              <div key={`${checkin.kind}-${String(index)}`} className="space-y-1.5">
                {index > 0 && <Separator className="mb-4" />}
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 text-sm font-medium">{checkin.purpose}</span>
                  <Badge variant="outline" className="text-2xs shrink-0">
                    {checkin.kind === 'event'
                      ? `on ${checkin.event.replaceAll('_', ' ')}`
                      : `every ${String(checkin.everyMonths)} months`}
                  </Badge>
                </div>
                <ul className="list-disc space-y-0.5 pl-4">
                  {checkin.agenda.map((item) => (
                    <li key={item} className="text-muted-foreground text-xs">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Pane>
      )}

      {(goal.deferrals.length > 0 || goal.suppressions.length > 0) && (
        <Pane
          title="Held back"
          description="Reasons not to raise something true. The engine being certain is not the same as it being the moment."
        >
          <div className="space-y-3">
            {goal.deferrals.map((rule) => (
              <Held
                key={rule.describe}
                describe={rule.describe}
                tone="later"
                note={`back when ${rule.revisitWhen}`}
              />
            ))}
            {goal.suppressions.map((rule) => (
              <Held key={rule.describe} describe={rule.describe} tone="never" note={null} />
            ))}
          </div>
        </Pane>
      )}

      <Pane title="Around it" description="What this sits beside, follows, and cannot share with.">
        <div className="space-y-3">
          <Related label="Needs first" ids={goal.relationships.prerequisites} />
          <Related label="Alongside" ids={goal.relationships.related} />
          <Related label="Afterwards" ids={goal.relationships.followOn} />
          <Related label="Competes with" ids={goal.relationships.conflicts} />
          <Related label="Routes to" ids={goal.linkedNeeds} />
        </div>
      </Pane>
    </div>
  )
}

/** A need is a smaller object, so it gets fewer cards rather than padded ones. */
export function NeedDetail({
  need,
  override,
  onEdit,
}: {
  readonly need: NeedDefinition
  readonly override: CatalogueOverrideDto | undefined
  readonly onEdit: () => void
}): ReactNode {
  return (
    <div className="space-y-4">
      <Head
        name={need.name}
        summary={need.framing}
        onEdit={onEdit}
        badges={[
          { text: `${need.priority.replaceAll('_', ' ')} priority` },
          ...(need.sensitive ? [{ text: 'sensitive', tone: 'destructive' as const }] : []),
        ]}
      />

      <Pane title="Definition" description="How this is identified and what it is allowed to do.">
        <Rows
          items={[
            { label: 'Identifier', value: need.id },
            { label: 'Priority', value: need.priority.replaceAll('_', ' ') },
            {
              label: 'Sensitivity',
              value: need.sensitive
                ? 'sensitive: humour is forced off and no product is offered on that turn'
                : 'standard',
            },
            ...lifecycle(override),
          ]}
        />
      </Pane>

      <Pane
        title="Raised when"
        description="Conditions over facts, scored and combined the same way goals are."
      >
        <div className="space-y-3">
          {need.signals.map((signal) => (
            <Signal
              key={signal.id}
              describe={signal.describe}
              strength={signal.strength}
              declaration={false}
            />
          ))}
        </div>
      </Pane>

      {need.clarifying.length > 0 && (
        <Pane
          title="Asks first"
          description="What Saoirse establishes before offering anything, so the offer fits."
        >
          <ol className="space-y-1.5">
            {need.clarifying.map((item, index) => (
              <li key={item.question} className="flex gap-3">
                <span className="text-muted-foreground tabular w-4 shrink-0 text-xs">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 text-sm">{item.question}</span>
              </li>
            ))}
          </ol>
        </Pane>
      )}

      {need.products.length > 0 && (
        <Pane title="Offers" description="Only from the catalogue. Saoirse invents no product.">
          <div className="flex flex-wrap gap-1.5">
            {need.products.map((product) => (
              <Badge key={product} variant="outline" className="capitalize">
                {product.replaceAll('_', ' ')}
              </Badge>
            ))}
          </div>
        </Pane>
      )}

      {(need.deferrals.length > 0 || need.suppressions.length > 0) && (
        <Pane
          title="Held back"
          description="When the right move is to say nothing, whatever the score says."
        >
          <div className="space-y-3">
            {need.deferrals.map((rule) => (
              <Held key={rule.describe} describe={rule.describe} tone="later" note={null} />
            ))}
            {need.suppressions.map((rule) => (
              <Held key={rule.describe} describe={rule.describe} tone="never" note={null} />
            ))}
          </div>
        </Pane>
      )}
    </div>
  )
}

/** A cluster is the bridge from one sentence to several goals. */
export function ClusterDetail({ cluster }: { readonly cluster: LifeEventCluster }): ReactNode {
  return (
    <div className="space-y-4">
      <Head name={cluster.name} summary={cluster.note} badges={[]} />

      <Pane
        title="Recognised by"
        description="What in the recorded facts says this is the situation. Any one of these is enough to match."
      >
        <ul className="space-y-1.5">
          {cluster.signals.map((signal) => (
            <li key={signal.id} className="text-sm">
              {signal.describe}
            </li>
          ))}
        </ul>
      </Pane>

      <Pane
        title="What it opens"
        description="A cluster is a reason to consider a goal, never a reason to conclude one. Matching it contributes evidence and the engine still decides."
      >
        {/*
          The weights are the engine's, not the cluster's: primary membership is worth
          strong_inferred and the rest soft_inferred, which is why "we just had a baby" does not
          turn into six plans. Showing the group without the weight would lose the whole point.
        */}
        <div className="space-y-4">
          <Opens
            label="Usually about"
            note="strong inferred evidence"
            weight={SIGNAL_STRENGTHS.strong_inferred}
            ids={cluster.primary}
          />
          <Opens
            label="Often alongside"
            note="soft inferred evidence"
            weight={SIGNAL_STRENGTHS.soft_inferred}
            ids={cluster.secondary}
          />
          <Opens
            label="Comes later"
            note="soft inferred, and held back until the rest is settled"
            weight={SIGNAL_STRENGTHS.soft_inferred}
            ids={cluster.deferred}
          />
        </div>
      </Pane>
    </div>
  )
}

/** One group of goals a cluster opens, with what membership is actually worth. */
function Opens({
  label,
  note,
  weight,
  ids,
}: {
  readonly label: string
  readonly note: string
  readonly weight: number
  readonly ids: readonly string[]
}): ReactNode {
  if (ids.length === 0) return null

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-muted-foreground tabular text-2xs">
          {note} · {weight.toFixed(2)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <Badge key={id} variant="outline" className="text-2xs">
            {id.replaceAll('_', ' ')}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function Head({
  name,
  summary,
  badges,
  onEdit,
}: {
  readonly name: string
  readonly summary: string | null
  readonly badges: readonly { readonly text: string; readonly tone?: 'destructive' | 'outline' }[]
  /** Absent for a life-event cluster, which has no prose worth overriding. */
  readonly onEdit?: () => void
}): ReactNode {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 flex-1 text-xl font-semibold tracking-tight">{name}</h2>
        {onEdit !== undefined && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <PencilIcon />
            Reword
          </Button>
        )}
      </div>
      {summary !== null && <p className="text-muted-foreground text-sm">{summary}</p>}
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((badge) => (
            <Badge key={badge.text} variant={badge.tone ?? 'secondary'} className="text-2xs">
              {sentence(badge.text)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function Pane({
  title,
  description,
  children,
}: {
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/**
 * One condition, with how much it is worth.
 *
 * The bar is the argument: a signal is not a keyword match that fires, it is evidence with a
 * weight, and several soft ones reaching the threshold together is the behaviour worth showing.
 */
function Signal({
  describe,
  strength,
  declaration,
}: {
  readonly describe: string
  readonly strength: keyof typeof SIGNAL_STRENGTHS
  readonly declaration: boolean
}): ReactNode {
  const weight = SIGNAL_STRENGTHS[strength]

  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-sm">{describe}</span>
        {declaration && (
          <Badge variant="outline" className="text-2xs shrink-0">
            counts as them saying it
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Progress value={weight * 100} className="h-1 max-w-32" />
        <span className="text-muted-foreground text-2xs capitalize">
          {strength.replaceAll('_', ' ')} · {weight.toFixed(2)}
        </span>
      </div>
    </div>
  )
}

function Held({
  describe,
  tone,
  note,
}: {
  readonly describe: string
  readonly tone: 'later' | 'never'
  readonly note: string | null
}): ReactNode {
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline gap-2">
        <Badge
          variant={tone === 'never' ? 'destructive' : 'secondary'}
          className="text-2xs shrink-0"
        >
          {tone === 'never' ? 'never' : 'not yet'}
        </Badge>
        <span className="min-w-0 flex-1 text-sm">{describe}</span>
      </div>
      {note !== null && <p className="text-muted-foreground pl-1 text-2xs">{note}</p>}
    </div>
  )
}

function Related({
  label,
  ids,
}: {
  readonly label: string
  readonly ids: readonly string[]
}): ReactNode {
  if (ids.length === 0) return null

  return (
    <div className="flex gap-3">
      <span className="text-muted-foreground w-28 shrink-0 text-xs">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {ids.map((id) => (
          <Badge key={id} variant="outline" className="text-2xs">
            {id.replaceAll('_', ' ')}
          </Badge>
        ))}
      </div>
    </div>
  )
}

/**
 * Lifecycle metadata, which only exists once somebody has edited something.
 *
 * The spec asks for created, updated and version. A constant in a TypeScript file has none of
 * those, so the honest answer when nothing has been reworded is to say where the wording comes
 * from rather than to invent a date for it (plan §3.2).
 */
function lifecycle(
  override: CatalogueOverrideDto | undefined,
): readonly { readonly label: string; readonly value: string; readonly muted?: boolean }[] {
  if (override === undefined) {
    return [{ label: 'Wording', value: 'as compiled into the build, never reworded', muted: true }]
  }

  return [
    {
      label: 'Wording',
      value: `reworded ${override.version === 1 ? 'once' : `${String(override.version)} times`}`,
    },
    { label: 'First edited', value: override.createdAt.slice(0, 10) },
    { label: 'Last edited', value: override.updatedAt.slice(0, 10) },
  ]
}

/** How the engine knows a milestone happened, said in English. */
function detects(binding: GoalBlueprint['milestones'][number]['binding']): string {
  if (binding === null) return 'The customer confirms it. Nothing else can.'

  switch (binding.kind) {
    case 'facts':
      return `Automatic, once we know ${binding.keys.join(' and ')}.`
    case 'numeric':
      return `Automatic, at ${String(Math.round(binding.fraction * 100))}% of the agreed target.`
    case 'application':
      return `Automatic, when the ${binding.product.replaceAll('_', ' ')} application reaches ${binding.state.replaceAll('_', ' ')}.`
    case 'date':
      return 'Automatic, on the target date.'
  }
}

function Rows({
  items,
}: {
  readonly items: readonly {
    readonly label: string
    readonly value: string
    readonly muted?: boolean
  }[]
}): ReactNode {
  return (
    <dl className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="flex gap-3">
          <dt className="text-muted-foreground w-28 shrink-0 text-xs">{item.label}</dt>
          <dd
            className={
              item.muted
                ? 'text-muted-foreground min-w-0 flex-1 text-xs italic'
                : 'min-w-0 flex-1 text-sm'
            }
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
