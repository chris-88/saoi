import type {
  DepositRates,
  MarketConditions,
} from '../../supabase/functions/_shared/market/schema.ts'
import { decodeEntities, htmlToLines, linksOf } from './html.ts'

/**
 * Parsers for the Bank of Ireland product pages listed in `BOI_SOURCES`.
 *
 * Each one finds the sentences that state a rate or a limit and reads the numbers out of them.
 * Anything it cannot find is a `ParseError`, never a default: a page that has changed shape
 * must stop the refresh rather than quietly drop a tier or a rate. The sentences matched are
 * the pages' own wording as of 2026-11-09; when Bank of Ireland rewrites one, the refresh fails
 * naming what it could not find, and the pattern here is what to update.
 */

export class ParseError extends Error {
  override readonly name = 'ParseError'
}

export type Parsed = {
  readonly providerProductName: string
  readonly rates: DepositRates
  readonly conditions: MarketConditions
}

export type Parser = (html: string) => Parsed

/** `€2,500` or `2,500` as a number. */
export function euros(text: string): number {
  const value = Number(text.replace(/[€,\s]/g, ''))
  if (!Number.isFinite(value)) throw new ParseError(`not an amount: ${text}`)
  return value
}

function percent(text: string): number {
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) throw new ParseError(`not a rate: ${text}`)
  return value
}

const WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
}

function count(text: string): number {
  const value = WORDS[text.toLowerCase()] ?? Number(text)
  if (!Number.isInteger(value) || value <= 0) throw new ParseError(`not a count: ${text}`)
  return value
}

/** The first line matching, as its capture groups. Throws naming what was looked for. */
function find(lines: readonly string[], pattern: RegExp, what: string): readonly string[] {
  for (const line of lines) {
    const match = pattern.exec(line)
    if (match !== null) return match.slice(1).map((group) => group ?? '')
  }
  throw new ParseError(`could not find ${what}`)
}

function has(lines: readonly string[], pattern: RegExp, what: string): void {
  find(lines, pattern, what)
}

/** Capture group `index`, which the pattern guarantees exists. */
function group(groups: readonly string[], index: number): string {
  const value = groups[index]
  if (value === undefined || value.length === 0) throw new ParseError('pattern lost a group')
  return value
}

