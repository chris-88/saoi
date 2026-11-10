import type { HomeRoute } from '../../contracts/market-tools.ts'
import { AREA_NAMES, LOCAL_AREAS, type LocalArea } from '../../market/areas.ts'
import {
  AFFORDABLE_PURCHASE,
  type AreaCeiling,
  FIRST_HOME_SCHEME,
  HELP_TO_BUY,
  LOCAL_AUTHORITY_HOME_LOAN,
  MORTGAGE_MEASURES,
  type RuleSource,
  VACANT_PROPERTY_GRANT,
} from '../../market/first-home-rules.ts'
import { BUYING_COSTS } from '../../market/mortgage-incentives.ts'
import { euro } from './figures.ts'
import { keysAt, shortMonth } from './home-arithmetic.ts'
import { round2 } from './simulate.ts'
import type { AsOf } from './types.ts'

/**
 * Every route to a home (decision `2026-11-10-saoi-routes-card`): second-hand, a new build with
 * Help to Buy, the First Home Scheme, the Local Authority Home Loan, affordable purchase from a
 * council and the Vacant Property Refurbishment Grant. Each is a fact with a figure, a date or a
 * reason, and a status: potential (nothing given rules it out), needs one detail (and which), or
 * not applicable (and why). No route is marked best, fastest or recommended; nothing instructs.
 * Every rule comes from `market/first-home-rules.ts`, with the page it was read from and the day.
 *
 * The routes are the ways a home could be bought, whatever kind the customer named: their own
 * kind comes first, and the rest stay beside it for them to weigh.
 */

export type PropertyKind = 'new_build' | 'self_build' | 'second_hand'

export type RoutesInput = {
  /** The price given, or the most the limits allow (the calculator's). Null: neither known. */
  readonly priceEur: number | null
  readonly propertyKind: PropertyKind | undefined
  /** As given, or assumed true. */
  readonly firstTimeBuyer: boolean
  /** Gross income a year, both applicants together. Null: not given. */
  readonly incomeEur: number | null
  /** Single or joint, where known: sets the Local Authority Home Loan ceiling. */
  readonly applicants: 'single' | 'joint' | undefined
  readonly savedEur: number
  readonly monthlyEur: number
  readonly taxPaidEur: number | undefined
  readonly county: LocalArea | undefined
  /** The Central Bank income limit for this buyer. Null: no income given. */
  readonly maxLoanEur: number | null
  readonly maxLtvPct: number
}

const ORDER: readonly HomeRoute['id'][] = [
  'second_hand',
  'new_build_help_to_buy',
  'first_home_scheme',
  'local_authority_home_loan',
  'affordable_purchase',
  'vacant_property_grant',
]
const STATUS_RANK: Record<HomeRoute['status'], number> = {
  potential: 0,
  needs_one_detail: 1,
  not_applicable: 2,
}

const ASK_PRICE = 'Is there a price in mind for the home?'
const ASK_INCOME =
  'What is the gross income a year, before tax? If buying with someone, theirs too.'
const ASK_FRESH_START =
  'Has a previous home been left behind with no interest kept in it (Fresh Start, after a divorce or separation)?'
const ASK_COUNTY = 'Which county is the home in?'

const STAMP_SOURCE: RuleSource = {
  fact: 'Stamp duty of 1% on a home up to €1,000,000',
  url: BUYING_COSTS.stampDutySourceUrl,
  checkedOn: '2026-11-10',
}

/** One step of a route's check: ruled out with a line and reason, or one detail short. */
type Check =
  | { readonly kind: 'out'; readonly line: string; readonly reason: string }
  | { readonly kind: 'ask'; readonly missing: string }

