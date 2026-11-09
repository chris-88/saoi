import { bunqSnapshot } from '../../supabase/functions/_shared/market/bunq.snapshot.ts'
import { ParseError, type Parsed, type Parser } from './boi.ts'
import { htmlToLines } from './html.ts'
import type { MarketProvider, ProviderSource } from './provider.ts'

/**
 * bunq's savings account, read from bunq's own page.
 *
 * CCPC lists it as "bunq Free", 3.11% variable, with no cap and nothing after. bunq's page says
 * otherwise: 3.11% is a bonus on every euro only until the next 1 January or 1 July; from then
 * a threshold is set at the highest balance of the past six months, the balance up to it earns
 * base interest (1.61% on the first €10,000 of that part, 1.51% on the rest) and only the part
 * above it keeps 3.11%. A steady balance therefore earns the base rate after the first reset,
 * and the CCPC figure overstates it. The rule is stored as data (`rates.thresholdBonus`) and the
 * engine models it month by month.
 *
 * CCPC lists the account twice (savings and deposits), so it is read into two rows from the
 * one page, each paired with its CCPC twin in `_shared/market/bank-ccpc-pairs.ts`. Every
 * sentence matched is the page's own wording as of 2026-11-09; a rewrite fails the refresh
 * naming what it could not find.
 */

export const BUNQ_ORIGIN = 'https://www.bunq.com'
export const BUNQ_SAVINGS_PAGE = `${BUNQ_ORIGIN}/en-ie/personal/features/savings-accounts`

const NAME = 'bunq Savings Account'

const rate = (text: string | undefined, what: string): number => {
  const value = Number(text)
  if (text === undefined || !Number.isFinite(value) || value <= 0) {
    throw new ParseError(`bunq: no ${what}`)
  }
  return value
}

const MONTHS: Readonly<Record<string, number>> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
}

const NUMBERS: Readonly<Record<string, number>> = { three: 3, six: 6, twelve: 12 }

export const savingsAccount: Parser = (html: string): Parsed => {
  const text = htmlToLines(html).join('\n')
  const find = (pattern: RegExp, what: string): RegExpExecArray => {
    const match = pattern.exec(text)
    if (match === null) throw new ParseError(`bunq: could not find ${what}`)
    return match
  }

  const bonus = find(
    /From your first deposit until the following (\w+) 1 or (\w+) 1, all your savings earn (\d+(?:\.\d+)?)% Bonus Interest/i,
    'the bonus period',
  )
  const resetMonths = [bonus[1], bonus[2]].map((name) => {
    const month = MONTHS[(name ?? '').toLowerCase()]
    if (month === undefined) throw new ParseError(`bunq: not a month: ${String(name)}`)
    return month
  })
  const bonusAerPct = rate(bonus[3], 'bonus rate')

  const lookback = find(
    /threshold is determined by taking the highest balance of the past (\d+|\w+) months/i,
    'the threshold rule',
  )
  const lookbackMonths = Number(lookback[1]) || NUMBERS[(lookback[1] ?? '').toLowerCase()]
  if (lookbackMonths === undefined || !Number.isFinite(lookbackMonths)) {
    throw new ParseError(`bunq: not a period: ${String(lookback[1])}`)
  }

  const base = find(
    /up to this threshold earns the base rate of (\d+(?:\.\d+)?)% on the first €([\d,]+) of that part and (\d+(?:\.\d+)?)% on the rest/i,
    'the base rates',
  )
  const firstBand = Number((base[2] ?? '').replace(/,/g, ''))
  if (!Number.isFinite(firstBand) || firstBand <= 0) throw new ParseError('bunq: no base band')
  const above = find(
    /The part above the threshold earns (\d+(?:\.\d+)?)%/i,
    'the rate above the threshold',
  )
  if (rate(above[1], 'rate above the threshold') !== bonusAerPct) {
    throw new ParseError('bunq: the rate above the threshold is not the bonus rate')
  }

  const weekly = /Interest is paid weekly/i.test(text)
  const guarantee = find(
    /Your deposits are covered by the (\w+) Deposit Guarantee Scheme\./i,
    'the deposit guarantee',
  )
  find(/move money in and out when you need it/i, 'instant access')

  return {
    providerProductName: NAME,
    rates: {
      kind: 'deposit',
      aerPct: bonusAerPct,
      basis: 'variable',
      noticeDays: 0,
      thresholdBonus: {
        bonusAerPct,
        resetMonths,
        lookbackMonths,
        baseTiers: [
          { minEur: 0, maxEur: firstBand, aerPct: rate(base[1], 'first base rate') },
          { minEur: firstBand, maxEur: null, aerPct: rate(base[3], 'second base rate') },
        ],
      },
    },
    conditions: {
      takesLumpSum: true,
      takesMonthly: true,
      ...(weekly ? { interestPaid: 'weekly' as const } : {}),
      prose: {
        'Bonus interest': bonus[0],
        Threshold: lookback[0],
        'Base interest': base[0],
        'Deposit guarantee': guarantee[0],
        ...(weekly ? { Interest: 'Interest is paid weekly.' } : {}),
      },
    },
  }
}

export const BUNQ_SOURCES: readonly ProviderSource[] = [
  {
    productId: 'savings.bunq_savings',
    category: 'savings',
    url: BUNQ_SAVINGS_PAGE,
    parse: savingsAccount,
  },
  {
    productId: 'deposit.bunq_savings',
    category: 'deposit',
    url: BUNQ_SAVINGS_PAGE,
    parse: savingsAccount,
  },
]

export const bunqProvider: MarketProvider = {
  provider: 'bunq',
  origin: BUNQ_ORIGIN,
  sources: BUNQ_SOURCES,
  snapshot: bunqSnapshot,
}
