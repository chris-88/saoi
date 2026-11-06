import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PencilIcon } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { goalCatalogue } from '@domain/goals/catalogue.ts'
import { lifeEventClusters } from '@domain/goals/clusters.ts'
import { GOAL_THRESHOLDS } from '@domain/goals/types.ts'
import { needCatalogue } from '@domain/needs/catalogue.ts'
import { NEED_PRIORITIES, NEED_THRESHOLDS } from '@domain/needs/types.ts'
import { PageHeader } from '@/admin/parts'
import { CatalogueList, type CatalogueEntry } from '@/admin/CatalogueList'
import { ClusterDetail, GoalDetail, NeedDetail } from '@/admin/CatalogueDetail'
import { CatalogueEditor, type Editing } from '@/admin/CatalogueEditor'
import { Button } from '@/components/ui/button'
import { effectiveGoals, effectiveNeeds, overridesAnything } from '@domain/catalogue/overlay.ts'
import { adminApi } from '@/admin/adminClient'
import { queryKeys } from '@/lib/queryKeys'
import { useRealtimeInvalidation } from '@/lib/useRealtimeInvalidation'
import type { CatalogueOverrideDto } from '@contracts/admin.ts'

/**
 * What Saoirse knows how to recognise, and what it does about it (§6).
 *
 * The catalogue is the answer to the question this prototype always gets asked — whether the
 * model is deciding any of this. Twenty-six goals, ten needs and ten life events, each with the
 * conditions that raise it, the information it needs before it can be acted on, and the rules
 * that hold it back. None of it is prompt text.
 */
