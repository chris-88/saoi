import type { FactReader } from '../journey.ts'
import { syntheticIban } from '../iban.ts'

/**
 * The accounts a stand-in aggregator would return, generated from the case's own facts.
 *
 * Nothing here has seen a bank. When the customer consents to linking, there is no provider
 * to call, so the provider is simulated: one current account and, if they said they have
 * savings, one savings account holding exactly what they said. Ninety days of transactions on
 * the current account say the same things the conversation did: the salary they quoted
 * arrives monthly from the employer they named, the rent they quoted leaves on the first, the
 * amount they said they put away goes to savings after payday, and the rest is the ordinary
 * spending of somebody living in Ireland. Saoirse can then assess from "what it can see" and the
 * figures agree with what it was told, which is the whole point of showing it.
 *
 * Deterministic in `seed`: the same case linking the same bank gets the same statement on
 * every run, so a presenter can rehearse against it. The generator is a small PRNG seeded
 * from the string; `Math.random` would make every rehearsal a different customer.
 */

export const TRANSACTION_CATEGORIES = [
  'income',
  'housing',
  'savings',
  'groceries',
  'transport',
  'utilities',
  'subscriptions',
  'eating_out',
] as const

export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number]

export type AccountRef = 'current' | 'savings'

export type SyntheticAccount = {
  /** Which of the two this is. The database id does not exist until the row is written. */
  readonly ref: AccountRef
  readonly bank: string
  readonly displayName: string
  readonly accountType: AccountRef
  readonly iban: string
  /** Where it stood ninety days ago. The transactions carry it to `balance`, exactly. */
  readonly openingBalance: number
  readonly balance: number
}

export type SyntheticTransaction = {
  readonly account: AccountRef
  readonly bookedOn: string
  /** Negative is money out. */
  readonly amount: number
  readonly description: string
  readonly category: TransactionCategory
}

export type SynthesiseInput = {
  readonly bank: string
  readonly bankName: string
  readonly facts: FactReader
  /** `YYYY-MM-DD`. The last day of the statement. */
  readonly today: string
  readonly seed: string
}

export type SynthesisedAccounts = {
  readonly accounts: readonly SyntheticAccount[]
  /** Oldest first. */
  readonly transactions: readonly SyntheticTransaction[]
}

/** The statement covers this many days, ending today. */
export const HISTORY_DAYS = 90

/** How long a consent runs: the ninety days PSD2 allowed before a renewal, which is the figure the consent card states. */
export const CONSENT_DAYS = 90

/** The day most Irish payrolls land, pulled back to the Friday when it falls on a weekend. */
const PAYDAY = 25

export function synthesiseAccounts(input: SynthesiseInput): SynthesisedAccounts {
  const random = prng(`${input.seed}:${input.bank}`)
  const start = addDays(input.today, -(HISTORY_DAYS - 1))
  const inWindow = (day: string) => day >= start && day <= input.today

  const annual = input.facts.number('income.annualBasic', 'primary')
  const employer = input.facts.get('employment.employerName', 'primary')
  const rent = input.facts.number('expenditure.monthlyRent', 'household')
  const monthlySaving = input.facts.number('goals.monthlySaving', 'household')
  const savingsHeld = input.facts.number('assets.savingsBalance', 'household')

  const net = annual === null ? null : netMonthlyPay(annual)
  const transactions: SyntheticTransaction[] = []
  const add = (
    bookedOn: string,
    amount: number,
    description: string,
    category: TransactionCategory,
  ) => {
    if (!inWindow(bookedOn)) return
    transactions.push({
      account: 'current',
      bookedOn,
      amount: cents(amount),
      description,
      category,
    })
  }

  const months = monthsSpanning(start, input.today)

  // The things they told Saoirse about, on the days such things happen.
  for (const month of months) {
    const payday = businessDayBefore(`${month}-${String(PAYDAY).padStart(2, '0')}`)
    if (net !== null) {
      add(
        payday,
        net,
        typeof employer === 'string' && employer.trim() !== '' ? employer.trim() : 'SALARY',
        'income',
      )
    }
    if (rent !== null && rent > 0) add(`${month}-01`, -rent, 'Rent', 'housing')
    if (monthlySaving !== null && monthlySaving > 0) {
      add(addDays(payday, 1), -monthlySaving, 'Transfer to savings', 'savings')
    }
  }

  // The rest of the month, scaled to what is left after the things above.
  const disposable =
    net === null
      ? 1_500
      : Math.max(600, Math.min(3_500, (net - (rent ?? 0) - (monthlySaving ?? 0)) * 0.7))
  spendOrdinarily(random, start, input.today, months, disposable, add)

  transactions.sort((a, b) => (a.bookedOn < b.bookedOn ? -1 : a.bookedOn > b.bookedOn ? 1 : 0))

  /*
   * The float. A current account ends the period a few hundred to a couple of thousand in
   * credit when the money that came in went out again. When the statement shows more coming
   * in than going out, which is what no rent and no saving habit looks like, the surplus is
   * still in the account, because there is nowhere else it could have gone.
   */
  const movement = transactions.reduce((sum, t) => sum + Math.round(t.amount * 100), 0) / 100
  const float = cents(between(random, 300, 1_500))
  const opening = movement >= 0 ? float : cents(float - movement)

  const accounts: SyntheticAccount[] = [
    {
      ref: 'current',
      bank: input.bank,
      displayName: 'Current Account',
      accountType: 'current',
      iban: syntheticIban(hexFrom(prng(`${input.seed}:${input.bank}:current`))),
      openingBalance: opening,
      balance: cents(opening + movement),
    },
  ]

  if (savingsHeld !== null && savingsHeld > 0) {
    accounts.push({
      ref: 'savings',
      bank: input.bank,
      displayName: 'Savings Account',
      accountType: 'savings',
      iban: syntheticIban(hexFrom(prng(`${input.seed}:${input.bank}:savings`))),
      // No transactions on this one: the balance is what they said, and the monthly transfer
      // leaving the current account is the only movement the statement shows.
      openingBalance: cents(savingsHeld),
      balance: cents(savingsHeld),
    })
  }

  return { accounts, transactions }
}

