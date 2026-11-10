import type { HomeCalculatorRequest, HomeCalculatorResponse } from '../../contracts/market-tools.ts'
import { MORTGAGE_WARNINGS, RESULT_STATEMENT } from '../../market/disclosures.ts'
import { HELP_TO_BUY, MORTGAGE_MEASURES } from '../../market/first-home-rules.ts'
import { BUYING_COSTS } from '../../market/mortgage-incentives.ts'
import { euro } from './figures.ts'
import { keysAt, monthName, monthsBetween, stampDutyAt } from './home-arithmetic.ts'
import { homeRoutes, routeLines } from './routes.ts'
import { round2 } from './simulate.ts'
import type { AsOf } from './types.ts'

/**
 * The home calculator (Chris, 2026-11-10): the front door for buying a home. Takes whatever the
 * customer has said, however partial, and returns the figures that move as the inputs move:
 * what the Central Bank limits allow, the deposit and cash needed at the keys, and the month
 * that money is saved at this pace. No products and no pick: the options come from
 * `saoi_build_plan`, filtered and sorted as the customer chooses.
 *
 * The same arithmetic runs in the calculator card as sliders move, from `rules` in the result,
 * so the two agree. Savings are counted before interest here (stated): the plan adds interest.
 *
 * Help to Buy is counted in the headline only when tax paid is given (decision
 * `2026-11-10-saoi-routes-card`): without it, the headline is without Help to Buy, the figure is
 * what it could be (`helpToBuyConditional`), and the new-build route carries the keys date if
 * tax paid covers it. The routes (`routes.ts`) follow the headline.
 */

const NEW_KINDS = new Set(['new_build', 'self_build'])

