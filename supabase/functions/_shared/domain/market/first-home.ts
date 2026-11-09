import type { FirstHomeRequest, FirstHomeResponse } from '../../contracts/market-tools.ts'
import {
  FIRST_HOME_SCHEME,
  GREEN_MORTGAGES,
  HELP_TO_BUY,
  MORTGAGE_MEASURES,
} from '../../market/first-home-rules.ts'
import { euro } from './figures.ts'
import { affordability } from './mortgage.ts'
import { round2 } from './simulate.ts'
import type { Market } from './types.ts'

/**
 * A first home: Help to Buy, the Central Bank's limits with Help to Buy counted towards the
 * deposit, green rates from the market, and the mortgages that fit. Every rule comes from
 * `market/first-home-rules.ts`, with the primary page it was read from. What was not given
 * (the kind of property, tax paid) is never assumed: the result says what it depends on.
 */

export const FIRST_HOME_NEXT =
  'Nothing is stored from this. Help to Buy and the limits above are information for the customer to weigh. With a target and a date, saoi_build_plan works out the saving towards the deposit and returns a link that holds the plan for 24 hours so it can be opened in the Saoi app.'

type HelpToBuy = FirstHomeResponse['helpToBuy']

const CONDITIONS = [
  'A first-time buyer: never bought or built a home before, alone or jointly, in Ireland or abroad.',
  'A new build bought from a builder (construction subject to VAT), a self-build, or a converted non-residential building; not as an investment.',
  `The price (or a self-build’s approved valuation) is ${euro(HELP_TO_BUY.maxPriceEur)} or less.`,
  `The mortgage is at least ${String(HELP_TO_BUY.minMortgagePct)}% of the price, from a qualifying lender.`,
  `Lived in as the main home for ${String(HELP_TO_BUY.residenceYears)} years, or Revenue claws the refund back.`,
  `Bought or built by ${HELP_TO_BUY.endsOn}.`,
  `Limited to the Income Tax and DIRT paid over the ${String(HELP_TO_BUY.taxYears)} tax years before applying (USC and PRSI do not count).`,
]

/** Help to Buy for a price, as far as the inputs given allow. */
export function helpToBuyFor(input: {
  readonly price: number | null
  readonly propertyKind: FirstHomeRequest['propertyKind']
  readonly firstTimeBuyer: boolean
  readonly taxPaid: number | undefined
}): HelpToBuy {
  const base = {
    conditions: CONDITIONS,
    capEur: HELP_TO_BUY.capEur,
    maxPriceEur: HELP_TO_BUY.maxPriceEur,
    endsOn: HELP_TO_BUY.endsOn,
    sources: [...HELP_TO_BUY.sources],
  }
  const none = (reasons: string[]): HelpToBuy => ({
    ...base,
    status: 'not_available',
    amountEur: null,
    upToEur: 0,
    limitedBy: null,
    reasons,
  })
  if (!input.firstTimeBuyer) return none(['Help to Buy is for first-time buyers only.'])
  if (input.propertyKind === 'second_hand') {
    return none(['Help to Buy is for new builds and self-builds, not a second-hand home.'])
  }
  if (input.price !== null && input.price > HELP_TO_BUY.maxPriceEur) {
    return none([
      `${euro(input.price)} is above the ${euro(HELP_TO_BUY.maxPriceEur)} Help to Buy limit.`,
    ])
  }
  const reasons: string[] = []
  const share = input.price === null ? null : round2(input.price * HELP_TO_BUY.shareOfPrice)
  const upTo = share === null ? HELP_TO_BUY.capEur : Math.min(share, HELP_TO_BUY.capEur)
  let limitedBy: HelpToBuy['limitedBy'] =
    share === null ? 'cap' : share <= HELP_TO_BUY.capEur ? 'share_of_price' : 'cap'
  reasons.push(
    share === null
      ? `Up to ${euro(HELP_TO_BUY.capEur)}: 10% of the price, at most ${euro(HELP_TO_BUY.capEur)}.`
      : `10% of ${euro(input.price ?? 0)} is ${euro(share)}${share > HELP_TO_BUY.capEur ? `, above the ${euro(HELP_TO_BUY.capEur)} cap` : ''}: up to ${euro(upTo)}.`,
  )
  let amount: number | null = null
  if (input.taxPaid === undefined) {
    reasons.push(
      'The refund is also limited to the Income Tax and DIRT paid over the last four tax years, which was not given.',
    )
  } else {
    amount = round2(Math.min(upTo, input.taxPaid))
    if (input.taxPaid < upTo) {
      limitedBy = 'tax_paid'
      reasons.push(
        `Limited to the ${euro(input.taxPaid)} of Income Tax and DIRT paid over the last four tax years.`,
      )
    }
  }
  const depends = input.propertyKind === undefined || amount === null || input.price === null
  if (input.propertyKind === undefined) {
    reasons.push(
      'Only if the home is a new build or a self-build; the kind of property was not given.',
    )
  }
  return {
    ...base,
    status: depends ? 'depends' : amount !== null && amount > 0 ? 'available' : 'not_available',
    amountEur: depends ? null : amount,
    upToEur: round2(upTo),
    limitedBy,
    reasons,
  }
}

