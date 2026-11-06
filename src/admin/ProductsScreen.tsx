import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DownloadIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/admin/parts'
import { CatalogueList, type CatalogueEntry } from '@/admin/CatalogueList'
import { adminApi } from '@/admin/adminClient'
import { queryKeys } from '@/lib/queryKeys'
import { useRealtimeInvalidation } from '@/lib/useRealtimeInvalidation'
import {
  knowledgeProductSchema,
  mortgageRateSchema,
  type KnowledgeProductInput,
  type MortgageRateInput,
} from '@contracts/catalogue.ts'
import type { CatalogueWrite } from '@contracts/admin.ts'

/**
 * What Saoirse can offer, and what it can quote (§51).
 *
 * The product catalogue and the mortgage rate table, as rows. Until something is loaded the
 * rows are the published files themselves, so the screen always shows what Saoirse is reading;
 * the first save copies the files in and from then on every turn reads the rows. Each is
 * edited as the JSON it is, because the pack states pricing in a different shape for almost
 * every family and a form with a field per shape would be a second catalogue to maintain.
 * The schema on the way in is the file's own, so Saoirse can be handed a different catalogue but
 * never a malformed one.
 */
export function ProductsScreen(): ReactNode {
  const products = useQuery({
    queryKey: queryKeys.admin.products(),
    queryFn: adminApi.listProducts,
  })
  const rates = useQuery({ queryKey: queryKeys.admin.rates(), queryFn: adminApi.listRates })

  const refresh = useCallback(() => {
    void products.refetch()
    void rates.refetch()
  }, [products, rates])

  useRealtimeInvalidation(['product_catalogue', 'mortgage_rates'], refresh)

  const productRows = useMemo<readonly Row[]>(
    () =>
      (products.data?.rows ?? []).map((row) => ({
        id: row.id,
        payload: row.product,
        enabled: row.enabled,
        edited: row.edited,
        published: row.published,
        version: row.version,
        updatedAt: row.updatedAt,
        name: row.product.name,
        summary: row.product.customer_job,
        group: row.product.family,
        searchable: [row.product.subfamily, ...row.product.best_for].join(' '),
      })),
    [products.data],
  )

  const rateRows = useMemo<readonly Row[]>(
    () =>
      (rates.data?.rows ?? []).map((row) => ({
        id: row.id,
        payload: row.rate,
        enabled: row.enabled,
        edited: row.edited,
        published: row.published,
        version: row.version,
        updatedAt: row.updatedAt,
        name: rateName(row.rate),
        summary: row.rate.customer_types.map(plain).join(', '),
        group: plain(row.rate.rate_family),
        searchable: row.rate.notes.join(' '),
      })),
    [rates.data],
  )

  const failed = products.error ?? rates.error

  return (
    <div className="@container @3xl:h-full @3xl:min-h-0 flex flex-col gap-4">
      <PageHeader
        title="Products and rates"
        description="The catalogue Saoirse describes products from, and the rate table it quotes. Edited here, read at the start of every turn."
      />

      {failed !== null && (
        <Alert variant="destructive">
          <AlertDescription>The rows could not be read. {failed.message}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="products" className="@3xl:min-h-0 @3xl:flex-1 flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="products">Products ({productRows.length})</TabsTrigger>
          <TabsTrigger value="rates">Mortgage rates ({rateRows.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="@3xl:min-h-0 @3xl:flex-1 flex flex-col gap-3">
          <Table
            kind="product"
            rows={productRows}
            loaded={products.data?.loaded ?? false}
            groupLabel="family"
            note={
              products.data === undefined
                ? ''
                : products.data.loaded
                  ? 'Saoirse is reading these rows.'
                  : 'Saoirse is reading the published file. Saving anything copies it into rows first, so nothing disappears.'
            }
          />
        </TabsContent>

        <TabsContent value="rates" className="@3xl:min-h-0 @3xl:flex-1 flex flex-col gap-3">
          <Table
            kind="rate"
            rows={rateRows}
            loaded={rates.data?.loaded ?? false}
            groupLabel="family"
            note={
              rates.data === undefined
                ? ''
                : `Every quote carries the date ${rates.data.asOf}. ${
                    rates.data.loaded
                      ? 'Saoirse is reading these rows; an edit moves the date to the day it was made.'
                      : 'Saoirse is reading the published table.'
                  }`
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

type Kind = 'product' | 'rate'

/** One row of either table, with what the list needs to show it. */
type Row = {
  readonly id: string
  readonly payload: unknown
  readonly enabled: boolean
  readonly edited: boolean
  readonly published: boolean
  readonly version: number
  readonly updatedAt: string
  readonly name: string
  readonly summary: string
  readonly group: string
  readonly searchable: string
}

const NEW = '__new__'

function Table({
  kind,
  rows,
  loaded,
  groupLabel,
  note,
}: {
  readonly kind: Kind
  readonly rows: readonly Row[]
  readonly loaded: boolean
  readonly groupLabel: string
  readonly note: string
}): ReactNode {
  const queries = useQueryClient()
  const [selected, setSelected] = useState<string | undefined>(undefined)

  const invalidate = useCallback(async () => {
    await queries.invalidateQueries({ queryKey: keyFor(kind) })
  }, [kind, queries])

  const load = useMutation({
    mutationFn: () =>
      kind === 'product' ? adminApi.loadPublishedProducts() : adminApi.loadPublishedRates(),
    onSuccess: async ({ inserted }) => {
      await invalidate()
      toast.success(
        inserted === 0
          ? 'Nothing to load: every published row is already here.'
          : `Loaded ${String(inserted)} published ${inserted === 1 ? 'row' : 'rows'}.`,
      )
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const entries = useMemo<readonly CatalogueEntry[]>(
    () =>
      rows
        .filter((row) => row.enabled)
        .map((row) => ({
          id: row.id,
          name: row.name,
          summary: row.summary,
          group: row.group,
          rank: row.published ? (row.edited ? 'edited' : null) : 'added',
          rankOrder: row.published ? 0 : 1,
          sensitive: false,
          searchable: `${row.id} ${row.searchable}`,
        })),
    [rows],
  )

  const off = useMemo(
    () => rows.filter((row) => !row.enabled).map((row) => ({ id: row.id, name: row.name })),
    [rows],
  )

  const current = rows.find((row) => row.id === selected)
  const edited = rows.filter((row) => row.edited || !row.enabled).length

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {note}
          {loaded && edited > 0 && (
            <> {edited === 1 ? '1 row differs' : `${String(edited)} rows differ`} from the file.</>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={load.isPending}
            onClick={() => load.mutate()}
          >
            <DownloadIcon />
            Load published
          </Button>
          <Button size="sm" onClick={() => setSelected(NEW)}>
            <PlusIcon />
            Add {kind === 'product' ? 'a product' : 'a rate'}
          </Button>
        </div>
      </div>

      <div className="@3xl:grid-cols-[22rem_1fr] @3xl:h-full @3xl:min-h-0 grid gap-4">
        <Card className="@3xl:max-h-none @3xl:min-h-0 max-h-[26rem] overflow-hidden py-0">
          <CatalogueList
            entries={entries}
            selected={selected}
            onSelect={setSelected}
            groupLabel={groupLabel}
            sortable={false}
            off={off}
            onSelectOff={setSelected}
          />
        </Card>
        <div className="@3xl:overflow-y-auto @3xl:min-h-0">
          {selected === NEW ? (
            <Editor
              key={NEW}
              kind={kind}
              row={null}
              onSaved={setSelected}
              onRemoved={() => setSelected(undefined)}
            />
          ) : current === undefined ? (
            <Empty className="h-full border border-dashed">
              <EmptyHeader>
                <EmptyTitle>Nothing selected</EmptyTitle>
                <EmptyDescription>
                  Pick a row to read it as Saoirse does, or to change it.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Editor
              key={current.id}
              kind={kind}
              row={current}
              onSaved={setSelected}
              onRemoved={() => setSelected(undefined)}
            />
          )}
        </div>
      </div>
    </>
  )
}

/**
 * The JSON, a switch, and three buttons.
 *
 * Validation runs on every keystroke against the same schema the function applies, so the
 * save button cannot be pressed on something the server would refuse, and the reason is on
 * screen before anybody presses it. "Restore published" is for a row that differs from the
 * file; "Remove" for one the file never had, which has nothing to go back to.
 */
function Editor({
  kind,
  row,
  onSaved,
  onRemoved,
}: {
  readonly kind: Kind
  /** Null for a new row, which starts from a template. */
  readonly row: Row | null
  readonly onSaved: (id: string) => void
  readonly onRemoved: () => void
}): ReactNode {
  const queries = useQueryClient()
  const initial = useMemo(
    () => JSON.stringify(row === null ? templateFor(kind) : row.payload, null, 2),
    [kind, row],
  )
  const [text, setText] = useState(initial)
  const [enabled, setEnabled] = useState(row?.enabled ?? true)

  const checked = useMemo(() => validate(kind, text), [kind, text])
  const dirty = text !== initial || enabled !== (row?.enabled ?? true)

  const invalidate = async (): Promise<void> => {
    await queries.invalidateQueries({ queryKey: keyFor(kind) })
  }

  const save = useMutation({
    mutationFn: (): Promise<CatalogueWrite> => saveDraft(kind, text, enabled),
    onSuccess: async ({ version }) => {
      await invalidate()
      if (checked.ok) onSaved(checked.id)
      toast.success(`Saved as version ${String(version)}. Saoirse reads it on the next turn.`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const restore = useMutation({
    mutationFn: () => {
      if (row === null) throw new Error('Nothing to restore.')
      return kind === 'product'
        ? adminApi.restorePublishedProduct(row.id)
        : adminApi.restorePublishedRate(row.id)
    },
    onSuccess: async () => {
      await invalidate()
      toast.success('Back to the published wording.')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: () => {
      if (row === null) throw new Error('Nothing to remove.')
      return kind === 'product' ? adminApi.deleteProduct(row.id) : adminApi.deleteRate(row.id)
    },
    onSuccess: async () => {
      await invalidate()
      onRemoved()
      toast.success('Removed. Saoirse will not see it again.')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const busy = save.isPending || restore.isPending || remove.isPending

  return (
    <Card className="gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{row === null ? `New ${kind}` : row.name}</h2>
          <p className="text-muted-foreground font-mono text-xs">
            {row === null ? 'Give it an id nothing else uses.' : row.id}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {row !== null && (
            <Badge variant={row.edited ? 'default' : 'secondary'}>
              {row.published ? (row.edited ? 'edited' : 'published') : 'added'}
            </Badge>
          )}
          {!enabled && <Badge variant="outline">off</Badge>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Switch id={`enabled-${kind}`} checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor={`enabled-${kind}`} className="text-sm">
          Saoirse may {kind === 'product' ? 'offer this' : 'quote this'}
        </Label>
      </div>

      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        className="min-h-[28rem] font-mono text-xs leading-relaxed"
        aria-label={`${kind} as JSON`}
      />

      {!checked.ok && (
        <Alert variant="destructive">
          <AlertDescription className="whitespace-pre-wrap font-mono text-xs">
            {checked.message}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {row === null
            ? 'Validated against the same schema the function applies.'
            : row.version === 0
              ? `As published${row.updatedAt === '' ? '' : `, ${row.updatedAt}`}.`
              : `Version ${String(row.version)}, saved ${row.updatedAt.slice(0, 10)}.`}
        </p>
        <div className="flex items-center gap-2">
          {row !== null && row.published && (row.edited || !row.enabled) && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => restore.mutate()}>
              <RotateCcwIcon />
              Restore published
            </Button>
          )}
          {row !== null && !row.published && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => remove.mutate()}>
              <Trash2Icon />
              Remove
            </Button>
          )}
          <Button size="sm" disabled={busy || !checked.ok || !dirty} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </Card>
  )
}

function keyFor(kind: Kind): readonly string[] {
  return kind === 'product' ? queryKeys.admin.products() : queryKeys.admin.rates()
}

type Checked =
  { readonly ok: true; readonly id: string } | { readonly ok: false; readonly message: string }

function validate(kind: Kind, text: string): Checked {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Not JSON.' }
  }

  const parsed =
    kind === 'product'
      ? knowledgeProductSchema.safeParse(value)
      : mortgageRateSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues
        .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
        .join('\n'),
    }
  }

  return { ok: true, id: parsed.data.id }
}

/** Parses again rather than trusting the preview: the text is what is saved, not the memo. */
function saveDraft(kind: Kind, text: string, enabled: boolean): Promise<CatalogueWrite> {
  const value: unknown = JSON.parse(text)
  if (kind === 'product') {
    const product = knowledgeProductSchema.parse(value)
    return adminApi.setProduct(product.id, product, enabled)
  }
  const rate = mortgageRateSchema.parse(value)
  return adminApi.setRate(rate.id, rate, enabled)
}

function templateFor(kind: Kind): KnowledgeProductInput | MortgageRateInput {
  const today = new Date().toISOString().slice(0, 10)

  if (kind === 'product') {
    return {
      id: 'savings.new_account',
      name: 'New account',
      family: 'savings',
      subfamily: '',
      product_type: 'deposit',
      catalogue_status: 'active_public',
      source_confidence: 'presenter',
      customer_job: 'What this is for, in one sentence.',
      best_for: ['Who it suits.'],
      features: ['What it does.'],
      benefits: [],
      eligibility: ['Who can have it.'],
      constraints_and_cautions: ['What to watch.'],
      pricing_and_rates: { snapshot: { aer_variable_pct: 2.0 } },
      application_channels: ['app'],
      advice_model: 'execution_only',
      related_products: [],
      assistant_usage: {
        surface_when: ['When the customer says this is what they are trying to do.'],
      },
      freshness_class: 'rates_and_pricing',
      last_verified: today,
      source_urls: [],
    }
  }

  return {
    id: 'new.standard.3y.a',
    customer_types: ['first_time_buyer', 'mover'],
    rate_family: 'standard_fixed_cashback',
    term_years: 3,
    ber: 'A',
    interest_rate_pct: 3.1,
    aprc_pct: null,
    cashback: { eligible: true, structure: '2% cashback on drawdown' },
    minimum_mortgage_amount_eur: null,
    notes: [],
  }
}

/** `standard_fixed_cashback` → `standard fixed cashback`. The ids are readable enough once unsnaked. */
function plain(value: string): string {
  return value.replaceAll('_', ' ')
}

function rateName(rate: MortgageRateInput): string {
  return [
    rate.term_years === null ? 'Variable' : `${String(rate.term_years)}-year fixed`,
    rate.ber === 'any' ? 'any BER' : `BER ${rate.ber}`,
    `${String(rate.interest_rate_pct)}%`,
  ].join(' · ')
}
