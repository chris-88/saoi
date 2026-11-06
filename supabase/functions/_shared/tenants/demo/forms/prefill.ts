import type { FactKey } from '../../../domain/facts.ts'
import type { FormDefinition, FormField } from '../../../domain/forms/definition.ts'
import { resolveFormState } from '../../../domain/forms/state.ts'
import type { Answers } from '../../../domain/forms/logic.ts'

/**
 * What Saoirse already knows, expressed in the form platform's own vocabulary.
 *
 * Keyed on `toscana` rather than on field id. The ids are internal to one revision of one
 * form; the toscana names are the bank's own semantic mapping, they read the same in every
 * form that collects the same thing, and they survive a revision that renumbers fields. A
 * SuperSaver first name and a current-account first name are both `Applicant_1_First_Name`,
 * so this table serves whatever journey comes next without being rewritten.
 *
 * The point of the exercise is that a customer is never asked for something Saoirse is already
 * holding. The form has 79 required fields active before anything is answered; the measure of
 * success is how few of them reach the customer as a question.
 */

/**
 * Where a fact lands, said in the form's own terms.
 *
 * By `toscana` wherever the field carries one, because that name survives a revision that
 * renumbers fields. By `fieldId` where it does not: the loan's two duration controls, time at
 * this address and time in this role, have no toscana at all, and a mapping that could only be
 * expressed one way could not reach them.
 */
export type Destination = { readonly toscana: string } | { readonly fieldId: string }

/**
 * How a fact's value becomes the form's, where the shapes differ.
 *
 * A full name is one fact and two fields; an address is one fact and four; a duration is one
 * fact and a control with three sub-inputs. Written here rather than in the conversation,
 * because the shape a form wants is the form's problem.
 */
export type Reshape =
  | 'firstName'
  | 'surname'
  | 'addressLine1'
  | 'addressLine2'
  | 'county'
  | 'houseNumber'
  /** A count of years becomes `{ years, months }` for a duration control. */
  | 'yearsAsDuration'
  /** A start date becomes the `{ years, months }` since it. */
  | 'durationSince'
  /** An amount becomes yes or no: held and above zero, or held and zero. */
  | 'heldAmountAsYesNo'

export type Prefill = Destination & {
  /** Which fact answers it. */
  readonly fact: FactKey
  readonly take?: Reshape
  /**
   * Saoirse's vocabulary translated into the form's, value by value.
   *
   * The two are not the same and must not be assumed to be: Saoirse records a tenure of
   * `owner_occupier` where the loan form wants `home`, and `renting` where it wants `tenant`.
   * A value with no entry here is not mapped and the customer is asked, which is the only safe
   * answer for the cases where the vocabularies genuinely do not line up. Saoirse knows somebody is
   * employed full time; the loan form wants to know whether that is public sector or private,
   * and nothing in the fact says.
   */
  readonly values?: Readonly<Record<string, string>>
}

/**
 * Deliberately conservative.
 *
 * Several near-matches are left out because a near-match on a bank form is worse than a
 * question. `identity.nationality` is not country of birth and is not country of citizenship,
 * however close they look in a field list, and a prefilled wrong answer on a real application
 * is exactly the failure this whole architecture exists to avoid. If Saoirse does not hold the
 * thing itself, it asks.
 */
export const SUPERSAVER_PREFILL: readonly Prefill[] = [
  { toscana: 'Applicant_1_First_Name', fact: 'identity.fullName', take: 'firstName' },
  { toscana: 'Applicant_1_Surname', fact: 'identity.fullName', take: 'surname' },
  { toscana: 'Applicant_1_Date_Of_Birth', fact: 'identity.dateOfBirth' },
  { toscana: 'Applicant_1_Email_Address', fact: 'identity.email' },
  { toscana: 'Applicant_1_Mobile_Phone_No', fact: 'identity.mobile' },
  { toscana: 'Applicant_1_Pps_Number', fact: 'identity.ppsn' },
  { toscana: 'Applicant_1_Address_House_Number', fact: 'identity.address', take: 'houseNumber' },
  { toscana: 'Applicant_1_Address_Line_1', fact: 'identity.address', take: 'addressLine1' },
  { toscana: 'Applicant_1_Address_Line_2', fact: 'identity.address', take: 'addressLine2' },
  { toscana: 'Applicant_1_Address_County', fact: 'identity.address', take: 'county' },
  { toscana: 'Applicant_1_Employment_Status', fact: 'employment.status' },
  { toscana: 'Applicant_1_Employer_Name', fact: 'employment.employerName' },
  { toscana: 'Applicant_1_Occupation', fact: 'employment.occupation' },
  { toscana: 'Direct_Debit_Amount', fact: 'goals.monthlySaving' },
]