/** Where a price stands against an area's limit, given what is known about the area. */
function againstCeiling(
  price: number,
  county: LocalArea | undefined,
  ceilings: Readonly<Record<LocalArea, AreaCeiling>>,
): {
  readonly kind: 'within' | 'above' | 'ask'
  readonly limitEur: number
  readonly where: string
  readonly missing: string
} {
  if (county !== undefined) {
    const ceiling = ceilings[county]
    const where = AREA_NAMES[county]
    if (price <= ceiling.lowEur)
      return { kind: 'within', limitEur: ceiling.lowEur, where, missing: '' }
    if (price > ceiling.highEur)
      return { kind: 'above', limitEur: ceiling.highEur, where, missing: '' }
    return {
      kind: 'ask',
      limitEur: ceiling.highEur,
      where,
      missing: `Which part of ${where} is the home in? (${ceiling.split ?? ''})`,
    }
  }
  const all = LOCAL_AREAS.map((area) => ceilings[area])
  const lowest = Math.min(...all.map((ceiling) => ceiling.lowEur))
  const highest = Math.max(...all.map((ceiling) => ceiling.highEur))
  if (price <= lowest) return { kind: 'within', limitEur: lowest, where: 'any county', missing: '' }
  if (price > highest) return { kind: 'above', limitEur: highest, where: 'highest', missing: '' }
  return { kind: 'ask', limitEur: highest, where: 'county', missing: ASK_COUNTY }
}

function settle(
  base: Omit<HomeRoute, 'status' | 'line' | 'reason' | 'missing'>,
  checks: readonly Check[],
  potential: { readonly line: string; readonly reason: string | null },
  needsLine: (missing: string) => string,
): HomeRoute {
  const out = checks.find((check) => check.kind === 'out')
  if (out?.kind === 'out') {
    return { ...base, status: 'not_applicable', line: out.line, reason: out.reason, missing: null }
  }
  const ask = checks.find((check) => check.kind === 'ask')
  if (ask?.kind === 'ask') {
    return {
      ...base,
      status: 'needs_one_detail',
      line: needsLine(ask.missing),
      reason: null,
      missing: ask.missing,
    }
  }
  return {
    ...base,
    status: 'potential',
    line: potential.line,
    reason: potential.reason,
    missing: null,
  }
}

function secondHand(input: RoutesInput, asOf: AsOf): HomeRoute {
  const base = {
    id: 'second_hand' as const,
    name: 'Second-hand',
    mechanism: 'A mortgage within the Central Bank limits, with the deposit and buying costs saved',
    keysOn: null,
    conditions: [
      `A mortgage of up to ${String(MORTGAGE_MEASURES.first_time_buyer.loanToIncome)} times gross income (${String(MORTGAGE_MEASURES.second_and_subsequent.loanToIncome)} for a second or later buyer) and ${String(MORTGAGE_MEASURES.first_time_buyer.maxLtvPct)}% of the price; lenders decide within it`,
      `Stamp duty of ${String(BUYING_COSTS.stampDutyPct)}% and about ${euro(BUYING_COSTS.legalAndSurveyEur)} for legal fees and a survey (an estimate)`,
      'No Help to Buy: it is for new builds and self-builds',
    ],
    confirmed: true,
    sources: [MORTGAGE_MEASURES.source, STAMP_SOURCE],
  }
  if (input.priceEur === null) {
    return settle(
      base,
      [{ kind: 'ask', missing: ASK_PRICE }],
      { line: '', reason: '' },
      () => 'Second-hand: the keys date needs a price',
    )
  }
  const keys = keysAt(
    {
      priceEur: input.priceEur,
      maxLoanEur: input.maxLoanEur,
      maxLtvPct: input.maxLtvPct,
      savedEur: input.savedEur,
      monthlyEur: input.monthlyEur,
      helpToBuyEur: 0,
    },
    asOf,
  )
  return {
    ...settle(
      base,
      [],
      {
        line:
          keys.reachedOn === null
            ? `Second-hand: ${euro(keys.neededEur)} needed at the keys, not reached at this pace`
            : `Second-hand: keys ${shortMonth(keys.reachedOn)}, ${euro(keys.neededEur)} needed at the keys`,
        reason: `For a ${euro(input.priceEur)} home: a ${euro(keys.depositEur)} deposit, ${euro(keys.stampDutyEur)} stamp duty and about ${euro(BUYING_COSTS.legalAndSurveyEur)} in fees, before interest.`,
      },
      () => '',
    ),
    keysOn: keys.reachedOn,
  }
}

