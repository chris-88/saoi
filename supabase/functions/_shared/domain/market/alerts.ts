import { type ALERT_KINDS, REMINDER_STAGES, type REMINDER_KINDS } from '../../contracts/alerts.ts'
import type { MarketRates } from '../../market/schema.ts'
import { pct } from './product.ts'
import type { Market } from './types.ts'

/**
 * Plan alerts (design `2026-11-11-saoi-plan-alerts-design`), pure: which claimed plans a market
 * change touches, which reminders are due today, and the words for each. Every line is a fact
 * with its date and source. Nothing is picked and nothing is asked of the customer.
 */

export type AlertDraft = {
  readonly caseId: string
  readonly kind: (typeof ALERT_KINDS)[number]
  readonly productId: string | null
  /** The `market_products.id` the alert is about: the new version, or the withdrawn one. */
  readonly productVersion: number | null
  readonly reminderId: string | null
  readonly stage: number | null
  readonly title: string
  readonly body: string
  readonly data: Readonly<Record<string, unknown>>
}

export type PlanProductRef = {
  readonly provider: string
  readonly source: 'bank' | 'ccpc'
  readonly productId: string
  readonly providerName: string
  readonly productName: string
  /** The rate the plan counted. Absent when the plan stated none. */
  readonly ratePct?: number | undefined
}

export type ClaimedPlanRef = {
  readonly caseId: string
  /** When the plan was built: a change before then is already in its figures. */
  readonly builtAt: string
  readonly products: readonly PlanProductRef[]
}