export function EngineScreen(): ReactNode {
  /*
   * The overlay is loaded here and shared, so the list, the detail and the editor can never
   * disagree about what is in force. Realtime keeps it current: a second operator switching a
   * goal off should not leave this screen claiming it is on.
   */
  const overrides = useQuery({
    queryKey: queryKeys.admin.catalogue(),
    queryFn: adminApi.catalogueOverrides,
  })

  /*
   * No `?? []` here. An empty overlay and a failed load look identical to every component
   * downstream, and the difference is a screen that says a switched-off goal is in use. So the
   * failure is shown instead of being flattened into "nothing is overridden".
   */
  const rows = overrides.data?.overrides
  const [editing, setEditing] = useState<Editing | null>(null)

  const refresh = useCallback(() => {
    void overrides.refetch()
  }, [overrides])

  useRealtimeInvalidation(['catalogue_overrides'], refresh)

  const byId = useMemo(
    () => new Map((rows ?? []).map((row) => [`${row.kind}:${row.entryId}`, row])),
    [rows],
  )

  const edited = (rows ?? []).filter(overridesAnything).length

  /*
   * Two layouts, decided by how wide the content column is rather than the window — this screen
   * sits beside a sidebar that collapses. Wide: a fixed-height frame where the list scrolls on
   * its own. Narrow: everything stacks at natural height and the page scrolls, because a
   * squashed list over a squashed detail is worse than scrolling.
   */
  return (
    <div className="@container @3xl:h-full @3xl:min-h-0 flex flex-col gap-4">
      <PageHeader
        title="Goals and needs"
        description="The catalogue the engines read. Conditions over facts, scored and combined, not phrases the model matches on."
        actions={
          edited > 0 ? (
            <span className="text-muted-foreground text-xs">
              {edited === 1 ? '1 entry reworded' : `${String(edited)} entries reworded`}
            </span>
          ) : undefined
        }
      />

      <Thresholds />

      {overrides.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            The overlay could not be read, so this is the catalogue as compiled rather than as it is
            in force. {overrides.error.message}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="goals" className="@3xl:min-h-0 @3xl:flex-1 flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="goals">Goals ({goalCatalogue.length})</TabsTrigger>
          <TabsTrigger value="needs">Needs ({needCatalogue.length})</TabsTrigger>
          <TabsTrigger value="events">Life events ({lifeEventClusters.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="goals" className="@3xl:min-h-0 @3xl:flex-1">
          <Goals overrides={rows ?? []} byId={byId} onEdit={setEditing} />
        </TabsContent>

        <TabsContent value="needs" className="@3xl:min-h-0 @3xl:flex-1">
          <Needs overrides={rows ?? []} byId={byId} onEdit={setEditing} />
        </TabsContent>

        <TabsContent value="events" className="@3xl:min-h-0 @3xl:flex-1">
          <Clusters />
        </TabsContent>
      </Tabs>

      <CatalogueEditor
        editing={editing}
        override={editing === null ? undefined : byId.get(`${editing.kind}:${editing.entry.id}`)}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}

type Shared = {
  readonly overrides: readonly CatalogueOverrideDto[]
  readonly byId: ReadonlyMap<string, CatalogueOverrideDto>
  readonly onEdit: (editing: Editing) => void
}

/** The two-pane frame. The container is the screen root, so these rules measure the column. */
function Split({
  list,
  detail,
}: {
  readonly list: ReactNode
  readonly detail: ReactNode
}): ReactNode {
  return (
    <div className="@3xl:grid-cols-[22rem_1fr] @3xl:h-full @3xl:min-h-0 grid gap-4">
      {/* Capped rather than full height when stacked, so the list cannot push detail off-screen. */}
      <Card className="@3xl:max-h-none @3xl:min-h-0 max-h-[26rem] overflow-hidden py-0">
        {list}
      </Card>
      <div className="@3xl:overflow-y-auto @3xl:min-h-0">{detail}</div>
    </div>
  )
}

function Goals({ overrides, byId, onEdit }: Shared): ReactNode {
  // What is actually in force, not what is compiled in — a switched-off goal is not in this list
  // because it is not in the catalogue the engines are handed either.
  const catalogue = useMemo(() => effectiveGoals(goalCatalogue, overrides), [overrides])

  const entries = useMemo<readonly CatalogueEntry[]>(
    () =>
      catalogue.map((goal) => ({
        id: goal.id,
        name: goal.name,
        summary: goal.description,
        group: goal.category,
        rank: null,
        rankOrder: 0,
        sensitive: false,
        searchable: goal.signals.map((signal) => signal.describe).join(' '),
      })),
    [catalogue],
  )

  const [selected, setSelected] = useState<string | undefined>(goalCatalogue[0]?.id)
  const goal = catalogue.find((item) => item.id === selected)

  return (
    <Split
      list={
        <CatalogueList
          entries={entries}
          selected={selected}
          onSelect={setSelected}
          groupLabel="category"
          sortable={false}
          off={offFor(overrides, 'goal', goalCatalogue)}
          onSelectOff={setSelected}
        />
      }
      detail={
        goal === undefined ? (
          <Switched
            id={selected}
            onEdit={() => {
              const compiled = goalCatalogue.find((item) => item.id === selected)
              if (compiled !== undefined) onEdit({ kind: 'goal', entry: compiled })
            }}
          />
        ) : (
          <GoalDetail
            goal={goal}
            override={byId.get(`goal:${goal.id}`)}
            onEdit={() => onEdit({ kind: 'goal', entry: goal })}
          />
        )
      }
    />
  )
}

function Needs({ overrides, byId, onEdit }: Shared): ReactNode {
  const catalogue = useMemo(() => effectiveNeeds(needCatalogue, overrides), [overrides])

  const entries = useMemo<readonly CatalogueEntry[]>(
    () =>
      catalogue.map((need) => ({
        id: need.id,
        name: need.name,
        summary: need.framing,
        // Needs have no category, and priority is the grouping anybody would reach for.
        group: need.priority,
        rank: need.priority,
        rankOrder: NEED_PRIORITIES.indexOf(need.priority),
        sensitive: need.sensitive,
        searchable: need.signals.map((signal) => signal.describe).join(' '),
      })),
    [catalogue],
  )

  const [selected, setSelected] = useState<string | undefined>(needCatalogue[0]?.id)
  const need = catalogue.find((item) => item.id === selected)

  return (
    <Split
      list={
        <CatalogueList
          entries={entries}
          selected={selected}
          onSelect={setSelected}
          groupLabel="priority"
          sortable
          off={offFor(overrides, 'need', needCatalogue)}
          onSelectOff={setSelected}
        />
      }
      detail={
        need === undefined ? (
          <Switched
            id={selected}
            onEdit={() => {
              const compiled = needCatalogue.find((item) => item.id === selected)
              if (compiled !== undefined) onEdit({ kind: 'need', entry: compiled })
            }}
          />
        ) : (
          <NeedDetail
            need={need}
            override={byId.get(`need:${need.id}`)}
            onEdit={() => onEdit({ kind: 'need', entry: need })}
          />
        )
      }
    />
  )
}

/**
 * What has been switched off, so the list can still show it.
 *
 * Dropping a disabled entry from the engine's catalogue is right; dropping it from the screen
 * would leave no way to switch it back on.
 */
function offFor(
  overrides: readonly CatalogueOverrideDto[],
  kind: 'goal' | 'need',
  compiled: readonly { readonly id: string; readonly name: string }[],
): readonly { readonly id: string; readonly name: string }[] {
  const disabled = new Set(
    overrides.filter((row) => row.kind === kind && !row.enabled).map((row) => row.entryId),
  )

  return compiled.filter((entry) => disabled.has(entry.id))
}

/** The detail pane for something that has been switched off. */
function Switched({
  id,
  onEdit,
}: {
  readonly id: string | undefined
  readonly onEdit: () => void
}): ReactNode {
  return (
    <Empty className="h-full border border-dashed">
      <EmptyHeader>
        <EmptyTitle>Switched off</EmptyTitle>
        <EmptyDescription>
          {id === undefined
            ? 'Pick something from the list to see how it works.'
            : 'The engines are not given this one, so it cannot be raised, offered or planned.'}
        </EmptyDescription>
      </EmptyHeader>
      {id !== undefined && (
        <Button variant="outline" size="sm" onClick={onEdit}>
          <PencilIcon />
          Switch it back on
        </Button>
      )}
    </Empty>
  )
}

function Clusters(): ReactNode {
  const entries = useMemo<readonly CatalogueEntry[]>(
    () =>
      lifeEventClusters.map((cluster) => ({
        id: cluster.id,
        name: cluster.name,
        summary: cluster.note ?? '',
        group: 'life event',
        rank: null,
        rankOrder: 0,
        sensitive: false,
        searchable: cluster.signals.map((signal) => signal.describe).join(' '),
      })),
    [],
  )

  const [selected, setSelected] = useState<string | undefined>(lifeEventClusters[0]?.id)
  const cluster = lifeEventClusters.find((item) => item.id === selected)

  return (
    <Split
      list={
        <CatalogueList
          entries={entries}
          selected={selected}
          onSelect={setSelected}
          groupLabel="life event"
          sortable={false}
          /* A cluster has no prose worth overriding: its name is the circumstance and its goals
             are the mapping. So there is nothing to switch off and nothing to reword. */
          off={[]}
          onSelectOff={setSelected}
        />
      }
      detail={cluster === undefined ? <Nothing /> : <ClusterDetail cluster={cluster} />}
    />
  )
}

function Nothing(): ReactNode {
  return (
    <Empty className="h-full border border-dashed">
      <EmptyHeader>
        <EmptyTitle>Nothing selected</EmptyTitle>
        <EmptyDescription>Pick something from the list to see how it works.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/**
 * The numbers that decide how readily anything gets raised.
 *
 * Shown rather than editable: they are constants the engines import, and a slider here would
 * change what the screen says without changing what Saoirse does. Changing them is a one-line edit
 * and a deploy, which for a prototype is the honest amount of work.
 */
function Thresholds(): ReactNode {
  return (
    <Alert>
      <AlertDescription className="space-y-1">
        <span className="block text-xs">
          Evidence is combined across signals so several weak ones add up without any being
          decisive. A goal is worth mentioning at {GOAL_THRESHOLDS.secondary} and established at{' '}
          {GOAL_THRESHOLDS.strong}; a need is clarified at {NEED_THRESHOLDS.clarify} and offered at{' '}
          {NEED_THRESHOLDS.surface}.
        </span>
        <span className="text-muted-foreground block text-2xs">
          The conditions below are code, not prompt text — the model cannot change them, and neither
          can this screen. Adding a goal means adding its conditions.
        </span>
      </AlertDescription>
    </Alert>
  )
}
