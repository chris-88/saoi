import type { FactReader } from '../../domain/journey.ts'
import type { KnowledgeProduct } from './kb-types.ts'
import { knowledgeProduct } from './kb-prompt.ts'

/**
 * Which of Demo Bank's current accounts to put in front of somebody.
 *
 * The journey knows an application is `current_account`. The pack holds five accounts an adult
 * can open in their own name, and what separates them is eligibility and a fee: the Personal
 * account has a monthly fee and the other four have none, each for a reason the pack states.
 * Left to the model, the Personal account was offered to everybody, because it is the one the
 * public site leads with, so a graduate starting a first job was shown the account with the fee
 * rather than the one built for them. The pick is made here, from facts, and the model explains
 * it: the same split as everywhere else (Invariant 3, §51).
 *
 * Tenant-side on purpose. These are Demo Bank's own eligibility lines, and the domain does
 * not know this bank has a Golden Years account (Invariant 11).
 *
 * Nothing in `because` is a figure of this file's own. The fee and the eligibility wording are
 * read out of the product each time, so an edited catalogue is explained from what it now says,
 * and an account a presenter has switched off is never picked.
 */

export type CurrentAccountPick = {
  readonly catalogueId: string
  readonly name: string
  /** Why this one, in the pack's own words, and what would change it where a fact is not held. */
  readonly because: string
  /** The current accounts not picked, so the prompt can say "not those". */
  readonly insteadOf: readonly string[]
}

/** The accounts an adult can open in their own name, in the order the rules consider them. */
const CONSIDERED: readonly string[] = [
  'current.golden_years',
  'current.third_level',
  'current.graduate',
  'current.basic',
  'current.personal',
]

/** "66+", the first eligibility line of the Golden Years account in the pack. */
const GOLDEN_YEARS_FROM = 66

/** "Graduated in past 3 years", the pack's window for the Graduate account. */
const GRADUATE_WINDOW_YEARS = 3

/**
 * Statuses that mean a salary, or its equivalent, is coming in.
 *
 * What keeps the Basic Bank Account from being offered as a cheaper Personal account, which the
 * pack says in so many words not to do. Somebody in work with no Irish account yet is a Personal
 * account customer; the Basic account is for somebody the ordinary one would leave without.
 */
const IN_WORK: readonly string[] = [
  'employed_full_time',
  'employed_part_time',
  'self_employed',
  'contract',
]

/** What the rules read, taken off the case once so every rule sees the same facts. */
type Reading = {
  readonly age: number | null
  readonly employment: string | null
  readonly yearsSinceGraduating: number | null
  readonly holdsIrishPaymentAccount: boolean | null
}

type Rule = {
  readonly id: string
  readonly applies: (reading: Reading) => boolean
  readonly because: (
    reading: Reading,
    product: KnowledgeProduct,
    products: readonly KnowledgeProduct[],
  ) => string
}

/** Whole years old on a date, from an ISO date of birth. Null for anything that is not one. */
function ageOn(dateOfBirth: unknown, today: Date): number | null {
  if (typeof dateOfBirth !== 'string') return null
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth)
  if (parts === null) return null

  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])

  const beforeBirthday =
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)
  const age = today.getUTCFullYear() - year - (beforeBirthday ? 1 : 0)

  return Number.isFinite(age) && age >= 0 ? age : null
}

function readingOf(facts: FactReader, today: Date): Reading {
  const employment = facts.get('employment.status', 'primary')
  const graduated = facts.number('education.graduatedYear', 'primary')

  return {
    age: ageOn(facts.get('identity.dateOfBirth', 'primary'), today),
    employment: typeof employment === 'string' ? employment : null,
    yearsSinceGraduating: graduated === null ? null : today.getUTCFullYear() - graduated,
    holdsIrishPaymentAccount: facts.boolean('banking.holdsIrishPaymentAccount', 'primary'),
  }
}

/** The fee as the pack states it. Never a number of this file's own. */
function feeWording(product: KnowledgeProduct): string {
  const monthly = product.pricing_and_rates['maintenance_fee_eur_month']
  if (typeof monthly !== 'number') return 'a maintenance fee the catalogue does not state'
  if (monthly > 0) return `a €${String(monthly)} monthly maintenance fee`

  const period = product.pricing_and_rates['fee_free_period']
  return typeof period === 'string'
    ? `no monthly maintenance fee for the qualifying period (${period})`
    : 'no monthly maintenance fee'
}

/** The pack's own lines for an account: its eligibility, then its fee. */
function inThePacksWords(product: KnowledgeProduct): string {
  return `${product.name}: ${product.eligibility.join('; ')}; ${feeWording(product)}.`
}

function describeYearsAgo(years: number): string {
  if (years === 0) return 'this year'
  if (years === 1) return 'a year ago'
  return `${String(years)} years ago`
}