export function firstHome(market: Market, request: FirstHomeRequest): FirstHomeResponse {
  const firstTimeBuyer = request.firstTimeBuyer ?? true
  const measures = firstTimeBuyer
    ? MORTGAGE_MEASURES.first_time_buyer
    : MORTGAGE_MEASURES.second_and_subsequent
  const maxLoanByIncome = request.annualGrossIncome * measures.loanToIncome
  const deposit = request.deposit
  const ltv = measures.maxLtvPct / 100
  const withoutHtb = Math.min(deposit / (1 - ltv), deposit + maxLoanByIncome)

  // With Help to Buy towards the deposit: the price where both limits hold, within its cap.
  const htbPossible = firstTimeBuyer && request.propertyKind !== 'second_hand'
  const htbAt = (price: number): number =>
    Math.min(
      price * HELP_TO_BUY.shareOfPrice,
      HELP_TO_BUY.capEur,
      request.taxPaidLastFourYearsEur ?? Infinity,
    )
  let withHtb: number | null = null
  if (htbPossible) {
    let price = withoutHtb
    for (let i = 0; i < 50; i += 1) {
      const help = htbAt(price)
      price = Math.min((deposit + help) / (1 - ltv), deposit + help + maxLoanByIncome)
    }
    withHtb = round2(Math.min(price, HELP_TO_BUY.maxPriceEur))
    if (withHtb <= withoutHtb) withHtb = null
  }

  const price = request.propertyPrice ?? null
  const helpToBuy = helpToBuyFor({
    price: price ?? withHtb ?? withoutHtb,
    propertyKind: request.propertyKind,
    firstTimeBuyer,
    taxPaid: request.taxPaidLastFourYearsEur,
  })

  let forPrice: FirstHomeResponse['lending']['forPrice'] = null
  if (price !== null) {
    const help =
      helpToBuy.status === 'not_available' ? 0 : (helpToBuy.amountEur ?? helpToBuy.upToEur)
    const depositNeeded = round2(price * (1 - ltv))
    const loanNeeded = round2(Math.max(0, price - deposit - help))
    forPrice = {
      price,
      depositNeeded,
      helpToBuy: round2(help),
      depositShortfall: round2(Math.max(0, depositNeeded - deposit - help)),
      loanNeeded,
      ltvPct: round2((loanNeeded / price) * 100),
      withinIncomeLimit: loanNeeded <= maxLoanByIncome,
      aboveIncomeLimitBy: round2(Math.max(0, loanNeeded - maxLoanByIncome)),
      helpToBuyMortgageShareMet:
        help > 0 ? loanNeeded >= price * (HELP_TO_BUY.minMortgagePct / 100) : null,
    }
  }

  const loanFor = forPrice?.loanNeeded
  const valueFor = price ?? withHtb ?? withoutHtb
  const afford = affordability(market, {
    mode: 'affordability',
    buyer: firstTimeBuyer ? 'first_time_buyer' : 'second_and_subsequent',
    annualGrossIncome: request.annualGrossIncome,
    deposit: loanFor === undefined ? deposit : Math.max(0, valueFor - loanFor),
    propertyValue: valueFor,
    ...(request.termYears === undefined ? {} : { termYears: request.termYears }),
    ...(request.ber === undefined ? {} : { ber: request.ber }),
    limit: 25,
  })

  // Green rates, from the market: a rate for a BER, or a product the lender calls green. High-value
  // rates (for larger loans only) are left out of both sides.
  const loanLtv = valueFor > 0 ? ((loanFor ?? Math.max(0, valueFor - deposit)) / valueFor) * 100 : 0
  const inBand = market.products.flatMap((product) =>
    product.terms.kind === 'mortgage' &&
    product.terms.buyerTypes.includes(firstTimeBuyer ? 'first_time_buyer' : 'mover') &&
    (product.terms.ltvMinPct ?? 0) <= loanLtv + 1e-9 &&
    (product.terms.ltvMaxPct ?? 100) >= loanLtv - 1e-9 &&
    !product.terms.highValue &&
    !/higher value/i.test(product.name) &&
    product.terms.initialRatePct !== null
      ? [{ product, terms: product.terms, rate: product.terms.initialRatePct }]
      : [],
  )
  const isGreen = (entry: (typeof inBand)[number]) =>
    entry.terms.ber !== null || /green/i.test(entry.product.name)
  const cheapest = (entries: typeof inBand) => [...entries].sort((a, b) => a.rate - b.rate)[0]
  const green = cheapest(inBand.filter(isGreen))
  const standard = cheapest(inBand.filter((entry) => !isGreen(entry)))

  const assumptions = [
    ...afford.assumptions,
    'Help to Buy is counted towards the deposit, as Revenue pays it to the builder or into the self-build loan.',
    `Rules as recorded on ${HELP_TO_BUY.sources[0]?.checkedOn ?? ''} from Revenue and the Central Bank; each is listed with its page.`,
  ]

  const htbLine =
    helpToBuy.status === 'not_available'
      ? `Help to Buy: not available. ${helpToBuy.reasons.join(' ')}`
      : helpToBuy.status === 'available'
        ? `Help to Buy: ${euro(helpToBuy.amountEur ?? 0)} (Revenue). ${helpToBuy.reasons.join(' ')}`
        : `Help to Buy: depends, up to ${euro(helpToBuy.upToEur)}. ${helpToBuy.reasons.join(' ')}`
  const presentation = [
    `${htbLine} Cap ${euro(HELP_TO_BUY.capEur)} for applications from ${HELP_TO_BUY.capFrom}; homes bought or built by ${HELP_TO_BUY.endsOn} (Revenue, checked ${HELP_TO_BUY.sources[1]?.checkedOn ?? ''}).`,
    `Central Bank limits: borrowing up to ${String(measures.loanToIncome)} times income (${euro(round2(maxLoanByIncome))}) and 90% of the price. The highest price they allow is ${euro(round2(withoutHtb))}${withHtb === null ? '' : `, or ${euro(withHtb)} for a new build with Help to Buy towards the deposit`}.`,
    ...(forPrice === null
      ? []
      : [
          `At ${euro(forPrice.price)}: a ${euro(forPrice.depositNeeded)} deposit is needed${forPrice.helpToBuy > 0 ? `, ${euro(forPrice.helpToBuy)} of it from Help to Buy` : ''}${forPrice.depositShortfall > 0 ? `, ${euro(forPrice.depositShortfall)} short` : ''}; the loan of ${euro(forPrice.loanNeeded)} is ${forPrice.withinIncomeLimit ? 'within the income limit' : `${euro(forPrice.aboveIncomeLimitBy)} above the income limit, which lenders can exceed for up to ${String(measures.allowancePct)}% of their lending (their decision)`}.`,
        ]),
    ...(green !== undefined && standard !== undefined
      ? [
          `Green rates are the lenders’ own: the lowest at this loan-to-value is ${green.product.providerName} ${green.product.name} at ${String(green.rate)}%${green.terms.ber === null ? '' : ` (BER ${green.terms.ber})`}, against ${String(standard.rate)}% standard.`,
        ]
      : []),
    'The First Home shared equity scheme could not be confirmed from a primary page, so it is not included.',
    'These are the published rules and the figures for the inputs given; the customer decides.',
  ]

  return {
    presentation,
    helpToBuy,
    lending: {
      loanToIncome: measures.loanToIncome,
      maxLtvPct: measures.maxLtvPct,
      allowancePct: measures.allowancePct,
      allowance: MORTGAGE_MEASURES.allowance,
      exemptions: MORTGAGE_MEASURES.exemptions,
      maxLoanByIncome: round2(maxLoanByIncome),
      maxPriceWithoutHelpToBuy: round2(withoutHtb),
      maxPriceWithHelpToBuy: withHtb,
      forPrice,
      source: { ...MORTGAGE_MEASURES.source },
    },
    firstHomeScheme: {
      confirmed: FIRST_HOME_SCHEME.confirmed,
      note: FIRST_HOME_SCHEME.note,
      source: { ...FIRST_HOME_SCHEME.source },
    },
    greenRates: {
      note: GREEN_MORTGAGES.note,
      cheapestGreen:
        green === undefined
          ? null
          : {
              productId: green.product.id,
              name: `${green.product.providerName} ${green.product.name}`,
              ratePct: green.rate,
              berNeeded: green.terms.ber,
            },
      cheapestStandard:
        standard === undefined
          ? null
          : {
              productId: standard.product.id,
              name: `${standard.product.providerName} ${standard.product.name}`,
              ratePct: standard.rate,
            },
    },
    options: afford.options.slice(0, request.limit ?? 5),
    ranking: afford.ranking,
    assumptions,
    dataCheckedAt: afford.dataCheckedAt,
    attributions: afford.attributions,
    next: FIRST_HOME_NEXT,
  }
}
