import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcwIcon } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { checkinKey } from '@domain/catalogue/overlay.ts'
import { NEED_PRIORITIES, type NeedDefinition, type NeedPriority } from '@domain/needs/types.ts'
import type { GoalBlueprint } from '@domain/goals/types.ts'
import { adminApi } from '@/admin/adminClient'
import { queryKeys } from '@/lib/queryKeys'
import type { CatalogueOverrideDto } from '@contracts/admin.ts'

/** What is being edited, with the compiled wording to fall back to. */
export type Editing =
  | { readonly kind: 'goal'; readonly entry: GoalBlueprint }
  | { readonly kind: 'need'; readonly entry: NeedDefinition }

type Draft = {
  enabled: boolean
  name: string
  summary: string
  priority: NeedPriority | null
  milestoneLabels: Record<string, string>
  checkinAgendas: Record<string, string>
}

/**
 * Editing the wording, and nothing else (plan §3.2, decision 2).
 *
 * The fields here are prose. A goal's signals are predicates over facts — `savings < essentials
 * * 3` — and no form edits that, so the conditions are not in this sheet at any depth. The one
 * control that changes behaviour is the switch at the top, and a boolean cannot be malformed.
 *
 * Empty means "use what is compiled in" rather than "blank". So a presenter who clears a name is
 * restoring the catalogue's wording, which is also the only sensible reading of an empty field
 * on a form whose placeholder is the value it would fall back to.
 */
