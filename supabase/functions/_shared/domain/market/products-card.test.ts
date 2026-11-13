import { describe, expect, it } from 'vitest'
import { marketProductsCardSchema, type MarketProductsCard } from '../../contracts/cards.ts'
import { adviceWordsIn, MORTGAGE_WARNINGS, RESULT_STATEMENT } from '../../market/disclosures.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import {
  bonusTiming,
  caseFigures,
  productsCard,
  productsCardText,
  type ProductsResult,
} from './products-card.ts'
import { PRODUCTS_AS_OF, productsHoldings, productsPlan } from './products-card.fixture.ts'
import type { DepositTerms, ProductView } from '../../contracts/market-tools.ts'
import type { Market } from './types.ts'

const MARKET = normaliseMarket(MARKET_FIXTURE)
const FIGURES = caseFigures({
  plan: productsPlan(),
  holdings: productsHoldings(),
  fact: () => undefined,
})

function cardOf(result: ProductsResult): MarketProductsCard {
  if (result.kind !== 'card') throw new Error(`expected a card, got ${JSON.stringify(result)}`)
  return marketProductsCardSchema.parse(result.card)
}

describe('caseFigures: the plan, the holdings and the facts', () => {
  it('reads the claimed plan and prefers holdings for what is held', () => {
    expect(FIGURES).toMatchObject({
      monthlySavingEur: 1_000,
      keysMonth: '2028-07',
      keysFrom: 'plan',
      priceEur: 400_000,
      incomeEur: 110_000,
      firstTimeBuyer: null,
      newBuild: false,
      currentBank: 'AIB',
      sortBy: 'five_year_cost',
    })
    expect(FIGURES.held.map((account) => [account.label, account.kind, account.ratePct])).toEqual([
      ['BoI savings', 'savings', 0.5],
      ['Current account', 'current', null],
    ])
  })

  it('falls back to facts when there is no plan or holding', () => {
    const facts: Record<string, unknown> = {
      'assets.savingsBalance': 12_000,
      'goals.monthlySaving': 400,
      'goals.targetDate': '2027-09',
      'housing.purchasePrice': 300_000,
    }
    const figures = caseFigures({ plan: null, holdings: [], fact: (key) => facts[key] })
    expect(figures).toMatchObject({
      monthlySavingEur: 400,
      keysMonth: '2027-09',
      keysFrom: 'date_given',
      priceEur: 300_000,
    })
    expect(figures.held).toHaveLength(1)
  })
})