/**
 * Take-home pay from a gross annual salary, for one month.
 *
 * A plausible Irish take for a single PAYE employee: 20% to the standard rate band and 40%
 * above it, less the personal and employee credits; USC in its four bands; PRSI at the
 * employee rate. It is not a tax calculator and nothing is assessed from it. It exists so the
 * salary credit on a synthetic statement is smaller than the gross figure the customer
 * quoted, by about the amount a payslip would show, rather than the gross figure itself.
 */
export function netMonthlyPay(annualGross: number): number {
  const band = 44_000
  const credits = 4_000
  const incomeTax = Math.max(
    0,
    Math.min(annualGross, band) * 0.2 + Math.max(0, annualGross - band) * 0.4 - credits,
  )
  const usc =
    Math.min(annualGross, 12_012) * 0.005 +
    Math.max(0, Math.min(annualGross, 27_382) - 12_012) * 0.02 +
    Math.max(0, Math.min(annualGross, 70_044) - 27_382) * 0.03 +
    Math.max(0, annualGross - 70_044) * 0.08
  const prsi = annualGross * 0.042
  return cents((annualGross - incomeTax - usc - prsi) / 12)
}

/** An IBAN as a screen shows it: country and the last four, nothing in between. */
export function maskIban(iban: string): string {
  const compact = iban.replace(/\s+/g, '')
  return `${compact.slice(0, 2)} **** ${compact.slice(-4)}`
}

// ---------------------------------------------------------------------------
// Ordinary spending
// ---------------------------------------------------------------------------

type Add = (
  bookedOn: string,
  amount: number,
  description: string,
  category: TransactionCategory,
) => void

const GROCERS = ['Tesco', 'Dunnes Stores', 'SuperValu', 'Lidl', 'Aldi'] as const
const COFFEE_AND_FOOD = [
  'Insomnia Coffee',
  'Butlers Chocolate Cafe',
  'Boojum',
  "Supermac's",
  'Camile Thai',
  'Deliveroo',
  'Bunsen',
  "Eddie Rocket's",
] as const
const ELECTRICITY = ['Electric Ireland', 'Bord Gais Energy', 'SSE Airtricity', 'Energia'] as const
const BROADBAND = ['Eir', 'Vodafone', 'Three', 'Virgin Media'] as const
const FUEL = ['Circle K', 'Applegreen', 'Maxol'] as const

/**
 * Groceries weekly at the shop they favour, transport on whichever footing the seed gives
 * them, the two utility bills and the two subscriptions on their fixed days, and coffee and
 * food out a couple of times a week. The shares are rough and the noise is deliberate: a
 * statement where every grocery shop costs the same is a statement nobody believes.
 */
