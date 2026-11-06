import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { SearchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { CASE_STATUS_LABELS, type CaseStatus } from '@domain/case.ts'
import { routes } from '@/app/routes'
import { cn } from '@/lib/utils'
import type { AdminOverview } from '@contracts/admin.ts'

type Case = AdminOverview['cases'][number]

/**
 * Which conversations to show.
 *
 * `new` is not a tab. On a prototype where every visitor gets a case the moment they arrive,
 * most of them are empty, and giving that a tab would invite somebody to open it.
 */
const TABS: readonly { readonly id: 'all' | CaseStatus; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'in_progress', label: CASE_STATUS_LABELS.in_progress },
  { id: 'needs_review', label: CASE_STATUS_LABELS.needs_review },
  { id: 'completed', label: CASE_STATUS_LABELS.completed },
  { id: 'blocked', label: CASE_STATUS_LABELS.blocked },
]

/** Which status deserves to be noticed. Only one does. */
function toneFor(status: CaseStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'blocked') return 'destructive'
  if (status === 'needs_review') return 'default'
  if (status === 'new') return 'outline'
  return 'secondary'
}

export function CaseList({
  cases,
  selected,
}: {
  readonly cases: readonly Case[]
  readonly selected: string | undefined
}): ReactNode {
  const [tab, setTab] = useState<'all' | CaseStatus>('all')
  const [query, setQuery] = useState('')

  const counts = useMemo(() => {
    const map = new Map<string, number>([['all', cases.length]])
    for (const item of cases) map.set(item.status, (map.get(item.status) ?? 0) + 1)
    return map
  }, [cases])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return cases.filter((item) => {
      if (tab !== 'all' && item.status !== tab) return false
      if (needle.length === 0) return true

      // Name and what was last said: the two things somebody would recognise a case by.
      return (
        (item.label ?? item.id).toLowerCase().includes(needle) ||
        item.latest.toLowerCase().includes(needle)
      )
    })
  }, [cases, tab, query])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-3">
        <div className="relative">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations…"
            className="pl-9"
            aria-label="Search conversations"
          />
        </div>

        <Tabs value={tab} onValueChange={(next) => setTab(next as 'all' | CaseStatus)}>
          <TabsList className="w-full">
            {TABS.map((item) => (
              <TabsTrigger key={item.id} value={item.id} className="text-xs">
                {item.label}
                {(counts.get(item.id) ?? 0) > 0 && (
                  <span className="text-muted-foreground tabular ml-1">{counts.get(item.id)}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {shown.length === 0 ? (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyTitle>Nothing here</EmptyTitle>
              <EmptyDescription>
                {query.trim().length > 0
                  ? 'No conversation matches that.'
                  : 'No conversation is in that state.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="divide-y">
            {shown.map((item) => (
              <Row key={item.id} item={item} selected={item.id === selected} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

/**
 * One conversation.
 *
 * A link rather than a click handler, so the selection is in the address: middle-clickable,
 * copyable, and survivable across a reload while somebody is watching over your shoulder.
 */
function Row({ item, selected }: { readonly item: Case; readonly selected: boolean }): ReactNode {
  return (
    <Link
      to={routes.admin.case(item.id)}
      data-state={selected ? 'selected' : undefined}
      className={cn(
        'hover:bg-muted/50 data-[state=selected]:bg-muted block px-4 py-3 transition-colors',
        selected && 'border-primary -ml-px border-l-2 pl-[calc(1rem-1px)]',
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {item.label ?? item.id.slice(0, 8)}
        </span>
        <Badge variant={toneFor(item.status)} className="text-2xs shrink-0">
          {CASE_STATUS_LABELS[item.status]}
        </Badge>
      </div>

      {item.latest.length > 0 && (
        <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">{item.latest}</p>
      )}

      <p className="text-muted-foreground tabular mt-1 text-2xs">
        {item.messages === 0 ? 'no messages' : `${String(item.messages)} messages`}
        {item.applications > 0 && ` · ${String(item.applications)} applications`}
        {` · ${item.updatedAt.slice(11, 16)}`}
      </p>
    </Link>
  )
}