export function homeCalculator(request: HomeCalculatorRequest, asOf: AsOf): HomeCalculatorResponse {
  const firstTimeBuyer = request.firstTimeBuyer ?? true
  const measures = firstTimeBuyer
    ? MORTGAGE_MEASURES.first_time_buyer
    : MORTGAGE_MEASURES.second_and_subsequent
  const ltv = measures.maxLtvPct / 100
  const income =
    request.annualGrossIncomeEur === undefined && request.secondIncomeEur === undefined
      ? null
      : (request.annualGrossIncomeEur ?? 0) + (request.secondIncomeEur ?? 0)
  const maxLoan = income === null ? null : round2(income * measures.loanToIncome)
  const htbApplies =
    firstTimeBuyer && request.propertyKind !== undefined && NEW_KINDS.has(request.propertyKind)
  /** Counted towards the cash at the keys only when tax paid, which limits it, was given. */
  const htbCounted = htbApplies && request.taxPaidLastFourYearsEur !== undefined
  /** What Help to Buy could be at a price, before the tax-paid limit. */
  const helpToBuyUpTo = (price: number): number =>
    !htbApplies || price > HELP_TO_BUY.maxPriceEur
      ? 0
      : round2(Math.min(price * HELP_TO_BUY.shareOfPrice, HELP_TO_BUY.capEur))
  const helpToBuyAt = (price: number): number =>
    !htbCounted
      ? 0
      : round2(Math.min(helpToBuyUpTo(price), request.taxPaidLastFourYearsEur ?? Infinity))
  const stampAt = stampDutyAt
  const saved = request.depositSavedEur ?? 0
  const monthly = request.monthlySavingEur ?? 0
  const target = request.targetDate?.slice(0, 7)
  const savedBy = (yyyyMm: string): number => saved + monthly * monthsBetween(asOf, yyyyMm)

  // ---- The price: as given, or the most the deposit by the date and the income limit allow --
  let price: number | null = request.targetPriceEur ?? null
  let priceFrom: HomeCalculatorResponse['figures']['priceFrom'] = price === null ? null : 'given'
  if (price === null && target !== undefined && (saved > 0 || monthly > 0)) {
    const cash = savedBy(target)
    let p = Math.max(0, (cash - BUYING_COSTS.legalAndSurveyEur) / (1 - ltv + 0.01))
    for (let i = 0; i < 60; i += 1) {
      const deposit = cash - stampAt(p) - BUYING_COSTS.legalAndSurveyEur + helpToBuyAt(p)
      const byDeposit = deposit / (1 - ltv)
      const byIncome = maxLoan === null ? Infinity : deposit + maxLoan
      const next = Math.max(0, Math.min(byDeposit, byIncome))
      if (Math.abs(next - p) < 0.5) {
        p = next
        break
      }
      p = next
    }
    price = Math.floor(p / 1_000) * 1_000
    priceFrom = 'limits'
    if (price <= 0) {
      price = null
      priceFrom = null
    }
  }

  const helpToBuy = price === null ? 0 : helpToBuyAt(price)
  const keys =
    price === null
      ? null
      : keysAt(
          {
            priceEur: price,
            maxLoanEur: maxLoan,
            maxLtvPct: measures.maxLtvPct,
            savedEur: saved,
            monthlyEur: monthly,
            helpToBuyEur: helpToBuy,
          },
          asOf,
        )
  const loan = keys?.loanEur ?? null
  const deposit = keys?.depositEur ?? null
  const stamp = keys?.stampDutyEur ?? null
  const needed = keys?.neededEur ?? null
  const reachedOn = keys?.reachedOn ?? null
  const helpToBuyConditional =
    htbApplies && !htbCounted && price !== null && helpToBuyUpTo(price) > 0
  const helpToBuyShown = helpToBuyConditional && price !== null ? helpToBuyUpTo(price) : helpToBuy
  const targetMet = reachedOn === null || target === undefined ? null : reachedOn <= target

  // ---- In words: facts and figures, never a pick ---------------------------------------------
  const lines: string[] = []
  if (income !== null && maxLoan !== null) {
    lines.push(
      `The Central Bank limit for a ${firstTimeBuyer ? 'first-time buyer' : 'second or later buyer'} is ${String(measures.loanToIncome)} times gross income: ${euro(maxLoan)} on ${euro(income)}${request.secondIncomeEur === undefined ? '' : ' (both incomes)'}. Lenders decide within it, and may lend above it only under the 15% allowance.`,
    )
  }
  if (price !== null && loan !== null && deposit !== null && needed !== null && stamp !== null) {
    lines.push(
      `${priceFrom === 'given' ? `For a ${euro(price)} home` : `The most the deposit by ${monthName(target ?? '')} and the income limit allow is about a ${euro(price)} home`}: a ${euro(loan)} mortgage (${String(round2((loan / price) * 100))}% of the price) and a ${euro(deposit)} deposit.`,
      `Needed at the keys: ${euro(needed)} (the deposit, ${euro(stamp)} stamp duty and about ${euro(BUYING_COSTS.legalAndSurveyEur)} for legal fees and a survey${helpToBuy > 0 ? `, less ${euro(helpToBuy)} Help to Buy` : ''}).`,
    )
    if (maxLoan !== null && priceFrom === 'given' && price * ltv > maxLoan) {
      lines.push(
        `At this income the loan is capped at ${euro(maxLoan)}, so the deposit is ${euro(deposit)} rather than ${String(Math.round((1 - ltv) * 100))}% of the price.`,
      )
    }
    lines.push(
      reachedOn === null
        ? `With ${euro(saved)} saved and nothing a month given, ${euro(needed)} is not reached.`
        : saved >= needed
          ? `${euro(saved)} saved already covers it.`
          : `At ${euro(monthly)} a month from ${euro(saved)}, that is saved around ${monthName(reachedOn)}, before interest${target === undefined ? '' : targetMet === true ? `: by ${monthName(target)}, the date given` : `: ${String(monthsBetween(target, reachedOn))} months after ${monthName(target)}, the date given`}.`,
    )
  }
  const monthlyCommitmentsNote =
    request.monthlyDebtRepaymentsEur === undefined || request.monthlyDebtRepaymentsEur === 0
      ? null
      : `Existing repayments of ${euro(request.monthlyDebtRepaymentsEur)} a month are not part of the Central Bank limits; lenders count them when they assess repayment capacity.`
  if (monthlyCommitmentsNote !== null) lines.push(monthlyCommitmentsNote)
  if (helpToBuyConditional) {
    lines.push(
      `Help to Buy is not counted above: up to ${euro(helpToBuyShown)}, it is limited by the Income Tax and DIRT paid over the last four tax years, not given.`,
    )
  }

  // ---- Every route to a home, after the headline ---------------------------------------------
  const routes = homeRoutes(
    {
      priceEur: price,
      propertyKind: request.propertyKind,
      firstTimeBuyer,
      incomeEur: income,
      applicants:
        income === null
          ? undefined
          : request.secondIncomeEur !== undefined && request.annualGrossIncomeEur !== undefined
            ? 'joint'
            : 'single',
      savedEur: saved,
      monthlyEur: monthly,
      taxPaidEur: request.taxPaidLastFourYearsEur,
      county: request.county,
      maxLoanEur: maxLoan,
      maxLtvPct: measures.maxLtvPct,
    },
    asOf,
  )

  const assumed: string[] = []
  if (request.firstTimeBuyer === undefined) {
    assumed.push(
      `First-time buyer, as nothing else was said: the ${String(MORTGAGE_MEASURES.first_time_buyer.loanToIncome)} times income limit applies (${String(MORTGAGE_MEASURES.second_and_subsequent.loanToIncome)} times for a second or later buyer).`,
    )
  }

  // ---- What is missing, as plain questions, most useful first --------------------------------
  const questions: HomeCalculatorResponse['questions'] = []
  const ask = (
    key: HomeCalculatorResponse['questions'][number]['key'],
    question: string,
    optional = false,
  ) => questions.push({ key, question, optional })
  if (request.depositSavedEur === undefined)
    ask('depositSavedEur', 'How much is saved towards the deposit so far?')
  if (request.monthlySavingEur === undefined)
    ask('monthlySavingEur', 'How much can be saved each month?')
  if (income === null)
    ask(
      'annualGrossIncomeEur',
      'What is the gross income a year, before tax? If buying with someone, theirs too.',
    )
  if (request.targetPriceEur === undefined)
    ask('targetPriceEur', 'Is there a price in mind for the home?')
  if (request.targetDate === undefined) ask('targetDate', 'When would you like the keys?')
  if (request.firstTimeBuyer === undefined)
    ask('firstTimeBuyer', 'Is this a first home (never owned one before)?')
  if (request.propertyKind === undefined)
    ask('propertyKind', 'A new build or second-hand? (Help to Buy is for new builds.)')
  if (request.currentBank === undefined)
    ask(
      'currentBank',
      'Who do you bank with now, and do you want to see only their options or every lender’s?',
    )
  if (request.rateType === undefined) ask('rateType', 'Fixed rate, variable, or show both?')
  if (request.monthlyRentEur === undefined)
    ask('monthlyRentEur', 'What do you pay in rent a month? (optional)', true)

  const next =
    'To see every eligible option, sorted by keys date, cost over the first 5 years or monthly repayment: the card’s "Show my options" button, or saoi_build_plan with a house_deposit goal, these figures, `homePrice`, `propertyKind` and `homePreferences`.'

  return {
    inputs: request,
    rules: {
      loanToIncome: measures.loanToIncome,
      maxLtvPct: measures.maxLtvPct,
      stampDutyPct: BUYING_COSTS.stampDutyPct,
      legalAndSurveyEur: BUYING_COSTS.legalAndSurveyEur,
      helpToBuy: {
        shareOfPrice: HELP_TO_BUY.shareOfPrice,
        capEur: HELP_TO_BUY.capEur,
        maxPriceEur: HELP_TO_BUY.maxPriceEur,
      },
      firstTimeBuyer: {
        loanToIncome: MORTGAGE_MEASURES.first_time_buyer.loanToIncome,
        maxLtvPct: MORTGAGE_MEASURES.first_time_buyer.maxLtvPct,
      },
      otherBuyer: {
        loanToIncome: MORTGAGE_MEASURES.second_and_subsequent.loanToIncome,
        maxLtvPct: MORTGAGE_MEASURES.second_and_subsequent.maxLtvPct,
      },
      sources: [
        MORTGAGE_MEASURES.source.url,
        BUYING_COSTS.stampDutySourceUrl,
        ...HELP_TO_BUY.sources.map((source) => source.url).slice(0, 1),
      ],
    },
    figures: {
      incomeEur: income,
      maxLoanEur: maxLoan,
      priceEur: price,
      priceFrom,
      loanEur: loan,
      ltvPct: price === null || loan === null ? null : round2((loan / price) * 100),
      depositNeededEur: deposit,
      stampDutyEur: stamp,
      legalAndSurveyEur: BUYING_COSTS.legalAndSurveyEur,
      helpToBuyEur: helpToBuyShown,
      helpToBuyConditional,
      neededAtKeysEur: needed,
      depositReachedOn: reachedOn,
      targetDateMet: targetMet,
      monthlyCommitmentsNote,
    },
    lines,
    assumed,
    routes,
    questions,
    next,
    presentation: [
      ...lines,
      ...routeLines(routes),
      ...assumed,
      ...(questions.length === 0
        ? []
        : [`Still to know: ${questions.map((item) => item.question).join(' ')}`]),
      next,
      ...MORTGAGE_WARNINGS,
      RESULT_STATEMENT,
    ],
    warnings: [...MORTGAGE_WARNINGS],
    statement: RESULT_STATEMENT,
  }
}