/** The product's own name: the page heading, or the title segment that names it. */
export function productName(html: string, token: string): string {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''
  const clean = (text: string) =>
    decodeEntities(text.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()
  const candidates = [
    ...(h1 === undefined ? [] : [clean(h1)]),
    ...clean(title).split(/\s+[|–-]\s+/),
  ]
  const name = candidates.find((candidate) => candidate.includes(token))
  if (name === undefined) throw new ParseError(`the page is not headed ${token}`)
  return name
}

const DASH = '\\s*[–-]\\s*'
const N = '([\\d.]+)'
const EUR = '€([\\d,]+)'

export const supersaver: Parser = (html) => {
  const lines = htmlToLines(html)
  const fixed = find(
    lines,
    new RegExp(`fixed savings rate ${N}% AER.*? for (\\d+) months`, 'i'),
    'the 12-month fixed rate',
  )
  const then = find(
    lines,
    new RegExp(
      `default to the Standard Regular Sav\\w* variable rate \\(currently ${N}% AER\\)`,
      'i',
    ),
    'the rate it reverts to',
  )
  const tier = find(
    lines,
    new RegExp(`reduces to ${N}% AER variable for amounts over ${EUR}`, 'i'),
    'the rate above the balance tier',
  )
  const monthly = find(
    lines,
    new RegExp(`Direct Debit minimum ${EUR}${DASH}maximum ${EUR}`, 'i'),
    'the monthly direct debit limits',
  )
  has(lines, /Lump sum lodgements are not (allowed|permitted)/i, 'the no-lump-sums rule')
  const age = find(lines, /Available to (\d+) years of age and over/i, 'the minimum age')

  return {
    providerProductName: productName(html, 'SuperSaver'),
    rates: {
      kind: 'deposit',
      aerPct: percent(group(fixed, 0)),
      basis: 'fixed',
      fixedMonths: count(group(fixed, 1)),
      thenAerPct: percent(group(then, 0)),
      tierCapEur: euros(group(tier, 1)),
      aboveTierAerPct: percent(group(tier, 0)),
    },
    conditions: {
      takesMonthly: true,
      takesLumpSum: false,
      minMonthlyEur: euros(group(monthly, 0)),
      maxMonthlyEur: euros(group(monthly, 1)),
      minAge: count(group(age, 0)),
    },
  }
}

export const goalsaver: Parser = (html) => {
  const lines = htmlToLines(html)
  const monthly = find(
    lines,
    new RegExp(`Direct Debit${DASH}Minimum ${EUR},? Maximum ${EUR} per month`, 'i'),
    'the monthly direct debit limits',
  )
  has(lines, /Interest rate is variable/i, 'that the rate is variable')
  const lower = find(lines, new RegExp(`^€0${DASH}${EUR} \\| ${N}%$`), 'the first rate tier')
  const upper = find(lines, new RegExp(`^${EUR}\\+ \\| ${N}%$`), 'the rate above the tier')
  has(lines, /Lump sum lodgements are not (allowed|permitted)/i, 'the no-lump-sums rule')
  const age = find(lines, /aged (\d+) years of age or older/i, 'the minimum age')

  const cap = euros(group(upper, 0))
  if (euros(group(lower, 0)) + 1 !== cap) {
    throw new ParseError(`the rate tiers do not meet: ${group(lower, 0)} then ${group(upper, 0)}+`)
  }

  return {
    providerProductName: productName(html, 'GoalSaver'),
    rates: {
      kind: 'deposit',
      aerPct: percent(group(lower, 1)),
      basis: 'variable',
      tierCapEur: cap,
      aboveTierAerPct: percent(group(upper, 1)),
    },
    conditions: {
      takesMonthly: true,
      takesLumpSum: false,
      minMonthlyEur: euros(group(monthly, 0)),
      maxMonthlyEur: euros(group(monthly, 1)),
      minAge: count(group(age, 0)),
    },
  }
}

export const mortgagesaver: Parser = (html) => {
  const lines = htmlToLines(html)
  const regular = find(
    lines,
    new RegExp(
      `pays ${N}% Annual Equivalent Rate \\(AER\\) variable on the money you add regularly by direct debit, up to ${EUR}`,
      'i',
    ),
    'the rate on regular saving',
  )
  const above = find(
    lines,
    new RegExp(`separate balance that earns ${N}% AER`, 'i'),
    'the rate above the tier',
  )
  const lump = find(
    lines,
    new RegExp(`lump sum payments at ${N}% AER variable, up to a total value of ${EUR}`, 'i'),
    'the lump-sum rate and limit',
  )
  const monthly = find(
    lines,
    new RegExp(`Save between ${EUR} and ${EUR} a month by direct debit`, 'i'),
    'the monthly direct debit limits',
  )
  const bonus = find(
    lines,
    new RegExp(`${EUR} bonus interest \\(less DIRT\\)`, 'i'),
    'the bonus amount',
  )
  const qualify = find(
    lines,
    new RegExp(
      `Save between ${EUR} and ${EUR} each month for at least (\\w+) months in a row and reach at least ${EUR}`,
      'i',
    ),
    'the bonus saving conditions',
  )
  const within = find(
    lines,
    /Draw down a Bank of Ireland first-time buyer mortgage within (\d+) months/i,
    'the bonus drawdown window',
  )
  has(lines, /Be a first-time buyer/i, 'the first-time-buyer condition')
  const age = find(lines, /Aged (\d+) or over/i, 'the minimum age')

  return {
    providerProductName: productName(html, 'MortgageSaver'),
    rates: {
      kind: 'deposit',
      aerPct: percent(group(regular, 0)),
      basis: 'variable',
      tierCapEur: euros(group(regular, 1)),
      aboveTierAerPct: percent(group(above, 0)),
      lumpSumAerPct: percent(group(lump, 0)),
    },
    conditions: {
      takesMonthly: true,
      takesLumpSum: true,
      minMonthlyEur: euros(group(monthly, 0)),
      maxMonthlyEur: euros(group(monthly, 1)),
      maxLumpSumEur: euros(group(lump, 1)),
      minAge: count(group(age, 0)),
      bonus: {
        amountEur: euros(group(bonus, 0)),
        lessDirt: true,
        firstTimeBuyerOnly: true,
        requiresMortgageHere: true,
        minMonthlyEur: euros(group(qualify, 0)),
        minMonths: count(group(qualify, 2)),
        minTotalEur: euros(group(qualify, 3)),
        withinMonths: count(group(within, 0)),
      },
    },
  }
}

export const instantAccess: Parser = (html) => {
  const lines = htmlToLines(html)
  const rate = find(
    lines,
    new RegExp(`variable interest rate of ${N}% AER`, 'i'),
    'the variable rate',
  )
  const minimum = find(
    lines,
    new RegExp(`Minimum lodgement ${EUR}, no maximum`, 'i'),
    'the lodgement limits',
  )

  return {
    providerProductName: productName(html, 'Instant Access'),
    rates: { kind: 'deposit', aerPct: percent(group(rate, 0)), basis: 'variable' },
    conditions: {
      takesMonthly: true,
      takesLumpSum: true,
      minLumpSumEur: euros(group(minimum, 0)),
    },
  }
}

export const notice31: Parser = (html) => {
  const lines = htmlToLines(html)
  const rate = find(lines, new RegExp(`Interest rate of ${N}%\\s*is variable`, 'i'), 'the rate')
  const minimum = find(
    lines,
    new RegExp(`Minimum lodgement of ${EUR}, no maximum`, 'i'),
    'the lodgement limits',
  )
  has(lines, /Single lodgement only/i, 'the single-lodgement rule')
  has(lines, /giving 31 days notice/i, 'the 31-day notice period')
  const age = find(lines, /aged (\d+) years of age or older/i, 'the minimum age')

  return {
    providerProductName: productName(html, '31 Day Notice'),
    rates: { kind: 'deposit', aerPct: percent(group(rate, 0)), basis: 'variable' },
    conditions: {
      takesMonthly: false,
      takesLumpSum: true,
      minLumpSumEur: euros(group(minimum, 0)),
      minAge: count(group(age, 0)),
    },
  }
}

export const advantageFixed: Parser = (html) => {
  const lines = htmlToLines(html)
  const available = find(lines, /Term\(s\) available: ([\d, and]+) Months/i, 'the terms available')
  const offered = group(available, 0)
    .split(/,|and/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .map(count)

  const terms = lines.flatMap((line) => {
    const row = new RegExp(`^(\\d+) Months?[^|]*\\| ${N}% \\| ${N}%$`, 'i').exec(line)
    if (row === null) return []
    return [
      {
        months: count(group(row.slice(1), 0)),
        termReturnPct: percent(group(row.slice(1), 1)),
        aerPct: percent(group(row.slice(1), 2)),
      },
    ]
  })

  const found = terms.map((term) => term.months)
  if (found.length === 0 || found.join(',') !== offered.join(',')) {
    throw new ParseError(
      `the rate table has terms [${found.join(', ')}] but the page offers [${offered.join(', ')}]`,
    )
  }

  const minimum = find(
    lines,
    new RegExp(`Minimum lodgement ${EUR}, no maximum`, 'i'),
    'the lodgement limits',
  )
  has(lines, /Single lodgement only/i, 'the single-lodgement rule')

  return {
    providerProductName: productName(html, 'Advantage'),
    rates: { kind: 'deposit', aerPct: null, basis: 'fixed', terms },
    conditions: {
      takesMonthly: false,
      takesLumpSum: true,
      minLumpSumEur: euros(group(minimum, 0)),
    },
  }
}

export const BOI_PARSERS: Readonly<Record<string, Parser>> = {
  'savings.supersaver': supersaver,
  'savings.goalsaver': goalsaver,
  'savings.mortgagesaver': mortgagesaver,
  'savings.instant_access': instantAccess,
  'savings.notice_31_day': notice31,
  'savings.advantage_fixed': advantageFixed,
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/**
 * The rate sheet the deposit-rates page links to, and the date in its file name
 * (`Deposit-Interest-Rates-Table-22nd-October-2026-A.pdf`). The PDF itself is not fetched:
 * robots.txt disallows PDFs. The date is a signal that rates moved, nothing more.
 */
export function rateSheetOf(html: string): { url: string; asOf: string | null } | null {
  const url = linksOf(html).find((link) => /Deposit-Interest-Rates-Table/i.test(link))
  if (url === undefined) return null
  const date = /Rates-Table-(\d{1,2})(?:st|nd|rd|th)?-([a-z]+)-(\d{4})/i.exec(url)
  const month = date === null ? -1 : MONTHS.indexOf((date[2] ?? '').toLowerCase())
  if (date === null || month < 0) return { url, asOf: null }
  const day = (date[1] ?? '').padStart(2, '0')
  return { url, asOf: `${date[3] ?? ''}-${String(month + 1).padStart(2, '0')}-${day}` }
}