function newBuildHelpToBuy(input: RoutesInput, asOf: AsOf): HomeRoute {
  const base = {
    id: 'new_build_help_to_buy' as const,
    name: 'New build with Help to Buy',
    mechanism: `A tax refund from Revenue towards the deposit: 10% of the price, at most ${euro(HELP_TO_BUY.capEur)}`,
    keysOn: null,
    conditions: [
      'A first-time buyer, in a new build bought from a builder or a self-build',
      `A price (or self-build valuation) of ${euro(HELP_TO_BUY.maxPriceEur)} or less`,
      `A mortgage of at least ${String(HELP_TO_BUY.minMortgagePct)}% of the price`,
      `At most the Income Tax and DIRT paid over the last ${String(HELP_TO_BUY.taxYears)} tax years (not USC or PRSI)`,
      `Lived in as the main home for ${String(HELP_TO_BUY.residenceYears)} years; bought or built by ${HELP_TO_BUY.endsOn}`,
    ],
    confirmed: true,
    sources: [...HELP_TO_BUY.sources],
  }
  const name = 'New build with Help to Buy'
  if (!input.firstTimeBuyer) {
    return settle(
      base,
      [
        {
          kind: 'out',
          line: `${name}: for first-time buyers only`,
          reason: 'Help to Buy is for first-time buyers only.',
        },
      ],
      { line: '', reason: '' },
      () => '',
    )
  }
  const price = input.priceEur
  if (price === null) {
    return settle(
      base,
      [{ kind: 'ask', missing: ASK_PRICE }],
      { line: '', reason: '' },
      () => `${name}: up to ${euro(HELP_TO_BUY.capEur)} towards the deposit, price not given`,
    )
  }
  if (price > HELP_TO_BUY.maxPriceEur) {
    return settle(
      base,
      [
        {
          kind: 'out',
          line: `${name}: not at ${euro(price)}, the limit is ${euro(HELP_TO_BUY.maxPriceEur)}`,
          reason: `${euro(price)} is above the ${euro(HELP_TO_BUY.maxPriceEur)} Help to Buy limit.`,
        },
      ],
      { line: '', reason: '' },
      () => '',
    )
  }
  const upTo = round2(Math.min(price * HELP_TO_BUY.shareOfPrice, HELP_TO_BUY.capEur))
  const help = input.taxPaidEur === undefined ? upTo : round2(Math.min(upTo, input.taxPaidEur))
  const keys = keysAt(
    {
      priceEur: price,
      maxLoanEur: input.maxLoanEur,
      maxLtvPct: input.maxLtvPct,
      savedEur: input.savedEur,
      monthlyEur: input.monthlyEur,
      helpToBuyEur: help,
    },
    asOf,
  )
  const checks: Check[] = []
  if (keys.loanEur < (price * HELP_TO_BUY.minMortgagePct) / 100) {
    checks.push({
      kind: 'out',
      line: `${name}: a ${euro(keys.loanEur)} mortgage is under ${String(HELP_TO_BUY.minMortgagePct)}% of the price`,
      reason: `Help to Buy needs a mortgage of at least ${String(HELP_TO_BUY.minMortgagePct)}% of the price; the income limit allows ${euro(keys.loanEur)} on ${euro(price)}.`,
    })
  }
  if (input.taxPaidEur === 0) {
    checks.push({
      kind: 'out',
      line: `${name}: no refund with no Income Tax or DIRT paid`,
      reason:
        'Help to Buy is limited to the Income Tax and DIRT paid over the last four tax years, given as none.',
    })
  }
  if (input.taxPaidEur === undefined) {
    checks.push({
      kind: 'ask',
      missing: 'How much Income Tax and DIRT was paid over the last four tax years?',
    })
  }
  const keysWords = keys.reachedOn === null ? null : shortMonth(keys.reachedOn)
  const route = settle(
    base,
    checks,
    {
      line:
        keysWords === null
          ? `${name}: ${euro(help)} Help to Buy, ${euro(keys.neededEur)} still needed at the keys`
          : `${name}: keys ${keysWords} with ${euro(help)} Help to Buy`,
      reason: `${euro(help)} Help to Buy on a ${euro(price)} home${help < upTo ? `, limited by the ${euro(input.taxPaidEur ?? 0)} tax paid` : ''}; ${euro(keys.neededEur)} needed at the keys, before interest.`,
    },
    () =>
      keysWords === null
        ? `${name}: up to ${euro(upTo)} if your tax paid covers it`
        : `${name}: keys ${keysWords} if your tax paid covers ${euro(upTo)}`,
  )
  return {
    ...route,
    reason:
      route.status === 'needs_one_detail'
        ? `Up to ${euro(upTo)} Help to Buy is counted on this route only; it is limited by the Income Tax and DIRT paid over the last four tax years, which was not given.`
        : route.reason,
    keysOn: route.status === 'not_applicable' ? null : keys.reachedOn,
  }
}