/**
 * The personal loan, form 1940.
 *
 * A separate table from SuperSaver's, and it has to be. The two forms share almost no
 * vocabulary: 120 toscana names here, 154 there, and two in common. This form calls a first
 * name `Ignore_First_Name` where SuperSaver calls it `Applicant_1_First_Name`, and a PPS
 * number `PPSN` where SuperSaver says `Applicant_1_Pps_Number`. What carries across products
 * is the Saoirse fact, which is the whole point: `identity.fullName` is asked once in a lifetime
 * and every form adapts to it.
 *
 * What is deliberately absent matters as much as what is here.
 *
 * Net monthly income is not derived from annual basic salary. The gap between them is tax,
 * PRSI, USC and pension, none of which Saoirse knows, and an estimate would be a made-up number on
 * a credit application.
 *
 * Employment status translates only for self-employed and retired. Saoirse knows somebody is
 * employed full time; this form wants to know whether that is public sector or private, and
 * nothing in the fact says which.
 *
 * Marital status translates every value but `separated`, which this form does not offer.
 * Divorced is not separated and the two are not interchangeable on a lending application.
 *
 * Country of birth and country of citizenship stay unmapped, as they do for SuperSaver: a
 * nationality is neither of them, however close the field list makes them look.
 */
export const LOAN_PREFILL: readonly Prefill[] = [
  { toscana: 'Ignore_First_Name', fact: 'identity.fullName', take: 'firstName' },
  { toscana: 'Ignore_Surname', fact: 'identity.fullName', take: 'surname' },
  { toscana: 'Email', fact: 'identity.email' },
  { toscana: 'Threesixfive_User_Id', fact: 'identity.mobile' },
  { toscana: 'PPSN', fact: 'identity.ppsn' },
  {
    toscana: 'Marital_Status',
    fact: 'identity.maritalStatus',
    values: {
      single: 'single',
      married: 'married',
      civil_partnership: 'civil-partnership',
      divorced: 'divorced',
      widowed: 'widowed',
    },
  },
  // No toscana on either duration control, so these are addressed by field id.
  { fieldId: '443', fact: 'identity.yearsAtAddress', take: 'yearsAsDuration' },
  { fieldId: '444', fact: 'employment.startDate', take: 'durationSince' },
  { toscana: 'No_of_Dependents', fact: 'household.dependantCount' },
  {
    toscana: 'Employment_Status',
    fact: 'employment.status',
    values: { self_employed: 'Self Employed', retired: 'Retired' },
  },
  { toscana: 'Occupation', fact: 'employment.occupation' },
  { toscana: 'Employer_Name', fact: 'employment.employerName' },
  { toscana: 'Net_Monthly_Income', fact: 'income.netMonthly' },
  // 85 is the mortgage payment and 86 the rent; they sit on different living arrangements.
  { toscana: 'Rental_Payments', fact: 'expenditure.monthlyRent' },
  { toscana: 'Credit_Card_Outstanding_Bal', fact: 'liabilities.creditCardBalance' },
  { toscana: 'Other_Monthly_Loan_Repayments', fact: 'liabilities.monthlyLoanRepayments' },
  { toscana: 'Savings', fact: 'assets.savingsBalance', take: 'heldAmountAsYesNo' },
  { toscana: 'Total_Savings_Amount', fact: 'assets.savingsBalance' },
  {
    toscana: 'Residential_Status',
    fact: 'housing.currentTenure',
    values: { renting: 'tenant', living_with_family: 'parents', owner_occupier: 'home' },
  },
  {
    toscana: 'Salary_Demo_Account',
    fact: 'banking.salaryPaidTo',
    values: { this_bank: 'Yes', another_bank: 'No' },
  },
  { toscana: 'Loan_Amount', fact: 'borrowing.requestedAmount' },
  { toscana: 'Term_Of_Loan', fact: 'borrowing.repaymentMonths' },
  { toscana: 'Purpose_Of_Loan', fact: 'borrowing.purpose' },
]

