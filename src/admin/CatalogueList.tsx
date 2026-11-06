import { useMemo, useState, type ReactNode } from 'react'
import { SearchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { cn, sentence } from '@/lib/utils'

/** One row, reduced to what the list needs to show and sort by. */
export type CatalogueEntry = {
  readonly id: string
  readonly name: string
  readonly summary: string
  /** The grouping this belongs to, used for the filter. */
  readonly group: string
  /** Shown on the row. Priority for needs, nothing for the rest. */
  readonly rank: string | null
  /** Where this sorts when ordered by rank. Higher is first. */
  readonly rankOrder: number
  readonly sensitive: boolean
  /** Free text the search should also match — signal wording, mostly. */
  readonly searchable: string
}

type Order = 'name' | 'group' | 'rank'

/**
 * The master half of master/detail (§6).
 *
 * An accordion made every one of twenty-six goals a thing to open and close, and comparing two
 * of them meant holding the first in your head. A list that stays put while the detail changes
 * beside it is the same data arranged so it can be read.
 */
export function CatalogueList({
  entries,
  selected,
  onSelect,
  groupLabel,
  sortable,
  off,
  onSelectOff,
}: {
  readonly entries: readonly CatalogueEntry[]
  readonly selected: string | undefined
  readonly onSelect: (id: string) => void
  /** What the grouping is called, for the filter's placeholder. */
  readonly groupLabel: string
  /** Whether ranking by priority is meaningful. Only needs carry one. */
  readonly sortable: boolean
  /**
   * Entries switched off, which are no longer in `entries` because they are no longer in the
   * catalogue the engines are handed. Shown at the end so there is still a way back.
   */
  readonly off: readonly { readonly id: string; readonly name: string }[]
  readonly onSelectOff: (id: string) => void
}): ReactNode {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('all')
  const [order, setOrder] = useState<Order>(sortable ? 'rank' : 'group')

  const groups = useMemo(
    () => [...new Set(entries.map((entry) => entry.group))].sort((a, b) => a.localeCompare(b)),
    [entries],
  )

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()

    const filtered = entries.filter((entry) => {
      if (group !== 'all' && entry.group !== group) return false
      if (needle.length === 0) return true

      return (
        entry.name.toLowerCase().includes(needle) ||
        entry.id.includes(needle.replaceAll(' ', '_')) ||
        entry.summary.toLowerCase().includes(needle) ||
        entry.searchable.toLowerCase().includes(needle)
      )
    })

    // Sorted on a copy: the catalogue is a module constant and sorting it in place would
    // reorder it for everything else that imports it, for the life of the page.
    return [...filtered].sort((a, b) => {
      if (order === 'rank' && a.rankOrder !== b.rankOrder) return b.rankOrder - a.rankOrder
      if (order === 'group' && a.group !== b.group) return a.group.localeCompare(b.group)
      return a.name.localeCompare(b.name)
    })
  }, [entries, query, group, order])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search, including the conditions…"
            className="pl-9"
            aria-label="Search the catalogue"
          />
        </div>

        <div className="flex gap-2">
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger size="sm" className="flex-1" aria-label={`Filter by ${groupLabel}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every {groupLabel}</SelectItem>
              {groups.map((name) => (
                <SelectItem key={name} value={name} className="capitalize">
                  {name.replaceAll('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={order} onValueChange={(next) => setOrder(next as Order)}>
            <SelectTrigger size="sm" className="flex-1" aria-label="Sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortable && <SelectItem value="rank">By priority</SelectItem>}
              <SelectItem value="group">By {groupLabel}</SelectItem>
              <SelectItem value="name">By name</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <p className="text-muted-foreground tabular text-2xs">
          {shown.length === entries.length
            ? `${String(entries.length)} in use`
            : `${String(shown.length)} of ${String(entries.length)}`}
          {off.length > 0 && ` · ${String(off.length)} switched off`}
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {shown.length === 0 ? (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyTitle>Nothing matches</EmptyTitle>
              <EmptyDescription>
                Search covers names, descriptions and the conditions that raise each one.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="divide-y">
            {shown.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelect(entry.id)}
                data-state={entry.id === selected ? 'selected' : undefined}
                className={cn(
                  'hover:bg-muted/50 data-[state=selected]:bg-muted block w-full px-4 py-3 text-left transition-colors',
                  entry.id === selected && 'border-primary -ml-px border-l-2 pl-[calc(1rem-1px)]',
                )}
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 text-sm font-medium">{entry.name}</span>
                  {entry.sensitive && (
                    <Badge variant="destructive" className="text-2xs shrink-0">
                      sensitive
                    </Badge>
                  )}
                  {entry.rank !== null && (
                    <Badge variant="secondary" className="text-2xs shrink-0">
                      {sentence(entry.rank.replaceAll('_', ' '))}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{entry.summary}</p>
              </button>
            ))}
          </div>
        )}

        {/* Not filtered or sorted with the rest: it is a short list of exceptions, not part of
            the catalogue, and burying it among 26 rows is how somebody loses a goal. */}
        {off.length > 0 && (
          <div className="border-t">
            <p className="text-muted-foreground px-4 pt-3 pb-1 text-2xs font-medium">
              Switched off
            </p>
            <div className="divide-y">
              {off.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onSelectOff(entry.id)}
                  data-state={entry.id === selected ? 'selected' : undefined}
                  className={cn(
                    'hover:bg-muted/50 data-[state=selected]:bg-muted block w-full px-4 py-2.5 text-left transition-colors',
                    entry.id === selected && 'border-primary -ml-px border-l-2 pl-[calc(1rem-1px)]',
                  )}
                >
                  <span className="text-muted-foreground text-sm line-through">{entry.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