export type ProductChange = {
  readonly provider: string
  readonly source: 'bank' | 'ccpc'
  readonly productId: string
  readonly previousVersionId: number
  /** The successor version; null when the product was withdrawn. */
  readonly currentVersionId: number | null
  readonly previousRate: number | null
  readonly currentRate: number | null
  /** YYYY-MM-DD the new rate takes effect, where the source says. */
  readonly effectiveFrom: string | null
  /** When Saoi saw the change: the old version's `superseded_at`. */
  readonly changedAt: string
  readonly sourceUrl: string
  /** When the source was read for the current version (or the withdrawn one's last check). */
  readonly checkedAt: string
  readonly withdrawn: boolean
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "10 Nov 2026" (or "10 Nov") from an ISO date or timestamp, read in Europe/Dublin. */
export function shortDate(iso: string, withYear = true): string {
  const date =
    iso.length === 10
      ? iso
      : new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' })
  const [year, month, dayOfMonth] = date.split('-')
  const name = MONTHS[Number(month) - 1] ?? month ?? ''
  return `${String(Number(dayOfMonth))} ${name}${withYear ? ` ${year ?? ''}` : ''}`
}

/** The one rate a version is compared on: its headline, or the top of a term ladder. */
export function headlineRate(rates: MarketRates): number | null {
  switch (rates.kind) {
    case 'deposit':
      return (
        rates.aerPct ??
        (rates.terms === undefined ? null : Math.max(...rates.terms.map((term) => term.aerPct)))
      )
    case 'mortgage':
      return rates.initialRatePct
    case 'loan':
      return rates.aprPct
    case 'credit_card':
      return rates.aprPct
    case 'current_account':
      return rates.creditInterestPct
  }
}

const sourceWords = (source: 'bank' | 'ccpc'): string =>
  source === 'bank' ? 'bank’s site' : 'CCPC’s tables'

const nameOf = (product: PlanProductRef): string =>
  product.productName.toLowerCase().startsWith(product.providerName.toLowerCase())
    ? product.productName
    : `${product.providerName} ${product.productName}`

const keyOf = (item: { provider: string; source: string; productId: string }): string =>
  `${item.provider}|${item.source}|${item.productId}`

/**
 * One alert per case and changed version: a rate that moved, or a product no longer offered,
 * on a product in a claimed plan built before the change. A version whose headline rate did
 * not move (its conditions or wording did) raises nothing.
 */
export function rateChangeAlerts(
  plans: readonly ClaimedPlanRef[],
  changes: readonly ProductChange[],
): AlertDraft[] {
  const byKey = new Map<string, ProductChange[]>()
  for (const change of changes) {
    if (
      !change.withdrawn &&
      (change.previousRate === change.currentRate || change.currentRate === null)
    )
      continue
    byKey.set(keyOf(change), [...(byKey.get(keyOf(change)) ?? []), change])
  }
  const drafts = new Map<string, AlertDraft>()
  for (const plan of plans) {
    for (const product of plan.products) {
      for (const change of byKey.get(keyOf(product)) ?? []) {
        if (change.changedAt <= plan.builtAt) continue
        const version = change.currentVersionId ?? change.previousVersionId
        const id = `${plan.caseId}|${String(version)}`
        if (drafts.has(id)) continue
        const counted =
          product.ratePct === undefined
            ? 'Your plan did not state a rate for it.'
            : `Your plan counted ${pct(product.ratePct)}.`
        const read = `${sourceWords(change.source)}, read ${shortDate(change.checkedAt, false)}`
        const data = {
          provider: change.provider,
          source: change.source,
          productName: nameOf(product),
          previousRatePct: change.previousRate,
          currentRatePct: change.currentRate,
          planRatePct: product.ratePct ?? null,
          effectiveFrom: change.effectiveFrom,
          changedAt: change.changedAt,
          checkedAt: change.checkedAt,
          sourceUrl: change.sourceUrl,
        }
        drafts.set(
          id,
          change.withdrawn
            ? {
                caseId: plan.caseId,
                kind: 'product_withdrawn',
                productId: change.productId,
                productVersion: version,
                reminderId: null,
                stage: null,
                title: 'A product in your plan is no longer listed',
                body: `${nameOf(product)} is no longer offered as of ${shortDate(change.changedAt)} (${read}); ${counted.charAt(0).toLowerCase()}${counted.slice(1)}`,
                data,
              }
            : {
                caseId: plan.caseId,
                kind: 'rate_change',
                productId: change.productId,
                productVersion: version,
                reminderId: null,
                stage: null,
                title: 'A rate in your plan changed',
                body: `${nameOf(product)}: ${pct(change.previousRate ?? 0)} to ${pct(change.currentRate ?? 0)} from ${shortDate(change.effectiveFrom ?? change.changedAt)} (${read}). ${counted}`,
                data,
              },
        )
      }
    }
  }
  return [...drafts.values()]
}

export type ReminderRef = {
  readonly id: string
  readonly caseId: string
  readonly kind: (typeof REMINDER_KINDS)[number]
  readonly label: string
  /** YYYY-MM-DD */
  readonly dueOn: string
}

/** Whole days from `today` to `dueOn`, both YYYY-MM-DD; negative once it has passed. */
export function daysUntil(today: string, dueOn: string): number {
  return Math.round(
    (Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  )
}

/**
 * The reminders due a message today: each at the latest stage it has reached (90, 60, 30, 7
 * days before, or the day), unless that stage was sent. A run missed for a few days still sends
 * the stage once; a reminder set 20 days out starts at the 30-day stage.
 */
export function dueReminders(
  reminders: readonly ReminderRef[],
  today: string,
  alreadySent: (reminderId: string, stage: number) => boolean,
): { reminder: ReminderRef; stage: number; daysLeft: number }[] {
  return reminders.flatMap((reminder) => {
    const daysLeft = daysUntil(today, reminder.dueOn)
    if (daysLeft < 0) return []
    const stage = [...REMINDER_STAGES].sort((a, b) => a - b).find((s) => daysLeft <= s)
    if (stage === undefined || alreadySent(reminder.id, stage)) return []
    return [{ reminder, stage, daysLeft }]
  })
}

/** Lenders listing fixed mortgage rates today and their range, from the market. */
function fixedMortgageLine(market: Market): string | null {
  const fixed = market.products.flatMap((product) =>
    product.terms.kind === 'mortgage' && product.terms.rateType === 'fixed'
      ? [{ provider: product.provider, rate: product.terms.initialRatePct }]
      : [],
  )
  if (fixed.length === 0) return null
  const lenders = new Set(fixed.map((item) => item.provider)).size
  const low = Math.min(...fixed.map((item) => item.rate))
  const high = Math.max(...fixed.map((item) => item.rate))
  return `Today ${String(lenders)} lender${lenders === 1 ? ' lists' : 's list'} fixed mortgage rates ${low === high ? `at ${pct(low)}` : `from ${pct(low)} to ${pct(high)}`}.`
}

/** Fixed-term deposit accounts listed today and the top rate among them. */
function fixedDepositLine(market: Market): string | null {
  const rates = market.products.flatMap((product) =>
    product.terms.kind === 'deposit' && product.terms.access === 'fixed_term'
      ? [Math.max(...product.terms.ladder.map((rung) => rung.aerPct))]
      : [],
  )
  if (rates.length === 0) return null
  return `Today ${String(rates.length)} fixed-term deposit account${rates.length === 1 ? ' is' : 's are'} listed, with rates up to ${pct(Math.max(...rates))}.`
}

/** The alert for a reminder at a stage, with today's market beside the date. */
export function reminderAlert(
  reminder: ReminderRef,
  stage: number,
  daysLeft: number,
  market: Market | null,
): AlertDraft {
  const when = daysLeft === 0 ? 'today' : `in ${String(daysLeft)} day${daysLeft === 1 ? '' : 's'}`
  const title =
    reminder.kind === 'fixed_rate_ends'
      ? `Your fixed rate ends ${when}`
      : reminder.kind === 'deposit_matures'
        ? `Your deposit matures ${when}`
        : `${reminder.label}: ${when}`
  const marketLine =
    market === null
      ? null
      : reminder.kind === 'fixed_rate_ends'
        ? fixedMortgageLine(market)
        : reminder.kind === 'deposit_matures'
          ? fixedDepositLine(market)
          : null
  return {
    caseId: reminder.caseId,
    kind: 'reminder',
    productId: null,
    productVersion: null,
    reminderId: reminder.id,
    stage,
    title,
    body: `On ${shortDate(reminder.dueOn)}, as you told Saoirse.${marketLine === null ? '' : ` ${marketLine}`}`,
    data: { kind: reminder.kind, label: reminder.label, dueOn: reminder.dueOn, daysLeft },
  }
}
