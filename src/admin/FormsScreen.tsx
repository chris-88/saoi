import { type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeftIcon,
  CalculatorIcon,
  FileCheckIcon,
  FileJsonIcon,
  PaperclipIcon,
  RefreshCwIcon,
  ShieldOffIcon,
} from 'lucide-react'
import { adminApi, type FormInspection, type SubmissionEntry } from '@/admin/adminClient'
import { routes } from '@/app/routes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Code } from '@/components/Code'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

/**
 * What a Demo Bank digital form looks like going through Saoirse.
 *
 * Three things side by side, because the claim only lands when they can be read against each
 * other: the definition the bank publishes, what Saoirse has collected from the customer, and the
 * exact packet those answers produce. The argument is not that Saoirse can hold a conversation
 * about SuperSaver. It is that Saoirse is another renderer of the SuperSaver journey.
 *
 * Works on an unfinished application on purpose. A packet filling up as the conversation goes
 * is far more convincing than one presented complete, and it is the honest state of most
 * applications most of the time.
 */

const SOURCE_TONE: Readonly<Record<SubmissionEntry['source'], string>> = {
  answer: 'bg-primary/10 text-primary',
  reused: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  consent: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  derived: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  default: 'bg-muted text-muted-foreground',
  runtime: 'bg-muted text-muted-foreground',
}

const SOURCE_LABEL: Readonly<Record<SubmissionEntry['source'], string>> = {
  answer: 'asked',
  reused: 'already knew',
  consent: 'consent',
  derived: 'worked out',
  default: 'form default',
  runtime: 'runtime',
}

/** Masked unless somebody chooses otherwise. These are real-shaped personal details. */
function shown(entry: SubmissionEntry): string {
  if (!entry.sensitive || entry.value.length === 0) return entry.value
  return '•'.repeat(Math.min(10, entry.value.length))
}