describe('productsCard: arranged by the question asked', () => {
  it('held_vs_market: their account on top as the baseline, the market by rate under it', () => {
    const card = cardOf(
      productsCard(MARKET, FIGURES, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF),
    )
    expect(card.arrangement.kind).toBe('held_vs_market')
    expect(card.arrangement.title).toBe('Your account against the market')
    expect(card.arrangement.line).toMatch(/Ask for them by access, or by the date, instead\./)
    expect(card.rows.length).toBeLessThanOrEqual(8)
    const [own, current, ...market] = card.rows
    expect(own).toMatchObject({ lead: 'Your BoI savings', value: '0.50%', held: true })
    expect(own?.figure).toMatch(/^€\d[\d,]* by Jul 2028$/)
    expect(current).toMatchObject({ lead: 'Your current account', held: true })
    expect(market.every((row) => !row.held)).toBe(true)
    // By rate, highest first.
    const rates = market.map((row) => Number(row.value.replace('%', '')))
    expect(rates).toEqual([...rates].sort((a, b) => b - a))
    expect(card.more).toBeGreaterThan(0)
    expect(card.basis.figures.join(' ')).toMatch(
      /BoI savings \(Bank of Ireland\): €20,000 at 0\.50%/,
    )
    expect(card.basis.coverage).toMatch(/savings and deposit accounts on the Irish market/)
    expect(card.statement).toBe(RESULT_STATEMENT)
  })

  it('by_access: instant access beside fixed term, the price of access stated', () => {
    const card = cardOf(productsCard(MARKET, FIGURES, { arrangement: 'by_access' }, PRODUCTS_AS_OF))
    expect(card.arrangement.title).toBe('Instant access against fixed term')
    const kinds = card.rows.map((row) => row.kind)
    expect(kinds).toContain('instant access')
    expect(kinds.some((kind) => /fixed$/.test(kind))).toBe(true)
    // Instant first, then fixed: the two sides are not interleaved.
    const firstFixed = kinds.findIndex((kind) => kind.endsWith('fixed'))
    expect(kinds.slice(firstFixed).every((kind) => kind.endsWith('fixed'))).toBe(true)
    expect(card.arrangement.line).toMatch(/price of access|access costs nothing here/)
  })

  it('fits_date: the six-month terms when the keys are more than six months away, bonus counted by the date', () => {
    const card = cardOf(productsCard(MARKET, FIGURES, { arrangement: 'fits_date' }, PRODUCTS_AS_OF))
    expect(card.question).toBe('Where can the deposit sit until the keys in July 2028?')
    expect(card.arrangement.title).toBe('Accounts that fit July 2028')
    const fixed = card.rows.filter((row) => row.kind.endsWith('fixed'))
    expect(fixed.length).toBeGreaterThan(0)
    expect(fixed.every((row) => row.kind === '6-month fixed')).toBe(true)
    expect(card.basis.objective).toMatch(/fixed terms are shown at six months/)
    expect(card.basis.assumptions.join(' ')).toMatch(/A bonus is counted in the total by the date/)
  })

  it('fits_date: the MortgageSaver bonus is paid after drawdown, so it is noted and not counted', () => {
    // Monthly saving only: CCPC states no lump sum MortgageSaver takes (2026-11-13), so with the
    // sum held it is not among the eight; on the monthly money alone it is.
    const monthlyOnly = { ...FIGURES, held: [] }
    const card = cardOf(
      productsCard(MARKET, monthlyOnly, { arrangement: 'fits_date' }, PRODUCTS_AS_OF),
    )
    const saver = card.rows.find((row) => row.lead === 'Bank of Ireland MortgageSaver Account')
    expect(saver).toBeDefined()
    expect(saver?.note).toBe('bonus paid after drawdown, not counted')
    // What it adds by July 2028 is its interest alone: the €2,000 bonus (€1,340 after DIRT) is not in it.
    const figure = Number(
      /^€([\d,]+) by Jul 2028$/.exec(saver?.figure ?? '')?.[1]?.replace(',', ''),
    )
    expect(figure).toBeGreaterThan(0)
    expect(figure).toBeLessThan(1_340)
    expect(productsCardText(card)).not.toMatch(/includes a €1,340 bonus/)
  })

  it('bonusTiming: after drawdown for a mortgage-linked saver, not stated otherwise', () => {
    const deposits = MARKET.products.filter((product) => product.terms.kind === 'deposit')
    // CCPC's row for it (`boi:savings.c583`), matched to the brochure's record by name.
    const saver = deposits.find((product) => product.id === 'boi:savings.c583')
    expect(saver).toBeDefined()
    if (saver === undefined || saver.terms.kind !== 'deposit') return
    expect(bonusTiming(saver, saver.terms, 20)).toBe('after_drawdown')
    const other = { ...saver, id: 'x:savings.other', provider: 'x' }
    const plain = { ...saver.terms, bonus: { amountEur: 100, conditions: ['Held for 12 months.'] } }
    expect(bonusTiming(other, plain, 20)).toBe('not_stated')
    const linked = {
      ...plain,
      bonus: {
        amountEur: 100,
        conditions: ['A mortgage drawn down with the same provider within 30 months.'],
      },
    }
    expect(bonusTiming(other, linked, 20)).toBe('after_drawdown')
  })

  it('reads a held label after "Your" in the customer’s own casing', () => {
    const own = (label: string) =>
      caseFigures({
        plan: null,
        holdings: [{ ...productsHoldings()[0]!, label }],
        fact: () => undefined,
      })
    const lead = (label: string) =>
      cardOf(productsCard(MARKET, own(label), { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF))
        .rows[0]?.lead
    expect(lead('Current account')).toBe('Your current account')
    expect(lead('BoI savings')).toBe('Your BoI savings')
    expect(lead('My rainy-day fund')).toBe('Your rainy-day fund')
  })

  it('fits_date: within six months, the longest term that ends by the keys', () => {
    const near = { ...FIGURES, keysMonth: '2027-03' }
    const card = cardOf(productsCard(MARKET, near, { arrangement: 'fits_date' }, PRODUCTS_AS_OF))
    for (const row of card.rows.filter((item) => item.kind.endsWith('fixed'))) {
      expect(Number(/^(\d+)-month/.exec(row.kind)?.[1] ?? 99)).toBeLessThanOrEqual(4)
    }
  })

  it('mortgage_by_sort: the lender options at their LTV, in the sort they chose, with the warnings', () => {
    const card = cardOf(
      productsCard(MARKET, FIGURES, { arrangement: 'mortgage_by_sort' }, PRODUCTS_AS_OF),
    )
    expect(card.arrangement.title).toBe('Mortgage options at 90% loan-to-value')
    expect(card.arrangement.line).toMatch(
      /^Arranged by cost over the first 5 years, lowest first, the order you chose\./,
    )
    expect(card.rows.length).toBeGreaterThan(0)
    for (const row of card.rows) {
      expect(row.value).toMatch(/^€[\d,]+\/mo$/)
      expect(row.figure).toMatch(/over 5 years$/)
      expect(row.held).toBe(false)
    }
    const costs = card.rows.map((row) => Number(row.figure.replace(/[^\d]/g, '').slice(0, -1)))
    expect(costs).toEqual([...costs].sort((a, b) => a - b))
    expect(card.basis.warnings).toEqual([...MORTGAGE_WARNINGS])
    expect(card.basis.figures[0]).toBe('a €400,000 home, €360,000 borrowed (90% of the price)')
  })

  it('mortgage_by_sort: another sort and the customer’s own filter', () => {
    const card = cardOf(
      productsCard(
        MARKET,
        FIGURES,
        {
          arrangement: 'mortgage_by_sort',
          sortBy: 'monthly_repayment',
          filters: { rateType: 'fixed' },
        },
        PRODUCTS_AS_OF,
      ),
    )
    const monthly = card.rows.map((row) => Number(row.value.replace(/[^\d]/g, '')))
    expect(monthly).toEqual([...monthly].sort((a, b) => a - b))
    expect(card.rows.every((row) => row.kind.includes('fixed'))).toBe(true)
    expect(card.basis.figures).toContain('Showing fixed rates only, as you asked.')
  })

  it('says nothing that advises, in any string it emits', () => {
    for (const arrangement of [
      'held_vs_market',
      'by_access',
      'fits_date',
      'mortgage_by_sort',
    ] as const) {
      const card = cardOf(productsCard(MARKET, FIGURES, { arrangement }, PRODUCTS_AS_OF))
      const text = productsCardText(card)
      expect(adviceWordsIn(text), arrangement).toEqual([])
      expect(text, arrangement).not.toMatch(/\b(best|should|recommended)\b/i)
    }
  })
})

describe('productsCard: no figures, no card', () => {
  it('returns the questions that would let it run', () => {
    const empty = caseFigures({ plan: null, holdings: [], fact: () => undefined })
    const result = productsCard(MARKET, empty, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF)
    expect(result.kind).toBe('questions')
    if (result.kind === 'questions') expect(result.questions.length).toBeGreaterThan(0)
  })

  it('asks for the price before a mortgage card, and the date before fits_date', () => {
    const noPrice = { ...FIGURES, priceEur: null }
    expect(
      productsCard(MARKET, noPrice, { arrangement: 'mortgage_by_sort' }, PRODUCTS_AS_OF),
    ).toEqual({ kind: 'questions', questions: ['What price of home are you looking at?'] })
    const noDate = { ...FIGURES, keysMonth: null }
    expect(productsCard(MARKET, noDate, { arrangement: 'fits_date' }, PRODUCTS_AS_OF).kind).toBe(
      'questions',
    )
  })
})

describe('productsCard: a rate states its period (2026-11-12)', () => {
  const NO_INSTRUCTION = /\b(check|ask|confirm)\w*/i

  /** The card and the model's figure basis for one row, by id. */
  function rowOf(result: ProductsResult, id: string) {
    const card = cardOf(result)
    const row = card.rows.find((item) => item.id === id)
    if (result.kind !== 'card') throw new Error('expected a card')
    const basis = result.figureBasis.find((item) => item.id === id)
    if (row === undefined || basis === undefined) {
      throw new Error(`no row ${id} in ${JSON.stringify(card.rows.map((item) => item.id))}`)
    }
    return { card, row, basis: basis.line }
  }

  const MOCO = 'moco:deposit.c8548'
  const BUNQ = 'bunq:deposit.c3147'

  /** MoCo's view as CCPC states it: the base the synthetic accounts below are built on. */
  function mocoView(): ProductView & { terms: DepositTerms } {
    const base = MARKET.products.find((product) => product.id === MOCO)
    if (base === undefined || base.terms.kind !== 'deposit') throw new Error('no MoCo row')
    return { ...base, terms: base.terms }
  }

  /**
   * A market with one more instant-access account on a threshold bonus, the shape bunq's own page
   * once described. CCPC states no such bonus, so nothing in the market has one since CCPC became
   * the only source (2026-11-13); the engine still reads it, and this keeps it covered.
   */
  function withThresholdBonus(): Market {
    const base = mocoView()
    const bonus: ProductView = {
      ...base,
      id: 'test:savings.threshold',
      name: 'Threshold Saver',
      provenance: { ...base.provenance, sourceUrl: 'https://example.ie/threshold-saver' },
      rateConfirmed: true,
      terms: {
        ...base.terms,
        aerPct: 3.11,
        bands: [{ fromEur: 0, toEur: null, aerPct: 3.11 }],
        thresholdBonus: {
          bonusAerPct: 3.11,
          resetMonths: [1, 7],
          lookbackMonths: 6,
          baseBands: [
            { fromEur: 0, toEur: 10_000, aerPct: 1.61 },
            { fromEur: 10_000, toEur: null, aerPct: 1.51 },
          ],
        },
        rateForNewAccounts: false,
      },
    }
    return { ...MARKET, products: [...MARKET.products, bonus] }
  }

  /** A market with one more instant-access account, an introductory rate on CCPC's figures. */
  function withIntro(thenAerPct: number | null): Market {
    const base = mocoView()
    const intro: ProductView = {
      ...base,
      id: 'test:savings.intro',
      provenance: { ...base.provenance, sourceUrl: 'https://example.ie/intro-saver' },
      name: 'Intro Saver',
      rateConfirmed: thenAerPct !== null,
      terms: {
        ...base.terms,
        aerPct: 4.5,
        bands: [{ fromEur: 0, toEur: null, aerPct: 4.5 }],
        introductory: { months: 6, thenAerPct },
        rateForNewAccounts: false,
      },
    }
    return { ...MARKET, products: [...MARKET.products, intro] }
  }

  it('a threshold bonus: the bonus to 1 January on the value, the rate after in the note and the basis', () => {
    const { row, basis } = rowOf(
      productsCard(
        withThresholdBonus(),
        FIGURES,
        { arrangement: 'held_vs_market' },
        PRODUCTS_AS_OF,
      ),
      'test:savings.threshold',
    )
    expect(row.value).toBe('3.11% to 1 Jan')
    expect(row.note).toBe('then 1.61% to €10,000 and 1.51% above; the money counts both')
    expect(row.figure).toMatch(/^€[\d,]+ by Jul 2028$/)
    const money = row.figure.split(' ')[0] ?? ''
    expect(basis).toBe(`${money} counts 3.11% to 1 January, then 1.61% to €10,000 and 1.51% above.`)
  })

  it('a threshold bonus with monthly saving: the bonus on money added after each reset is named', () => {
    const { row, basis } = rowOf(
      productsCard(withThresholdBonus(), FIGURES, { arrangement: 'fits_date' }, PRODUCTS_AS_OF),
      'test:savings.threshold',
    )
    expect(row.value).toBe('3.11% to 1 Jan')
    expect(basis).toMatch(
      /^€[\d,]+ counts 3\.11% to 1 January, then 1\.61% to €10,000 and 1\.51% above on what is held at each 1 January and 1 July, and 3\.11% on money added after it\.$/,
    )
  })

  it('an introductory rate with no rate after: the money stops at its end, and says so', () => {
    const { row, basis } = rowOf(
      productsCard(withIntro(null), FIGURES, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF),
      'test:savings.intro',
    )
    expect(row.value).toBe('4.50% to May 2027')
    expect(row.note).toBe('then not stated; the money stops at May 2027')
    expect(row.figure).toMatch(/^€[\d,]+ by May 2027$/)
    expect(row.confirmed).toBe(false)
    expect(basis).toMatch(
      /^€[\d,]+ counts 4\.50% to May 2027; the rate after is not stated, so the money stops there\.$/,
    )
  })

  it('an introductory rate with a stated rate after: the money counts both, to the date', () => {
    const { row, basis } = rowOf(
      productsCard(withIntro(1.5), FIGURES, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF),
      'test:savings.intro',
    )
    expect(row.value).toBe('4.50% to May 2027')
    expect(row.note).toBe('then 1.50%; the money counts both')
    expect(row.figure).toMatch(/^€[\d,]+ by Jul 2028$/)
    expect(basis).toMatch(/^€[\d,]+ counts 4\.50% to May 2027, then 1\.50%\.$/)
  })

  it('bunq as CCPC states it (2026-11-13): a rate for new accounts, how long it holds not stated', () => {
    // Its own page's bonus to 1 January is no longer read: CCPC's words say "for new customers"
    // and call it a bonus rate up to a threshold, with no end date and no rate after it.
    const { row, basis } = rowOf(
      productsCard(MARKET, FIGURES, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF),
      BUNQ,
    )
    expect(row.value).toBe('3.11%')
    expect(row.note).toBe('rate for new accounts; how long it holds is not stated')
    expect(row.confirmed).toBe(false)
    expect(basis).toMatch(
      /^€[\d,]+ counts 3\.11%, the rate for new accounts, to July 2028; how long it holds is not stated\.$/,
    )
  })

  it('a conditional rate in CCPC’s words: how long it holds is not stated, and the row is not confirmed', () => {
    const base = mocoView()
    const conditional: ProductView = {
      ...base,
      id: 'test:savings.conditional',
      name: 'Bonus Saver',
      provenance: { ...base.provenance, sourceUrl: 'https://example.ie/bonus-saver' },
      rateConfirmed: false,
      terms: { ...base.terms, aerPct: 4, bands: [{ fromEur: 0, toEur: null, aerPct: 4 }] },
    }
    const { row, basis } = rowOf(
      productsCard(
        { ...MARKET, products: [...MARKET.products, conditional] },
        FIGURES,
        { arrangement: 'held_vs_market' },
        PRODUCTS_AS_OF,
      ),
      'test:savings.conditional',
    )
    expect(row.note).toBe('a conditional rate in CCPC’s words; how long it holds is not stated')
    expect(row.confirmed).toBe(false)
    expect(basis).toMatch(/counts 4\.00% as CCPC states it, to July 2028; CCPC’s own words/)
    expect(basis).not.toMatch(/CCPC only|one figure/)
  })

  it('MoCo as CCPC states it: a variable rate, confirmed, no period', () => {
    const { row } = rowOf(
      productsCard(MARKET, FIGURES, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF),
      MOCO,
    )
    expect(row.value).toBe('2.10%')
    // Its one flag is the deposit guarantee abroad; nothing about how long the rate holds.
    expect(row.note).toBe('Austria deposit guarantee')
    expect(row.confirmed).toBe(true)
  })

  it('a rate that holds to the date: no period on the value', () => {
    // Keys in December: the bonus runs past the date, so nothing is stated against it.
    const december = { ...FIGURES, keysMonth: '2026-12' }
    const { row, basis } = rowOf(
      productsCard(
        withThresholdBonus(),
        december,
        { arrangement: 'held_vs_market' },
        PRODUCTS_AS_OF,
      ),
      'test:savings.threshold',
    )
    expect(row.value).toBe('3.11%')
    expect(row.note ?? '').not.toMatch(/then|stops|not stated/)
    expect(basis).toMatch(/^€[\d,]+ counts 3\.11%(, a variable rate,)? to December 2026\.$/)
  })

  it('a fixed term that ends before the date: as before, and the basis says the money stops', () => {
    const { row, basis } = rowOf(
      productsCard(MARKET, FIGURES, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF),
      'boi:deposit.ladder_advantage_fixed_term_account_25pct_access',
    )
    expect(row.value).toBe('2.48%')
    expect(row.note).toBe('interest to May 2028 only: the rate after is not stated')
    expect(basis).toMatch(
      /^€[\d,]+ counts 2\.48% for the 18-month term, to May 2028; the rate after is not stated, so the money stops there\.$/,
    )
  })

  it('states once what the money column counts', () => {
    const line =
      'The money column is interest after DIRT to July 2028, counting each rate for as long as the product states it and the rate after where stated; where the rate after is not stated the money stops there.'
    for (const arrangement of ['held_vs_market', 'by_access', 'fits_date'] as const) {
      const card = cardOf(productsCard(MARKET, FIGURES, { arrangement }, PRODUCTS_AS_OF))
      expect(card.basis.objective, arrangement).toContain(line)
    }
  })

  it('every new string is free of advice and instruction', () => {
    for (const market of [MARKET, withIntro(null), withIntro(1.5), withThresholdBonus()]) {
      for (const arrangement of ['held_vs_market', 'by_access', 'fits_date'] as const) {
        const result = productsCard(market, FIGURES, { arrangement }, PRODUCTS_AS_OF)
        const card = cardOf(result)
        if (result.kind !== 'card') continue
        expect(result.figureBasis.map((item) => item.id)).toEqual(card.rows.map((row) => row.id))
        const strings = [
          ...card.rows.flatMap((row) => [row.value, row.note ?? '']),
          ...result.figureBasis.map((item) => item.line),
          card.basis.objective,
        ]
        for (const text of strings) {
          expect(adviceWordsIn(text), text).toEqual([])
          expect(text).not.toMatch(NO_INSTRUCTION)
          expect(text).not.toMatch(/\b(best|should|recommended)\b/i)
        }
      }
    }
  })

  it('a mortgage card carries no figure basis: its figure is a cost, not interest', () => {
    const result = productsCard(
      MARKET,
      FIGURES,
      { arrangement: 'mortgage_by_sort' },
      PRODUCTS_AS_OF,
    )
    expect(result.kind === 'card' && result.figureBasis).toEqual([])
  })
})