function spendOrdinarily(
  random: () => number,
  start: string,
  today: string,
  months: readonly string[],
  disposable: number,
  add: Add,
): void {
  const favourite = pick(random, GROCERS)
  const alternative = pick(
    random,
    GROCERS.filter((g) => g !== favourite),
  )
  const electricity = pick(random, ELECTRICITY)
  const broadband = pick(random, BROADBAND)
  const drives = random() < 0.4
  const fuelStation = pick(random, FUEL)
  const electricityDay = 5 + Math.floor(random() * 10)
  const broadbandDay = 15 + Math.floor(random() * 10)
  const spotifyDay = 1 + Math.floor(random() * 28)
  const netflixDay = 1 + Math.floor(random() * 28)

  const weeklyGroceries = (disposable * 0.3) / 4.33
  const weeklyFood = (disposable * 0.12) / 4.33

  for (const month of months) {
    add(`${month}-${pad(electricityDay)}`, -between(random, 85, 165), electricity, 'utilities')
    add(`${month}-${pad(broadbandDay)}`, -between(random, 40, 70), broadband, 'utilities')
    add(`${month}-${pad(spotifyDay)}`, -11.99, 'Spotify', 'subscriptions')
    add(`${month}-${pad(netflixDay)}`, -14.99, 'Netflix', 'subscriptions')
  }

  // Week by week from the first day of the window.
  for (let weekStart = start; weekStart <= today; weekStart = addDays(weekStart, 7)) {
    const mainShop = addDays(weekStart, Math.floor(random() * 7))
    add(mainShop, -weeklyGroceries * between(random, 0.55, 0.95), favourite, 'groceries')
    if (random() < 0.7) {
      add(
        addDays(weekStart, Math.floor(random() * 7)),
        -weeklyGroceries * between(random, 0.15, 0.4),
        alternative,
        'groceries',
      )
    }

    if (drives) {
      if (random() < 0.6)
        add(
          addDays(weekStart, Math.floor(random() * 7)),
          -between(random, 45, 85),
          fuelStation,
          'transport',
        )
    } else {
      add(
        addDays(weekStart, Math.floor(random() * 7)),
        -between(random, 20, 40),
        'Leap Card top-up',
        'transport',
      )
    }

    const outings = 1 + Math.floor(random() * 3)
    for (let i = 0; i < outings; i++) {
      add(
        addDays(weekStart, Math.floor(random() * 7)),
        -(weeklyFood / 2) * between(random, 0.4, 1.4),
        pick(random, COFFEE_AND_FOOD),
        'eating_out',
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Randomness, deterministic
// ---------------------------------------------------------------------------

/** FNV-1a over the seed, then mulberry32. Small, well known, and the same on every runtime. */
export function prng(seed: string): () => number {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  let state = hash >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function between(random: () => number, low: number, high: number): number {
  return low + random() * (high - low)
}

function pick<T>(random: () => number, options: readonly T[]): T {
  const chosen = options[Math.floor(random() * options.length)]
  if (chosen === undefined) throw new Error('Nothing to pick from')
  return chosen
}

/** Thirty-two hex digits from the stream, which is what `syntheticIban` folds into a number. */
function hexFrom(random: () => number): string {
  let hex = ''
  for (let i = 0; i < 32; i++) hex += Math.floor(random() * 16).toString(16)
  return hex
}

function cents(value: number): number {
  return Math.round(value * 100) / 100
}

function pad(day: number): string {
  return String(day).padStart(2, '0')
}

// ---------------------------------------------------------------------------
// Dates, as strings, in UTC, so a statement does not shift by a day with the server's zone
// ---------------------------------------------------------------------------

export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const utc = Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + days)
  return new Date(utc).toISOString().slice(0, 10)
}

/** Every `YYYY-MM` from the month of `start` to the month of `end`, inclusive. */
export function monthsSpanning(start: string, end: string): readonly string[] {
  const months: string[] = []
  let cursor = `${start.slice(0, 7)}-01`
  while (cursor.slice(0, 7) <= end.slice(0, 7)) {
    months.push(cursor.slice(0, 7))
    cursor = addDays(cursor, 32).slice(0, 7) + '-01'
  }
  return months
}

/** The day itself on a weekday, the Friday before it on a weekend. */
function businessDayBefore(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  if (weekday === 6) return addDays(day, -1)
  if (weekday === 0) return addDays(day, -2)
  return day
}