export function CatalogueEditor({
  editing,
  override,
  onClose,
}: {
  readonly editing: Editing | null
  readonly override: CatalogueOverrideDto | undefined
  readonly onClose: () => void
}): ReactNode {
  return (
    <Sheet open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {editing !== null && (
          /* Keyed so switching entries while the sheet is open resets the draft rather than
             carrying the last entry's edits onto a different goal. */
          <Form
            key={`${editing.kind}:${editing.entry.id}`}
            editing={editing}
            override={override}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function Form({
  editing,
  override,
  onClose,
}: {
  readonly editing: Editing
  readonly override: CatalogueOverrideDto | undefined
  readonly onClose: () => void
}): ReactNode {
  const queries = useQueryClient()
  const { entry } = editing

  const [draft, setDraft] = useState<Draft>(() => ({
    enabled: override?.enabled ?? true,
    name: override?.name ?? '',
    summary: override?.summary ?? '',
    priority: override?.priority ?? null,
    milestoneLabels: { ...(override?.milestoneLabels ?? {}) },
    // One line per agenda item, which is how anybody edits a list of sentences.
    checkinAgendas: Object.fromEntries(
      Object.entries(override?.checkinAgendas ?? {}).map(([key, lines]) => [key, lines.join('\n')]),
    ),
  }))

  const invalidate = async (): Promise<void> => {
    await queries.invalidateQueries({ queryKey: queryKeys.admin.catalogue() })
  }

  const save = useMutation({
    mutationFn: () =>
      adminApi.setCatalogueOverride({
        kind: editing.kind,
        entryId: entry.id,
        enabled: draft.enabled,
        name: blank(draft.name),
        summary: blank(draft.summary),
        priority: editing.kind === 'need' ? draft.priority : null,
        milestoneLabels: Object.fromEntries(
          Object.entries(draft.milestoneLabels).filter(([, value]) => value.trim().length > 0),
        ),
        checkinAgendas: Object.fromEntries(
          Object.entries(draft.checkinAgendas)
            .map(([key, text]) => [key, lines(text)] as [string, string[]])
            .filter(([, agenda]) => agenda.length > 0),
        ),
      }),
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })

  const reset = useMutation({
    mutationFn: () => adminApi.clearCatalogueOverride(editing.kind, entry.id),
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })

  const busy = save.isPending || reset.isPending
  const compiledSummary = 'description' in entry ? entry.description : entry.framing

  return (
    <>
      <SheetHeader>
        <SheetTitle>Reword {entry.name}</SheetTitle>
        <SheetDescription>
          The wording only. The conditions that raise this are code and are not editable here.
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-4 pb-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="enabled">In use</Label>
            <p className="text-muted-foreground text-xs">
              Switched off, the engine never hears about it — so it cannot be raised, offered or
              planned.
            </p>
          </div>
          <Switch
            id="enabled"
            checked={draft.enabled}
            onCheckedChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
          />
        </div>

        <Field
          id="name"
          label="Name"
          hint="What Saoirse calls it when it brings it up."
          placeholder={entry.name}
          value={draft.name}
          onChange={(name) => setDraft((d) => ({ ...d, name }))}
        />

        <Field
          id="summary"
          label={'description' in entry ? 'Description' : 'Framing'}
          hint="The one line that explains what it is for."
          placeholder={compiledSummary}
          value={draft.summary}
          onChange={(summary) => setDraft((d) => ({ ...d, summary }))}
          long
        />

        {editing.kind === 'need' && (
          <div className="space-y-2">
            <Label htmlFor="priority">Priority</Label>
            <p className="text-muted-foreground text-xs">
              How insistently this competes with other needs for the next question.
            </p>
            <Select
              value={draft.priority ?? 'compiled'}
              onValueChange={(value) =>
                setDraft((d) => ({
                  ...d,
                  priority: value === 'compiled' ? null : (value as NeedPriority),
                }))
              }
            >
              <SelectTrigger id="priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="compiled">
                  As compiled: {editing.entry.priority.replaceAll('_', ' ')}
                </SelectItem>
                {NEED_PRIORITIES.map((priority) => (
                  <SelectItem key={priority} value={priority} className="capitalize">
                    {priority.replaceAll('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {'milestones' in entry && entry.milestones.length > 0 && (
          <>
            <Separator />
            <div className="space-y-4">
              <div className="space-y-0.5">
                <h3 className="text-sm font-medium">Milestone labels</h3>
                <p className="text-muted-foreground text-xs">
                  How each step is named. How it is detected stays in code.
                </p>
              </div>
              {entry.milestones.map((milestone) => (
                <Field
                  key={milestone.id}
                  id={`milestone-${milestone.id}`}
                  label={milestone.id}
                  hint={null}
                  placeholder={milestone.label}
                  value={draft.milestoneLabels[milestone.id] ?? ''}
                  onChange={(value) =>
                    setDraft((d) => ({
                      ...d,
                      milestoneLabels: { ...d.milestoneLabels, [milestone.id]: value },
                    }))
                  }
                />
              ))}
            </div>
          </>
        )}

        {'checkins' in entry && entry.checkins.length > 0 && (
          <>
            <Separator />
            <div className="space-y-4">
              <div className="space-y-0.5">
                <h3 className="text-sm font-medium">Check-in agendas</h3>
                <p className="text-muted-foreground text-xs">
                  What Saoirse would want to cover when it comes back to this. One line each.
                </p>
              </div>
              {entry.checkins.map((checkin) => {
                const key = checkinKey(checkin)
                return (
                  <div key={key} className="space-y-2">
                    <Label htmlFor={`checkin-${key}`}>{checkin.purpose}</Label>
                    <Textarea
                      id={`checkin-${key}`}
                      rows={checkin.agenda.length + 1}
                      placeholder={checkin.agenda.join('\n')}
                      value={draft.checkinAgendas[key] ?? ''}
                      onChange={(event) =>
                        setDraft((d) => ({
                          ...d,
                          checkinAgendas: { ...d.checkinAgendas, [key]: event.target.value },
                        }))
                      }
                    />
                  </div>
                )
              })}
            </div>
          </>
        )}

        {override !== undefined && (
          <Alert>
            <AlertDescription className="text-xs">
              Reworded {override.version === 1 ? 'once' : `${String(override.version)} times`}, last
              on {override.updatedAt.slice(0, 10)}.
            </AlertDescription>
          </Alert>
        )}

        {(save.isError || reset.isError) && (
          <Alert variant="destructive">
            <AlertDescription>
              {(save.error ?? reset.error)?.message ?? 'That did not save.'}
            </AlertDescription>
          </Alert>
        )}
      </div>

      <SheetFooter className="flex-row items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || override === undefined}
          onClick={() => reset.mutate()}
        >
          <RotateCcwIcon />
          Back to compiled
        </Button>
        <Button disabled={busy} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </SheetFooter>
    </>
  )
}

function Field({
  id,
  label,
  hint,
  placeholder,
  value,
  onChange,
  long,
}: {
  readonly id: string
  readonly label: string
  readonly hint: string | null
  readonly placeholder: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly long?: boolean
}): ReactNode {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {hint !== null && <p className="text-muted-foreground text-xs">{hint}</p>}
      {long === true ? (
        <Textarea
          id={id}
          rows={3}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  )
}

/** An empty field means "use what is compiled in", which is null on the wire, not "". */
function blank(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}