/**
 * What would move the pick off the default, for each deciding fact the case does not hold.
 *
 * These are the questions worth asking before the account is opened, in the order the rules
 * run. A fact that is held and rules an account out gets no line: there is nothing to ask.
 */
function whatWouldChangeIt(
  reading: Reading,
  products: readonly KnowledgeProduct[],
): readonly string[] {
  const lines: string[] = []

  const goldenYears = knowledgeProduct('current.golden_years', products)
  if (goldenYears !== undefined && reading.age === null) {
    lines.push(
      `if they are ${String(GOLDEN_YEARS_FROM)} or over, the ${goldenYears.name} has ${feeWording(goldenYears)}`,
    )
  }

  const thirdLevel = knowledgeProduct('current.third_level', products)
  if (thirdLevel !== undefined && reading.employment === null) {
    lines.push(
      `if they are a full-time student, the ${thirdLevel.name} has ${feeWording(thirdLevel)}`,
    )
  }

  const graduate = knowledgeProduct('current.graduate', products)
  if (graduate !== undefined && reading.yearsSinceGraduating === null) {
    lines.push(
      `if they graduated in the last ${String(GRADUATE_WINDOW_YEARS)} years, the ${graduate.name} has ${feeWording(graduate)}`,
    )
  }

  const basic = knowledgeProduct('current.basic', products)
  const couldBeBasic =
    reading.holdsIrishPaymentAccount !== true &&
    (reading.employment === null || !IN_WORK.includes(reading.employment))
  if (basic !== undefined && couldBeBasic) {
    lines.push(
      `if this would be their first payment account in Ireland and they are not in work, the ${basic.name} has ${feeWording(basic)}`,
    )
  }

  return lines
}

/** First match wins. The last rule matches everybody, so something is always picked. */
const RULES: readonly Rule[] = [
  {
    id: 'current.golden_years',
    applies: (reading) => reading.age !== null && reading.age >= GOLDEN_YEARS_FROM,
    because: (reading, product) => `They are ${String(reading.age)}. ${inThePacksWords(product)}`,
  },
  {
    id: 'current.third_level',
    applies: (reading) => reading.employment === 'student',
    because: (_reading, product) => `They are a student. ${inThePacksWords(product)}`,
  },
  {
    id: 'current.graduate',
    applies: (reading) =>
      reading.yearsSinceGraduating !== null &&
      reading.yearsSinceGraduating >= 0 &&
      reading.yearsSinceGraduating <= GRADUATE_WINDOW_YEARS,
    because: (reading, product) =>
      `They graduated ${describeYearsAgo(reading.yearsSinceGraduating ?? 0)}, inside the ` +
      `${String(GRADUATE_WINDOW_YEARS)}-year window. ${inThePacksWords(product)}`,
  },
  {
    id: 'current.basic',
    applies: (reading) =>
      reading.holdsIrishPaymentAccount === false &&
      reading.employment !== null &&
      !IN_WORK.includes(reading.employment),
    // The pack's own caution travels with the pick, because it is the one most easily crossed.
    because: (_reading, product) =>
      `This would be their first payment account in Ireland and they are not in work. ` +
      `${inThePacksWords(product)} ${(product.assistant_usage.must_not_say ?? []).join(' ')}`.trim(),
  },
  {
    id: 'current.personal',
    applies: () => true,
    because: (reading, product, products) => {
      const hints = whatWouldChangeIt(reading, products)
      return (
        `Nothing held rules the ${product.name} out. ${inThePacksWords(product)}` +
        (hints.length === 0 ? '' : ` What would change it: ${hints.join('; ')}.`)
      )
    },
  },
]

/**
 * The current account somebody should be offered, from the facts held and the catalogue the
 * turn holds. Null only when the catalogue has none of the five.
 */
export function suitableCurrentAccount(
  facts: FactReader,
  today: Date,
  products: readonly KnowledgeProduct[],
): CurrentAccountPick | null {
  const held = CONSIDERED.filter((id) => knowledgeProduct(id, products) !== undefined)
  const fallback = held[0]
  if (fallback === undefined) return null

  const reading = readingOf(facts, today)

  // The first rule that applies and whose account the catalogue still holds. The Personal
  // account applies to everybody, so this only runs out when a presenter has switched that off
  // as well, and then whatever is left is offered and said to be that.
  const rule = RULES.find((candidate) => candidate.applies(reading) && held.includes(candidate.id))
  const catalogueId = rule?.id ?? fallback
  const product = knowledgeProduct(catalogueId, products)
  if (product === undefined) return null

  const because =
    rule === undefined
      ? `The Personal Current Account is not in this catalogue; the ${product.name} is the ` +
        `current account it still holds.`
      : rule.because(reading, product, products)

  return {
    catalogueId,
    name: product.name,
    because,
    insteadOf: held.filter((id) => id !== catalogueId),
  }
}