function Stat({ label, value }: { label: string; value: string | number }): ReactNode {
  return (
    <div>
      <p className="text-muted-foreground text-2xs tracking-wide uppercase">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}

const FIDELITY_LABEL: Readonly<Record<string, string>> = {
  source_faithful: 'computed from the form’s own inputs',
  fixture: 'stand-in, not computed',
  unsupported: 'cannot be worked out yet',
}

const FIDELITY_TONE: Readonly<Record<string, string>> = {
  source_faithful: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  fixture: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  unsupported: 'bg-muted text-muted-foreground',
}

/**
 * What the form decides, and how much of it we are entitled to decide.
 *
 * The panel exists to make one distinction visible in a room: a repayment is arithmetic from
 * the control's own declared inputs, and an eligibility verdict is a credit decision made by
 * systems nobody here has seen. Showing them the same way would be the dishonest part.
 */
function Calculations({ data }: { data: FormInspection }): ReactNode {
  if (data.calculations.length === 0 && data.limits.length === 0) return null

  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <CalculatorIcon className="size-4" />
        What the form works out
      </h2>
      {data.rateBasis !== null && (
        <p className="text-muted-foreground mt-1 text-xs">Quoted at the {data.rateBasis}.</p>
      )}

      <div className="mt-3 space-y-3">
        {data.calculations.map((calculation) => (
          <div key={calculation.fieldId} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{calculation.label}</p>
              <Badge className={cn('text-2xs', FIDELITY_TONE[calculation.fidelity])}>
                {FIDELITY_LABEL[calculation.fidelity]}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{calculation.note}</p>

            {Object.keys(calculation.parameters).length > 0 && (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {Object.entries(calculation.parameters).map(([name, value]) => (
                  <div key={name} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground truncate font-mono text-2xs">{name}</dt>
                    <dd className="font-medium tabular-nums">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            )}

            {calculation.result !== null && (
              <p className="mt-2 text-sm font-semibold tabular-nums">
                {typeof calculation.result === 'number'
                  ? `€${calculation.result.toFixed(2)} a month`
                  : calculation.result}
              </p>
            )}
          </div>
        ))}

        {data.limits.map((limit) => (
          <div
            key={`${limit.comparedField}-${limit.limit}`}
            className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
          >
            <p className="text-sm font-medium">{limit.label}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              The document&rsquo;s own rule: field {limit.comparedField} is {limit.actual}, which is{' '}
              {limit.operator} {limit.limit}.
            </p>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** A declaration is only evidence if the wording it was given against travels with it. */
function Consents({ data }: { data: FormInspection }): ReactNode {
  if (data.consents.length === 0) return null

  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <FileCheckIcon className="size-4" />
        Declarations agreed to
      </h2>
      <ul className="mt-3 space-y-3">
        {data.consents.map((consent) => (
          <li key={consent.fieldId} className="border-l-2 pl-3">
            <p className="text-xs leading-relaxed">{consent.wording}</p>
            <p className="text-muted-foreground mt-1 text-2xs">
              input_{consent.fieldId} · {new Date(consent.agreedAt).toLocaleString()}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Documents({ data }: { data: FormInspection }): ReactNode {
  if (data.documents.length === 0) return null

  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <PaperclipIcon className="size-4" />
        Documents
      </h2>
      <ul className="mt-3 space-y-2">
        {data.documents.map((document) => (
          <li key={document.fieldId} className="rounded-md border p-3">
            <p className="text-sm font-medium">{document.fileName}</p>
            <p className="text-muted-foreground mt-1 text-2xs">
              input_{document.fieldId}
              {document.sizeBytes !== null &&
                ` · ${String(Math.round(document.sizeBytes / 1024))}KB`}
              {' · '}
              {new Date(document.attachedAt).toLocaleString()}
            </p>
            <p className="text-muted-foreground mt-2 text-2xs">Signatures: {document.signatures}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** How many entries came from each place, biggest first, empty sources left out. */
function sourceBreakdown(
  entries: readonly SubmissionEntry[],
): readonly { source: SubmissionEntry['source']; count: number }[] {
  const counts = new Map<SubmissionEntry['source'], number>()
  for (const entry of entries) counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1)

  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * The packet as JSON, in the order it would go out in.
 *
 * Entries are pairs rather than an object because the packet is `multipart/form-data` and a
 * form can carry the same key twice: an object would silently collapse those, and the order
 * is part of what is being shown. Sensitive values arrive masked and stay masked.
 */
function packetJson(submission: FormInspection['submission']): string {
  const entries = submission.entries
    .map((entry) => `    [${JSON.stringify(entry.key)}, ${JSON.stringify(shown(entry))}]`)
    .join(',\n')

  return [
    '{',
    `  "method": ${JSON.stringify(submission.method)},`,
    `  "target": ${JSON.stringify(submission.target)},`,
    `  "encoding": ${JSON.stringify(submission.encoding)},`,
    `  "formId": ${JSON.stringify(submission.formId)},`,
    `  "formVersion": ${JSON.stringify(submission.formVersion)},`,
    `  "generatedAt": ${JSON.stringify(submission.generatedAt)},`,
    `  "status": ${JSON.stringify(submission.status)},`,
    '  "externalRequestMade": false,',
    '  "entries": [',
    entries,
    '  ]',
    '}',
  ].join('\n')
}

/**
 * Collected on the left, the packet on the right.
 *
 * Side by side rather than stacked, because the claim is a relationship between the two: these
 * answers, from a conversation, become that request. Read one under the other and they are two
 * lists; read them across and the second is obviously made of the first.
 *
 * The right pane is shaped like the request it would be, and labelled twice with the fact that
 * it is not one. That is the risk of making it look convincing, and the answer is to be louder
 * rather than vaguer: the endpoint is where the genuine journey submits, and nothing here has
 * ever been sent to it.
 */
function Inspection({ data }: { data: FormInspection }): ReactNode {
  const { definition, collected, outstanding, submission } = data
  const reusedCount = collected.filter((item) => item.reused).length

  return (
    <div className="space-y-5">
      {/* The definition, and the evidence it is the bank's rather than ours. */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{definition.version}</h2>
          <Badge variant="secondary" className="font-mono text-2xs">
            form {definition.formId}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1 font-mono text-2xs break-all">
          {definition.source}
        </p>
        <p className="text-muted-foreground text-2xs">
          retrieved {new Date(definition.retrievedAt).toLocaleString()} · sha256{' '}
          {definition.sourceHash}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="fields" value={definition.fieldCount} />
          <Stat label="apply here" value={definition.activeCount} />
          <Stat label="questions" value={definition.questionCount} />
          <Stat label="required" value={definition.requiredCount} />
        </div>
      </Card>

      {/* `min-w-0` on both: a code block will otherwise push its column past the viewport. */}
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="min-w-0 space-y-5">
          <Card className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">What Saoirse has collected</h2>
              <p className="text-muted-foreground text-xs">
                {collected.length} answered
                {reusedCount > 0 && `, ${String(reusedCount)} never asked for`} ·{' '}
                {outstanding.length} still needed
              </p>
            </div>

            <ul className="mt-3 divide-y">
              {collected.map((item) => (
                <li
                  key={item.fieldId}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
                >
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 font-mono text-2xs font-semibold',
                      item.reused ? SOURCE_TONE.reused : SOURCE_TONE.answer,
                    )}
                  >
                    {item.reused ? SOURCE_LABEL.reused : SOURCE_LABEL.answer}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">{item.label || item.type}</span>
                  <span className="text-muted-foreground font-mono text-2xs">
                    {item.toscana ?? `field ${item.fieldId}`}
                  </span>
                </li>
              ))}
            </ul>

            {outstanding.length > 0 && (
              <>
                <Separator className="my-3" />
                <p className="text-muted-foreground text-xs">
                  Still required:{' '}
                  {outstanding
                    .slice(0, 6)
                    .map((item) => item.label || item.type)
                    .join(', ')}
                  {outstanding.length > 6 && ` and ${String(outstanding.length - 6)} more`}
                </p>
              </>
            )}
          </Card>

          <Calculations data={data} />
          <Consents data={data} />
          <Documents data={data} />
        </div>

        {/*
          `self-start` or the grid stretches this to the height of the left column and the
          sticky position has nothing left to travel within. That has caught this codebase
          once already, on the explainer's contents rail.
        */}
        <Card className="min-w-0 self-start p-4 xl:sticky xl:top-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <FileJsonIcon className="size-4" />
              The request this produces
            </h2>
            <Badge className="gap-1 bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400">
              <ShieldOffIcon className="size-3" />
              {submission.status.replaceAll('_', ' ').toLowerCase()}
            </Badge>
          </div>

          <p className="mt-2 font-mono text-xs break-all">
            <span className="text-foreground font-semibold">{submission.method}</span>{' '}
            <span className="text-muted-foreground">{submission.target}</span>
          </p>
          <p className="text-muted-foreground text-2xs">
            {submission.encoding} · {submission.entries.length} entries
          </p>

          {/*
            Where every entry came from, which the JSON cannot say without ceasing to be JSON.
            It is also the most persuasive line on the screen: most of a packet is defaults the
            form carries, values it computes and answers nobody was asked for twice, and only a
            minority is anything the customer actually typed.
          */}
          <div className="mt-2 flex flex-wrap gap-1">
            {sourceBreakdown(submission.entries).map(({ source, count }) => (
              <span
                key={source}
                className={cn('rounded px-1.5 py-0.5 font-mono text-2xs', SOURCE_TONE[source])}
              >
                {count} {SOURCE_LABEL[source]}
              </span>
            ))}
          </div>

          <Code
            text={packetJson(submission)}
            language="json"
            className="mt-3 max-h-[32rem] overflow-auto rounded-lg border"
          />

          <p className="text-muted-foreground mt-2 text-2xs leading-relaxed">
            That endpoint is where the bank&rsquo;s own journey submits, read from the published
            definition. It is recorded so the packet can be checked against the real thing. No
            request has ever been made to it, and nothing here can make one.
          </p>
        </Card>
      </div>
    </div>
  )
}

export function FormsScreen(): ReactNode {
  const { formApplicationId } = useParams<{ formApplicationId: string }>()

  const list = useQuery({
    queryKey: ['admin', 'form-applications'],
    queryFn: () => adminApi.listFormApplications(),
    enabled: formApplicationId === undefined,
  })

  const inspection = useQuery({
    queryKey: ['admin', 'form-application', formApplicationId ?? 'none'],
    queryFn: () => adminApi.inspectFormApplication(formApplicationId ?? ''),
    enabled: formApplicationId !== undefined,
  })

  const queryClient = useQueryClient()
  /*
   * For conversations that happened before the mapping existed, and after editing it.
   * Idempotent, so pressing it twice is the same as pressing it once.
   */
  const rebuild = useMutation({
    mutationFn: adminApi.rebuildFormApplications,
    onSuccess: (result) => {
      toast.success(
        result.forms === 0
          ? 'Nothing to build: no conversation has started a form yet'
          : `${String(result.forms)} ${result.forms === 1 ? 'form' : 'forms'} rebuilt, ` +
              `${String(result.answered)} answers mapped`,
      )
      void queryClient.invalidateQueries({ queryKey: ['admin', 'form-applications'] })
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  if (formApplicationId !== undefined) {
    return (
      <div className="space-y-4">
        <Link
          to={routes.admin.forms}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeftIcon className="size-4" />
          All form applications
        </Link>

        {inspection.isPending && <Skeleton className="h-96 w-full" />}
        {inspection.isError && (
          <Card className="p-4">
            <p className="text-destructive text-sm">{String(inspection.error.message)}</p>
          </Card>
        )}
        {inspection.data && <Inspection data={inspection.data} />}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Digital forms</h1>
          <p className="text-muted-foreground mt-1 max-w-[62ch] text-sm leading-relaxed">
            Applications collected against Demo Bank&rsquo;s illustrative form definitions. Open any
            of them, finished or not, to see the definition, what Saoirse has gathered, and the
            exact packet it would produce.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={rebuild.isPending}
          onClick={() => rebuild.mutate()}
        >
          <RefreshCwIcon className={rebuild.isPending ? 'animate-spin' : undefined} />
          {rebuild.isPending ? 'Rebuilding…' : 'Rebuild from conversations'}
        </Button>
      </div>

      {list.isPending && <Skeleton className="h-40 w-full" />}
      {list.isError && (
        <Card className="p-4">
          <p className="text-destructive text-sm">{String(list.error.message)}</p>
        </Card>
      )}

      {list.data?.applications.length === 0 && (
        <Card className="p-4">
          <p className="text-muted-foreground text-sm">
            Nothing collected yet. One appears as soon as a conversation starts filling in a form.
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {(list.data?.applications ?? []).map((item) => (
          <Link key={item.id} to={routes.admin.formApplication(item.id)} className="block">
            <Card className="hover:bg-accent/40 p-4 transition-colors">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">
                  {item.who ?? `Unnamed · ${item.caseId.slice(0, 8)}`}
                </span>
                <span className="text-muted-foreground font-mono text-2xs">form {item.formId}</span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">{item.formVersion}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {item.answered} answered
                {item.reused > 0 && `, ${String(item.reused)} carried over`} · updated{' '}
                {new Date(item.updatedAt).toLocaleString()}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
