import { mocoSnapshot } from '../../supabase/functions/_shared/market/moco.snapshot.ts'
import { ParseError, type Parsed, type Parser } from './boi.ts'
import { htmlToLines } from './html.ts'
import type { MarketProvider, ProviderSource } from './provider.ts'

/**
 * MoCo's EasySaver, read from MoCo's own pages (the savings page and its FAQ).
 *
 * CCPC lists it twice (savings and deposits) at 2.1% variable, and nothing about who can open
 * it. MoCo's pages confirm the rate is variable with no introductory period, bonus or cap, and
 * add what CCPC leaves out: 2.1% is the rate for new accounts (existing accounts' rate is shown
 * only after login), the holder must be over 18, resident in Ireland, not a US citizen and an
 * individual, there are no joint accounts, interest is daily, and money goes in by transfer or
 * by a standing order set up at the other bank (MoCo takes no direct debits or standing orders
 * itself). Every sentence matched is the pages' own wording as of 2026-11-09; a rewrite fails
 * the refresh naming what it could not find.
 */

export const MOCO_ORIGIN = 'https://www.moco.ie'
export const MOCO_SAVINGS_PAGE = `${MOCO_ORIGIN}/moco/savings`
export const MOCO_SAVINGS_FAQ = `${MOCO_ORIGIN}/moco/savings/faq`

const NAME = 'MoCo EasySaver'

const rate = (text: string | undefined, what: string): number => {
  const value = Number(text)
  if (text === undefined || !Number.isFinite(value) || value <= 0) {
    throw new ParseError(`moco: no ${what}`)
  }
  return value
}

export const easySaver: Parser = (html: string): Parsed => {
  // Curly and straight apostrophes both appear on the pages.
  const text = htmlToLines(html).join('\n').replace(/[‘’]/g, "'")
  const find = (pattern: RegExp, what: string): RegExpExecArray => {
    const match = pattern.exec(text)
    if (match === null) throw new ParseError(`moco: could not find ${what}`)
    return match
  }

  const current = find(/MoCo's current variable rate is (\d+(?:\.\d+)?)% AER/i, 'the variable rate')
  const aerPct = rate(current[1], 'variable rate')
  const forNew = find(
    /For new accounts, MoCo's current variable rate is (\d+(?:\.\d+)?)% AER/i,
    'the rate for new accounts',
  )
  if (rate(forNew[1], 'rate for new accounts') !== aerPct) {
    throw new ParseError('moco: the savings page and the FAQ state different rates')
  }
  const existing = find(
    /The current rate of interest payable on existing savings accounts can be found here/i,
    'where existing accounts’ rate is published',
  )

  const minimum = find(/The current minimum savings amount is €(\d+(?:,\d{3})*)/i, 'the minimum')
  const minLumpSumEur = Number((minimum[1] ?? '').replace(/,/g, ''))
  if (!Number.isFinite(minLumpSumEur) || minLumpSumEur <= 0) {
    throw new ParseError('moco: not an amount for the minimum')
  }

  const access = find(
    /easy access account meaning that you can withdraw your money at any time/i,
    'instant access',
  )
  const who = find(
    /You need to be over (\d+) years old, resident in (\w+) and not be a citizen of the United States\./i,
    'who can open it',
  )
  const minAge = Number(who[1])
  if (!Number.isInteger(minAge) || minAge <= 0) throw new ParseError('moco: no minimum age')
  const individuals = find(
    /only facilitate the opening of a savings account by natural persons/i,
    'individuals only',
  )
  const joint = find(
    /We are unable to facilitate the opening of joint savings accounts\./i,
    'joint',
  )
  const standingOrder = find(
    /A standing order facility can be arranged with the bank from which you wish to transfer money to MoCo\./i,
    'how monthly saving is paid in',
  )
  const daily = find(/Daily Interest/i, 'daily interest')
  const dirt = find(
    /we are obliged to deduct deposit interest retention tax \(DIRT\) from interest earned/i,
    'DIRT taken at source',
  )
  const guarantee = find(
    /guaranteed up to €100,000 by the Austrian Government pursuant to the Austrian Deposit Guarantee Scheme/i,
    'the deposit guarantee',
  )

  return {
    providerProductName: NAME,
    rates: { kind: 'deposit', aerPct, basis: 'variable', noticeDays: 0 },
    conditions: {
      takesLumpSum: true,
      takesMonthly: true,
      minLumpSumEur,
      minMonthlyEur: minLumpSumEur,
      minAge,
      eligibility: {
        residentIn: who[2] ?? 'Ireland',
        notForUsCitizens: true,
        individualsOnly: true,
        jointAccounts: false,
      },
      interestPaid: 'daily',
      rateForNewAccounts: true,
      dirtAtSource: true,
      prose: {
        Rate: current[0],
        'Rate for new accounts': forNew[0],
        'Existing accounts': `${existing[0]} (behind the MoCo Savings Hub login).`,
        Minimum: minimum[0],
        Access: access[0],
        'Who can open it': who[0],
        Individuals: individuals[0],
        'Joint accounts': joint[0],
        'Monthly saving': standingOrder[0],
        Interest: daily[0],
        DIRT: dirt[0],
        'Deposit guarantee': guarantee[0],
      },
    },
  }
}

export const MOCO_SOURCES: readonly ProviderSource[] = [
  {
    productId: 'savings.moco_easysaver',
    category: 'savings',
    url: MOCO_SAVINGS_PAGE,
    alsoRead: [MOCO_SAVINGS_FAQ],
    parse: easySaver,
  },
  {
    productId: 'deposit.moco_easysaver',
    category: 'deposit',
    url: MOCO_SAVINGS_PAGE,
    alsoRead: [MOCO_SAVINGS_FAQ],
    parse: easySaver,
  },
]

export const mocoProvider: MarketProvider = {
  provider: 'moco',
  origin: MOCO_ORIGIN,
  sources: MOCO_SOURCES,
  snapshot: mocoSnapshot,
}