function firstHomeScheme(input: RoutesInput): HomeRoute {
  const rules = FIRST_HOME_SCHEME
  const name = 'First Home Scheme'
  const base = {
    id: 'first_home_scheme' as const,
    name,
    mechanism: 'Shared equity: the scheme funds part of a new home’s price and holds that share',
    keysOn: null,
    conditions: [
      'A new build in a private development, a self-build, or buying the home rented after a notice to sell',
      'First-time buyers or Fresh Start',
      `Up to ${String(rules.maxSharePct)}% of the price, ${String(rules.maxShareWithHelpToBuyPct)}% with Help to Buy; at least ${String(rules.minSharePct)}% or ${euro(rules.minShareEur)}`,
      `Mortgage approval with a participating lender, borrowing the most it offers (up to ${String(rules.loanToIncome)} times income)`,
      `A ${String(rules.minDepositPct)}% deposit; Help to Buy can count towards it`,
      'Price within the local ceiling (€375,000 to €500,000 by area)',
      'Not with the Local Authority Home Loan or affordable purchase',
    ],
    confirmed: rules.confirmed,
    sources: [...rules.sources],
  }
  const checks: Check[] = []
  if (input.priceEur !== null) {
    const at = againstCeiling(input.priceEur, input.county, rules.ceilings)
    if (at.kind === 'above') {
      checks.push({
        kind: 'out',
        line:
          at.where === 'highest'
            ? `${name}: not at ${euro(input.priceEur)}, the highest ceiling is ${euro(at.limitEur)}`
            : `${name}: not at ${euro(input.priceEur)}, the ${at.where} ceiling is ${euro(at.limitEur)}`,
        reason: `${euro(input.priceEur)} is above the price ceiling of ${euro(at.limitEur)}${at.where === 'highest' ? ' (the highest anywhere)' : ` in ${at.where}`}.`,
      })
    }
    if (at.kind === 'ask') checks.push({ kind: 'ask', missing: at.missing })
  }
  if (!input.firstTimeBuyer) checks.push({ kind: 'ask', missing: ASK_FRESH_START })
  if (input.priceEur === null) checks.push({ kind: 'ask', missing: ASK_PRICE })

  const withHtb =
    input.firstTimeBuyer &&
    input.priceEur !== null &&
    input.priceEur <= HELP_TO_BUY.maxPriceEur &&
    input.taxPaidEur !== 0
  const sharePct = withHtb ? rules.maxShareWithHelpToBuyPct : rules.maxSharePct
  const share = input.priceEur === null ? null : round2((input.priceEur * sharePct) / 100)
  return settle(
    base,
    checks,
    {
      line:
        share === null
          ? `${name}: shared equity up to ${String(rules.maxSharePct)}% of a new home’s price`
          : `${name}: shared equity up to ${euro(share)} (${String(sharePct)}%${withHtb ? ' with Help to Buy' : ''}) on a new build`,
      reason:
        share === null
          ? null
          : `Up to ${String(sharePct)}% of ${euro(input.priceEur ?? 0)}, where the deposit and the largest mortgage a participating lender offers fall short of the price.`,
    },
    () =>
      share === null
        ? `${name}: shared equity on a new build, price not given`
        : `${name}: shared equity up to ${euro(share)}, if the ceiling allows`,
  )
}