/** Split a single stated name into the two fields the form wants. */
export function namePart(fullName: string, part: 'firstName' | 'surname'): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (part === 'firstName') return words[0] ?? ''
  // Everything after the first word, so double-barrelled surnames survive.
  return words.slice(1).join(' ')
}

/**
 * Pull one part out of a stated address.
 *
 * Addresses arrive as one line of free text because that is how people say them. This is a
 * best effort at the shape a form wants, and anything it cannot find is left for Saoirse to ask
 * rather than guessed at.
 */
export function addressPart(
  address: string,
  part: 'houseNumber' | 'addressLine1' | 'addressLine2' | 'county',
): string {
  const parts = address
    .split(',')
    .map((piece) => piece.trim())
    .filter(Boolean)
  if (parts.length === 0) return ''

  if (part === 'county') {
    const last = parts.at(-1) ?? ''
    // "Co. Dublin" and "Dublin 9" are both the county, said differently.
    return /^(co\.?\s+)?[A-Za-z ]+\s*\d*$/.test(last) ? last.replace(/^co\.?\s+/i, '') : ''
  }

  const first = parts[0] ?? ''
  if (part === 'houseNumber') {
    const match = /^(\d+[A-Za-z]?)\b/.exec(first)
    return match?.[1] ?? ''
  }
  if (part === 'addressLine1') {
    return first.replace(/^\d+[A-Za-z]?\s*/, '')
  }
  return parts.length > 2 ? (parts[1] ?? '') : ''
}

export type Resolved = {
  /** Keyed by the definition's own field ids, which is what a packet is built from. */
  readonly answers: Readonly<Record<string, unknown>>
  /** Field ids whose value came from something Saoirse already held. */
  readonly reused: readonly string[]
  /**
   * Mappings that found nothing, by their toscana name.
   *
   * Kept rather than discarded because this is the list of questions the customer still has to
   * be asked, and the console shows it: the claim is about how few questions are left, which
   * means being able to see which ones they are.
   */
  readonly unresolved: readonly string[]
}

/**
 * Turns what Saoirse holds into answers against one form definition.
 *
 * `held` is the case's facts. `reused` decides whether a value counts towards the questions
 * avoided: a fact stated while applying for this very form was asked for, so it does not,
 * while one carried over from an earlier application or from the bank's own record does.
 *
 * Nothing is guessed. A fact that is absent, blank, or whose requested part is not in it (a
 * one-word name has no surname) leaves the field unanswered and the customer asked.
 */
