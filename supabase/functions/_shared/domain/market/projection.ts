import type {
  ProjectionLine,
  ProjectionRequest,
  ProjectionResponse,
  ProductView,
} from '../../contracts/market-tools.ts'
import { allocate, allocatable } from './allocate.ts'
import { attributionsOf, euro, oldestCheck } from './figures.ts'
import { MarketInputError, SAVINGS_ASSUMPTIONS, UNCONFIRMED_RATE } from './search.ts'
import { addMonths, round2, simulateDeposit } from './simulate.ts'
import type { AsOf, Market } from './types.ts'

/**
 * Savings month by month: named products with the amounts in each, or the best available split
 * of a lump sum and a monthly amount. Net of DIRT, within each product's monthly cap and tiers.
 *
 * Each line runs as far as its rates are known. The totals run only as far as every line is
 * known, and say where they stop; a goal is reported reached only within that window.
 */

const DEFAULT_MAX_ACCOUNTS = 5

export function resolveProduct(market: Market, id: string): ProductView {
  const viewId = market.products.some((product) => product.id === id)
    ? id
    : market.viewOfRow.get(id)
  const product = market.products.find((candidate) => candidate.id === viewId)
  if (product === undefined) throw new MarketInputError(`No product ${id}. Use an id from search.`)
  return product
}

export function project(
  market: Market,
  request: ProjectionRequest,
  asOf: AsOf,
): ProjectionResponse {
  const horizon = request.horizonMonths
  const assumptions = [...SAVINGS_ASSUMPTIONS]
  let basis: string

  let wanted: {
    product: ProductView
    lumpSum: number
    monthly: number
    termMonths?: number | undefined
  }[]
  if (request.lines !== undefined && request.lines.length > 0) {
    wanted = request.lines.map((line) => {
      const product = resolveProduct(market, line.productId)
      if (product.terms.kind !== 'deposit') {
        throw new MarketInputError(
          `${line.productId} is a ${product.category} product, not savings.`,
        )
      }
      return {
        product,
        lumpSum: line.lumpSum ?? 0,
        monthly: line.monthly ?? 0,
        termMonths: line.termMonths,
      }
    })
    basis = `The products and amounts given, over ${String(horizon)} months.`
  } else {
    const lumpSum = request.lumpSum ?? 0
    const monthly = request.monthly ?? 0
    if (lumpSum === 0 && monthly === 0) {
      throw new MarketInputError('Give `lines`, or a `lumpSum` or `monthly` amount to place.')
    }
    const pool = allocatable(market.products, {
      horizonMonths: horizon,
      lockAllowed: true,
    })
    const allocation = allocate(pool, {
      lumpSum,
      monthly,
      horizonMonths: horizon,
      lockAllowed: true,
      maxAccounts: DEFAULT_MAX_ACCOUNTS,
      asOf,
    })
    wanted = allocation.lines.map((line) => ({ ...line, termMonths: line.termMonths ?? undefined }))
    basis = `The best available split for the inputs given: the most interest after DIRT that can be known over ${String(horizon)} months, across at most ${String(DEFAULT_MAX_ACCOUNTS)} accounts.`
    if (allocation.unplaced.lumpSum > 0 || allocation.unplaced.monthly > 0) {
      assumptions.push(
        `Not placed: ${euro(allocation.unplaced.lumpSum)} of the lump sum and ${euro(allocation.unplaced.monthly)} a month (no product adds known interest for it within the limits).`,
      )
    }
  }

  const lines: ProjectionLine[] = wanted.map((line) => {
    const terms = line.product.terms
    if (terms.kind !== 'deposit') throw new MarketInputError('not savings')
    const simulation = simulateDeposit(terms, {
      lumpSum: line.lumpSum,
      monthly: line.monthly,
      horizonMonths: horizon,
      termMonths: line.termMonths,
      asOf,
    })
    const figures = simulation.figures
    const notes: string[] = []
    if (!line.product.rateConfirmed) notes.push(UNCONFIRMED_RATE)
    if (figures.stop !== null) notes.push(figures.stop.reason)
    if (figures.notPlaced.monthly > 0) {
      notes.push(
        `${euro(figures.notPlaced.monthly)} a month is above what it takes and is not projected.`,
      )
    }
    if (figures.notPlaced.lumpSum > 0) {
      notes.push(
        `${euro(figures.notPlaced.lumpSum)} of the lump sum cannot go here and is not projected.`,
      )
    }
    notes.push(
      ...line.product.unknowns.map((unknown) => `Not stated by the source: ${unknown.meaning}.`),
    )
    if (line.product.platform !== null) notes.push(line.product.platform.note)
    return {
      product: line.product,
      lumpSum: line.lumpSum,
      monthly: line.monthly,
      termMonths: figures.termMonths,
      figures,
      months: [...simulation.months],
      notes,
    }
  })

  const active = lines.filter((line) => line.figures.paidIn > 0)
  const knownThrough =
    active.length === 0 ? 0 : Math.min(...active.map((line) => line.figures.knownMonths))
  const totals = []
  for (let month = 1; month <= knownThrough; month += 1) {
    const rows = active.map((line) => line.months[month - 1])
    totals.push({
      month,
      date: addMonths(asOf, month),
      paidIn: round2(rows.reduce((sum, row) => sum + (row?.paidIn ?? 0), 0)),
      balance: round2(rows.reduce((sum, row) => sum + (row?.balance ?? 0), 0)),
      netInterest: round2(rows.reduce((sum, row) => sum + (row?.netInterest ?? 0), 0)),
    })
  }
  if (knownThrough < horizon && active.length > 0) {
    assumptions.push(
      `The totals stop at month ${String(knownThrough)}: a rate after that is not known for every line (see each line’s notes).`,
    )
  }
  const last = totals.at(-1)

  const target = request.targetAmount
  const reached =
    target === undefined ? null : (totals.find((row) => row.balance >= target) ?? null)

  return {
    lines,
    totals: {
      knownThroughMonth: knownThrough,
      months: totals,
      paidIn: last?.paidIn ?? 0,
      netInterest: last?.netInterest ?? 0,
      balance: last?.balance ?? 0,
    },
    goal:
      target === undefined
        ? null
        : {
            targetAmount: target,
            reachedMonth: reached?.month ?? null,
            reachedOn: reached?.date ?? null,
          },
    basis,
    assumptions,
    dataCheckedAt: oldestCheck(lines.map((line) => line.product)),
    attributions: attributionsOf(lines.map((line) => line.product)),
  }
}