function localAuthorityHomeLoan(input: RoutesInput): HomeRoute {
  const rules = LOCAL_AUTHORITY_HOME_LOAN
  const name = 'Local Authority Home Loan'
  const base = {
    id: 'local_authority_home_loan' as const,
    name,
    mechanism: `An alternative mortgage from the council, up to ${String(rules.maxLtvPct)}% of the home’s value`,
    keysOn: null,
    conditions: [
      `Gross income at most ${euro(rules.maxIncomeSingleEur)} single, ${euro(rules.maxIncomeJointEur)} joint`,
      `Proof of insufficient mortgage offers from ${String(rules.insufficientOffers)} regulated lenders`,
      'A first-time buyer (Fresh Start and inherited property excepted)',
      `Aged ${String(rules.minAge)} to ${String(rules.maxAge)}; two years’ employment (one for a second earner)`,
      'A market value within the county limit (€310,000 to €415,000)',
      'Not with the First Home Scheme',
    ],
    confirmed: rules.confirmed,
    sources: [...rules.sources],
  }
  const checks: Check[] = []
  let ceiling: number | null = null
  if (input.incomeEur !== null) {
    const single = rules.maxIncomeSingleEur
    const joint = rules.maxIncomeJointEur
    if (input.applicants === 'single') ceiling = single
    else if (input.applicants === 'joint') ceiling = joint
    else if (input.incomeEur <= single) ceiling = single
    else if (input.incomeEur > joint) ceiling = joint
    if (ceiling !== null && input.incomeEur > ceiling) {
      const words = input.applicants === 'joint' ? 'joint ' : ''
      checks.push({
        kind: 'out',
        line: `${name}: not at ${euro(input.incomeEur)} ${words}income, the ceiling is ${euro(ceiling)}`,
        reason: `Gross income of ${euro(input.incomeEur)} is above the ${euro(ceiling)} ${ceiling === single ? 'single' : 'joint'} ceiling.`,
      })
    }
    if (ceiling === null) {
      checks.push({
        kind: 'ask',
        missing: `Is anyone buying with you? The income ceiling is ${euro(single)} single, ${euro(joint)} joint.`,
      })
    }
  }
  if (input.priceEur !== null) {
    const at = againstCeiling(input.priceEur, input.county, rules.ceilings)
    if (at.kind === 'above') {
      checks.push({
        kind: 'out',
        line:
          at.where === 'highest'
            ? `${name}: not at ${euro(input.priceEur)}, the highest limit is ${euro(at.limitEur)}`
            : `${name}: not at ${euro(input.priceEur)}, the ${at.where} limit is ${euro(at.limitEur)}`,
        reason: `${euro(input.priceEur)} is above the maximum market value of ${euro(at.limitEur)}${at.where === 'highest' ? ' (the highest anywhere)' : ` in ${at.where}`}.`,
      })
    }
    if (at.kind === 'ask') checks.push({ kind: 'ask', missing: at.missing })
  }
  if (input.incomeEur === null) checks.push({ kind: 'ask', missing: ASK_INCOME })
  if (!input.firstTimeBuyer) checks.push({ kind: 'ask', missing: ASK_FRESH_START })
  if (input.priceEur === null) checks.push({ kind: 'ask', missing: ASK_PRICE })

  const within =
    input.incomeEur !== null && ceiling !== null
      ? `${euro(input.incomeEur)} is within the ${euro(ceiling)} ${ceiling === rules.maxIncomeSingleEur ? 'single' : 'joint'} ceiling`
      : null
  return settle(
    base,
    checks,
    {
      line: `${name}: ${within ?? 'within the limits given'}`,
      reason: `${within ?? 'Within the limits given'}${input.priceEur === null ? '' : `, and ${euro(input.priceEur)} is within the price limit`}; it lends up to ${String(rules.maxLtvPct)}% of value when two lenders have not offered enough.`,
    },
    (missing) => {
      if (missing === ASK_FRESH_START) return `${name}: for first-time buyers or Fresh Start`
      if (within === null || input.incomeEur === null || ceiling === null)
        return `${name}: income ceiling ${euro(rules.maxIncomeSingleEur)} single, ${euro(rules.maxIncomeJointEur)} joint`
      const short = `${name}: ${euro(input.incomeEur)} within the ${euro(ceiling)} ceiling`
      return missing === ASK_PRICE
        ? `${short}; price not given`
        : `${short}; the county sets the price limit`
    },
  )
}