export function resolvePrefill(args: {
  readonly definition: FormDefinition
  readonly prefill: readonly Prefill[]
  readonly held: (key: FactKey) => unknown
  readonly reused: (key: FactKey) => boolean
  /**
   * Which fields are live on this customer's branch.
   *
   * Required, because a name is not unique within a form. `Loan_Amount` is carried by five
   * fields of the loan definition, one for a new loan, one for a top-up and three for other
   * product branches, and `Residential_Status` by three. Taking any one of them, or the last
   * one the map happened to keep, puts the amount somebody asked to borrow onto a field their
   * journey never reaches: the packet then says they want nothing. Resolving against the live
   * branch picks the right one by construction, and where the form genuinely carries the same
   * thing twice on one branch, both are filled.
   */
  readonly active: ReadonlySet<string>
}): Resolved {
  const byToscana = new Map<string, string[]>()
  for (const field of args.definition.fields) {
    if (typeof field.toscana !== 'string' || field.toscana.length === 0) continue
    byToscana.set(field.toscana, [...(byToscana.get(field.toscana) ?? []), field.id])
  }
  const byId = new Map(args.definition.fields.map((field) => [field.id, field]))

  const answers: Record<string, unknown> = {}
  const reused: string[] = []
  const unresolved: string[] = []

  for (const mapping of args.prefill) {
    const named = 'toscana' in mapping ? mapping.toscana : mapping.fieldId
    const candidates =
      'toscana' in mapping ? (byToscana.get(mapping.toscana) ?? []) : [mapping.fieldId]

    const destinations = chooseDestinations(candidates, byId, args.active)

    // Either this revision does not have the field, or the customer's branch does not reach it.
    if (destinations.length === 0) {
      unresolved.push(named)
      continue
    }

    const shaped = valueFor(args.held(mapping.fact), mapping.take)
    if (shaped === undefined) {
      unresolved.push(named)
      continue
    }

    const translated = translate(shaped, mapping.values)
    if (translated === undefined) {
      unresolved.push(named)
      continue
    }

    let filled = false
    for (const fieldId of destinations) {
      const value = withinChoices(translated, byId.get(fieldId))
      if (value === undefined) continue
      answers[fieldId] = value
      if (args.reused(mapping.fact)) reused.push(fieldId)
      filled = true
    }

    if (!filled) unresolved.push(named)
  }

  return { answers, reused, unresolved }
}

/**
 * Fill what Saoirse holds, then fill again against the branch that opens as a result.
 *
 * One pass is not enough. The purpose of the loan decides which amount field exists, so a
 * customer whose purpose Saoirse already knows has a loan-amount field that only appears once the
 * purpose is filled in. Settling after each pass and stopping when nothing new lands is the
 * same shape as the engine's own state resolution, for the same reason.
 */
export function fillFromFacts(args: {
  readonly definition: FormDefinition
  readonly prefill: readonly Prefill[]
  readonly held: (key: FactKey) => unknown
  readonly reused: (key: FactKey) => boolean
  /**
   * What the application already holds.
   *
   * A wizard opens as it is answered, so a fill that starts from nothing can only reach the
   * questions that are live before anybody has said anything. Starting from what has been
   * collected is what lets the second turn of a conversation fill the fields the first turn
   * unlocked.
   */
  readonly answers?: Answers
}): Resolved {
  let answers: Record<string, unknown> = { ...(args.answers ?? {}) }
  const filled: Record<string, unknown> = {}
  const reused = new Set<string>()
  let unresolved: readonly string[] = []

  for (let pass = 0; pass < 4; pass += 1) {
    const state = resolveFormState(args.definition, answers)
    const active = new Set(state.active.map((field) => field.id))

    const next = resolvePrefill({ ...args, active })
    unresolved = next.unresolved

    const before = Object.keys(filled).length
    for (const [fieldId, value] of Object.entries(next.answers)) filled[fieldId] = value
    for (const fieldId of next.reused) reused.add(fieldId)
    answers = { ...answers, ...next.answers }

    if (Object.keys(filled).length === before) break
  }

  return { answers: filled, reused: [...reused], unresolved }
}

/**
 * A value a choice field actually offers, or nothing.
 *
 * Several facts are free text where the form is a list. Occupation is the plain case: Saoirse
 * records whatever somebody calls their job and this form offers a fixed list of about two
 * hundred, so "Consultant" is an answer and "Software engineer" is a question. Matched without
 * regard to case, and what goes in the packet is the form's own spelling of it, because the
 * platform compares values and not labels.
 *
 * A field with no choices takes the value as it is.
 */
function withinChoices(value: unknown, field: FormField | undefined): unknown {
  const choices = field?.choices
  if (!choices || choices.length === 0) return value
  if (typeof value !== 'string') return undefined

  const wanted = value.trim().toLowerCase()
  const match = choices.find(
    (choice) =>
      choice.value.toLowerCase() === wanted || choice.text.trim().toLowerCase() === wanted,
  )
  return match?.value
}

/**
 * Which of the fields carrying a name this answer belongs on.
 *
 * Live ones only, and never a hidden one: a hidden field holds platform state, it carries its
 * own default, and the online banking user id has a hidden mirror that the real journey leaves empty. Of
 * what is left, the required ones win where there are any. The loan form keeps a disused copy
 * of the purpose question, labelled "DELETE NOT IN USE" and marked optional, beside the real
 * one; filling both put an answer in the packet that the genuine submission does not carry.
 *
 * Where several required fields carry the name and the branch reaches all of them, all are
 * filled: the form is asking for the same thing twice and means it.
 */
function chooseDestinations(
  candidates: readonly string[],
  byId: ReadonlyMap<string, FormField>,
  active: ReadonlySet<string>,
): readonly string[] {
  const live = candidates.filter((id) => {
    const field = byId.get(id)
    return field !== undefined && field.type !== 'hidden' && active.has(id)
  })

  const required = live.filter((id) => byId.get(id)?.isRequired === true)
  return required.length > 0 ? required : live
}

/**
 * Saoirse's word for something, said in the form's vocabulary.
 *
 * A mapping with no table passes its value through, which is right for a name or an amount. A
 * mapping with one translates or gives up: an unlisted value means the two vocabularies do not
 * line up there, and the customer is asked rather than given the nearest-looking option.
 */
function translate(value: unknown, values: Readonly<Record<string, string>> | undefined): unknown {
  if (values === undefined) return value
  if (typeof value !== 'string') return undefined
  return values[value]
}

/** `undefined` for anything that is not an answer, which is the only way a field stays unasked. */
function valueFor(fact: unknown, take: Reshape | undefined): unknown {
  if (fact === null || fact === undefined) return undefined

  if (take === undefined) {
    if (typeof fact === 'string') return fact.trim() === '' ? undefined : fact.trim()
    if (typeof fact === 'number' || typeof fact === 'boolean') return fact
    return undefined
  }

  /*
   * A duration control wants years, months and a total. Saoirse holds one number of years, or a
   * date to count from, and the control's three sub-inputs are the serialiser's problem rather
   * than this one's: what comes out of here is the meaning, `{ years, months }`.
   */
  if (take === 'yearsAsDuration') {
    const years = typeof fact === 'number' ? fact : Number(fact)
    if (!Number.isFinite(years) || years < 0) return undefined
    return { years: Math.floor(years), months: 0 }
  }

  if (take === 'durationSince') {
    return durationSince(fact)
  }

  /*
   * An amount Saoirse holds answers the question that precedes it. Somebody who has told Saoirse they
   * have €8,000 saved has answered "do you have any savings", and asking again is the thing
   * this whole engine exists to stop. Zero is an answer too, and it is No.
   */
  if (take === 'heldAmountAsYesNo') {
    const amount = typeof fact === 'number' ? fact : Number(fact)
    if (!Number.isFinite(amount) || amount < 0) return undefined
    return amount > 0 ? 'Yes' : 'No'
  }

  // Every reshaping below is a string operation on something a person said.
  if (typeof fact !== 'string' || fact.trim() === '') return undefined

  const part =
    take === 'firstName' || take === 'surname' ? namePart(fact, take) : addressPart(fact, take)

  return part.trim() === '' ? undefined : part
}

/**
 * How long since a date, as the form wants it.
 *
 * Used for time in a role, which Saoirse holds as the date somebody started. Counted in whole
 * months so the answer does not drift by a day, and a future date gives nothing rather than a
 * negative duration.
 */
export function durationSince(
  value: unknown,
  now: Date = new Date(),
): { years: number; months: number } | undefined {
  if (typeof value !== 'string') return undefined
  const started = new Date(value)
  if (Number.isNaN(started.getTime())) return undefined

  let months =
    (now.getFullYear() - started.getFullYear()) * 12 + (now.getMonth() - started.getMonth())
  // Not a full month until the day of the month comes round.
  if (now.getDate() < started.getDate()) months -= 1
  if (months < 0) return undefined

  return { years: Math.floor(months / 12), months: months % 12 }
}