function affordablePurchase(input: RoutesInput): HomeRoute {
  const rules = AFFORDABLE_PURCHASE
  const name = 'Affordable purchase'
  const base = {
    id: 'affordable_purchase' as const,
    name,
    mechanism: `A council home sold below market value; the council keeps the difference as its share (at least ${String(rules.minCouncilSharePct)}%)`,
    keysOn: null,
    conditions: [
      'Only homes a council advertises (listed as Starter Home Purchase); each advert has its own opening and closing dates',
      'A first-time buyer or Fresh Start',
      `Gross household income times ${String(rules.incomeMultiple)} at most ${String(rules.maxIncomeShareOfValuePct)}% of the home’s market value`,
      `The council keeps an equity share of at least ${String(rules.minCouncilSharePct)}%`,
      'Help to Buy can count towards it; the First Home Scheme cannot',
    ],
    confirmed: rules.confirmed,
    sources: [...rules.sources],
  }
  const checks: Check[] = []
  const limit =
    input.priceEur === null
      ? null
      : Math.floor((input.priceEur * rules.maxIncomeShareOfValuePct) / 100 / rules.incomeMultiple)
  if (input.incomeEur !== null && input.priceEur !== null && limit !== null) {
    if (input.incomeEur > limit) {
      checks.push({
        kind: 'out',
        line: `${name}: not at ${euro(input.incomeEur)} income for a ${euro(input.priceEur)} home, the limit is ${euro(limit)}`,
        reason: `Income times ${String(rules.incomeMultiple)} (${euro(input.incomeEur * rules.incomeMultiple)}) is above ${String(rules.maxIncomeShareOfValuePct)}% of ${euro(input.priceEur)}.`,
      })
    }
  }
  if (input.incomeEur === null) checks.push({ kind: 'ask', missing: ASK_INCOME })
  if (!input.firstTimeBuyer) checks.push({ kind: 'ask', missing: ASK_FRESH_START })
  if (input.priceEur === null) checks.push({ kind: 'ask', missing: ASK_PRICE })
  return settle(
    base,
    checks,
    {
      line: `${name}: ${euro(input.incomeEur ?? 0)} is within the limit for a ${euro(input.priceEur ?? 0)} home`,
      reason: `Income up to ${euro(limit ?? 0)} qualifies for a ${euro(input.priceEur ?? 0)} home; only where a council advertises homes, each with its own dates.`,
    },
    () =>
      limit === null
        ? `${name}: council homes below market value, when advertised`
        : `${name}: income up to ${euro(limit)} for a ${euro(input.priceEur ?? 0)} home`,
  )
}

function vacantPropertyGrant(): HomeRoute {
  const rules = VACANT_PROPERTY_GRANT
  return {
    id: 'vacant_property_grant',
    name: 'Vacant property grant',
    mechanism: 'A grant for works after purchase, paid on receipts; not deposit money',
    status: 'potential',
    line: `Vacant property grant: up to ${euro(rules.maxGrantEur)} for works after purchase, not the deposit`,
    reason: `Up to ${euro(rules.maxGrantEur)} (${euro(rules.maxGrantEur + rules.derelictTopUpEur)} if derelict) for a home vacant ${String(rules.minVacantYears)} years or more, paid after the works.`,
    missing: null,
    keysOn: null,
    conditions: [
      `Vacant for at least ${String(rules.minVacantYears)} years`,
      `Built before ${String(rules.builtBeforeYear)} (Limerick’s page; South Dublin’s says before 2007)`,
      `Up to ${euro(rules.maxGrantEur)}, and up to ${euro(rules.derelictTopUpEur)} more if derelict`,
      `Paid on receipts after the approved works, finished within ${String(rules.worksWithinMonths)} months`,
      'To live in or to rent out; applied for through the council where the home is',
    ],
    confirmed: rules.confirmed,
    sources: [...rules.sources],
  }
}

/** Every route, the customer's own kind first, then potential, needs one detail, not applicable. */
export function homeRoutes(input: RoutesInput, asOf: AsOf): HomeRoute[] {
  const routes = [
    secondHand(input, asOf),
    newBuildHelpToBuy(input, asOf),
    firstHomeScheme(input),
    localAuthorityHomeLoan(input),
    affordablePurchase(input),
    vacantPropertyGrant(),
  ]
  const own: HomeRoute['id'] | null =
    input.propertyKind === 'second_hand'
      ? 'second_hand'
      : input.propertyKind === undefined
        ? null
        : 'new_build_help_to_buy'
  const rank = (route: HomeRoute) => (route.id === own ? -1 : STATUS_RANK[route.status])
  return [...routes].sort((a, b) => rank(a) - rank(b) || ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
}

/** The routes for a presentation: three lines, then how many more (never a pick). */
export function routeLines(routes: readonly HomeRoute[]): string[] {
  const shown = routes.slice(0, 3).map((route) => route.line)
  const more = routes.length - shown.length
  return more > 0 ? [...shown, `More routes: ${String(more)}`] : shown
}
