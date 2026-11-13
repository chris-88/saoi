import { describe, expect, it } from 'vitest'
import { marketProductsCardSchema, type MarketProductsCard } from '../../contracts/cards.ts'
import { adviceWordsIn, MORTGAGE_WARNINGS, RESULT_STATEMENT } from '../../market/disclosures.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import {
  bonusTiming,
  caseFigures,
  type CaseFigures,
  groupsInWords,
  heldIsRegularSaver,
  isRegularSaver,
  productsCard,
  productsCardText,
  type ProductsResult,
} from './products-card.ts'
import { PRODUCTS_AS_OF, productsHoldings, productsPlan } from './products-card.fixture.ts'
import { endsInTime, keysMonthWith, TERM_FIT_RULE, termThatFits } from './term-fit.ts'
import type { ProductView } from '../../contracts/market-tools.ts'
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
      monthlySavingEur: 1_100,
      keysMonth: '2028-07',
      keysFrom: 'plan',
      neededAtKeysEur: 47_000,
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
    expect(card.arrangement.line).toBe(
      'By rate, your own account first; ask for them by access, or by the date, instead.',
    )
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
    // Instant first, then fixed, then the regular savers on the monthly saving: never interleaved.
    const firstFixed = kinds.findIndex((kind) => kind.endsWith('fixed'))
    const firstRegular = kinds.indexOf('regular saver')
    expect(kinds.slice(0, firstFixed).every((kind) => kind === 'instant access')).toBe(true)
    expect(kinds.slice(firstFixed, firstRegular).every((kind) => kind.endsWith('fixed'))).toBe(true)
    expect(kinds.slice(firstRegular).every((kind) => kind === 'regular saver')).toBe(true)
    expect(card.basis.objective).toMatch(/price of access|access costs nothing here/)
    expect(card.arrangement.line).not.toMatch(/price of access/)
  })

  it('fits_date: each fixed term at the longest that ends a month before the keys, the rule in the basis', () => {
    const card = cardOf(productsCard(MARKET, FIGURES, { arrangement: 'fits_date' }, PRODUCTS_AS_OF))
    expect(card.question).toBe('Where can the deposit sit until the keys in July 2028?')
    expect(card.arrangement.title).toBe('Accounts that fit July 2028')
    const fixed = card.rows.filter((row) => row.kind.endsWith('fixed'))
    expect(fixed.length).toBeGreaterThan(0)
    // Bank of Ireland's 18 months ends May 2028, two months before the keys in July 2028; AIB's
    // 24 months would end November 2028, after them, so it is shown at one year.
    expect(fixed.find((row) => row.id === 'boi:savings.advantage_fixed')?.kind).toBe(
      '18-month fixed',
    )
    expect(
      fixed.find((row) => row.id === 'aib:deposit.ladder_personal_fixed_term_deposit')?.kind,
    ).toBe('1-year fixed')
    for (const row of card.rows) expect(row.figure).toMatch(/^keys [A-Z][a-z]{2} \d{4}, €[\d,]+$/)
    expect(card.basis.objective).toContain(TERM_FIT_RULE)
    expect(card.basis.figures).toContain('€47,000 needed at the keys')
    expect(card.basis.assumptions.join(' ')).toMatch(/A bonus is counted in the total by the date/)
  })

  it('fits_date: the MortgageSaver bonus is paid after drawdown, so it is noted and not counted', () => {
    const card = cardOf(
      productsCard(
        MARKET,
        FIGURES,
        { arrangement: 'fits_date', category: 'savings' },
        PRODUCTS_AS_OF,
      ),
    )
    const saver = card.rows.find((row) => row.lead === 'Bank of Ireland MortgageSaver account')
    expect(saver).toBeDefined()
    expect(saver?.note).toBe('bonus paid after drawdown, not counted')
    // What it adds by July 2028 is its interest alone: the €2,000 bonus (€1,340 after DIRT) is not in it.
    const figure = Number(
      /^keys [A-Z][a-z]{2} 2028, €([\d,]+)$/.exec(saver?.figure ?? '')?.[1]?.replace(',', ''),
    )
    expect(figure).toBeGreaterThan(0)
    expect(figure).toBeLessThan(1_340)
    expect(productsCardText(card)).not.toMatch(/includes a €1,340 bonus/)
  })

  it('bonusTiming: after drawdown for a mortgage-linked saver, not stated otherwise', () => {
    const deposits = MARKET.products.filter((product) => product.terms.kind === 'deposit')
    const saver = deposits.find((product) => product.id === 'boi:savings.mortgagesaver')
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

  it('fits_date: with only a date given, the longest term that ends a month before it', () => {
    const near = {
      ...FIGURES,
      keysMonth: '2027-06',
      keysFrom: 'date_given' as const,
      neededAtKeysEur: null,
    }
    const card = cardOf(productsCard(MARKET, near, { arrangement: 'fits_date' }, PRODUCTS_AS_OF))
    const fixed = card.rows.filter((item) => item.kind.endsWith('fixed'))
    expect(fixed.length).toBeGreaterThan(0)
    // Six months from November 2026 ends May 2027, a month before June.
    expect(fixed.every((row) => row.kind === '6-month fixed')).toBe(true)
    expect(card.basis.assumptions).toContain(
      'The cash needed at the keys is not known, so every account is set against June 2027.',
    )
  })

  it('mortgage_by_sort: the lender options at their LTV, in the sort they chose, with the warnings', () => {
    const card = cardOf(
      productsCard(MARKET, FIGURES, { arrangement: 'mortgage_by_sort' }, PRODUCTS_AS_OF),
    )
    expect(card.arrangement.title).toBe('Mortgage options at 90% loan-to-value')
    expect(card.arrangement.line).toMatch(
      /^Arranged by cost over the first 5 years, lowest first, the order you chose; ask for them by /,
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

  /** A market with one more instant-access account, an introductory rate on CCPC's figures. */
  function withIntro(thenAerPct: number | null): Market {
    const base = MARKET.products.find((product) => product.id === 'moco:savings.moco_easysaver')
    if (base === undefined || base.terms.kind !== 'deposit') throw new Error('no MoCo row')
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

  it('bunq: the bonus to 1 January on the value, the rate after in the note and the basis', () => {
    const { row, basis } = rowOf(
      productsCard(MARKET, FIGURES, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF),
      'bunq:savings.bunq_savings',
    )
    expect(row.value).toBe('3.11% to 1 Jan')
    expect(row.note).toBe('then 1.61% to €10,000 and 1.51% above; the money counts both')
    expect(row.figure).toMatch(/^€[\d,]+ by Jul 2028$/)
    const money = row.figure.split(' ')[0] ?? ''
    expect(basis).toBe(`${money} counts 3.11% to 1 January, then 1.61% to €10,000 and 1.51% above.`)
  })

  it('bunq with monthly saving: the bonus on money added after each reset is named', () => {
    const { row, basis } = rowOf(
      productsCard(MARKET, FIGURES, { arrangement: 'fits_date' }, PRODUCTS_AS_OF),
      'bunq:savings.bunq_savings',
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

  it('a rate for new accounts: how long it holds is not stated, and the row stays confirmed', () => {
    const { row, basis } = rowOf(
      productsCard(MARKET, FIGURES, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF),
      'moco:savings.moco_easysaver',
    )
    expect(row.value).toBe('2.10%')
    expect(row.note).toBe('rate for new accounts; how long it holds is not stated')
    expect(row.confirmed).toBe(true)
    expect(basis).toMatch(
      /^€[\d,]+ counts 2\.10%, the rate for new accounts, to July 2028; how long it holds is not stated\.$/,
    )
  })

  it('a rate that holds to the date: no period on the value', () => {
    // Keys in December: bunq's bonus runs past the date, so nothing is stated against it.
    const december = { ...FIGURES, keysMonth: '2026-12' }
    const { row, basis } = rowOf(
      productsCard(MARKET, december, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF),
      'bunq:savings.bunq_savings',
    )
    expect(row.value).toBe('3.11%')
    expect(row.note ?? '').not.toMatch(/then|stops|not stated/)
    expect(basis).toMatch(/^€[\d,]+ counts 3\.11%(, a variable rate,)? to December 2026\.$/)
  })

  it('a fixed term that ends before the date: as before, and the basis says the money stops', () => {
    const { row, basis } = rowOf(
      productsCard(MARKET, FIGURES, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF),
      'boi:savings.advantage_fixed',
    )
    expect(row.value).toBe('2.48%')
    expect(row.note).toBe('interest to May 2028 only: the rate after is not stated')
    expect(basis).toMatch(
      /^€[\d,]+ counts 2\.48% for the 18-month term, to May 2028; the rate after is not stated, so the money stops there\.$/,
    )
  })

  it('states once what the money column counts', () => {
    const line = (to: string) =>
      `The money column is interest after DIRT ${to}, counting each rate for as long as the product states it and the rate after where stated; where the rate after is not stated the money stops there.`
    for (const arrangement of ['held_vs_market', 'by_access'] as const) {
      const card = cardOf(productsCard(MARKET, FIGURES, { arrangement }, PRODUCTS_AS_OF))
      expect(card.basis.objective, arrangement).toContain(line('to July 2028'))
    }
    const fits = cardOf(productsCard(MARKET, FIGURES, { arrangement: 'fits_date' }, PRODUCTS_AS_OF))
    expect(fits.basis.objective).toContain(line('to the keys month each account gives'))
  })

  it('every new string is free of advice and instruction', () => {
    for (const market of [MARKET, withIntro(null), withIntro(1.5)]) {
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

describe('productsCard: a fixed term fits the keys its own interest gives (2026-11-13)', () => {
  /** The figure basis line for one row, by id. */
  const basisOf = (result: ProductsResult, id: string): string =>
    (result.kind === 'card' ? result.figureBasis : []).find((row) => row.id === id)?.line ?? ''

  /** €25,000 held and €100 a month towards €27,400: interest moves the keys by months. */
  const SLOW = { ...FIGURES, monthlySavingEur: 100, neededAtKeysEur: 27_400, keysMonth: '2028-10' }

  it('keeps the buffer: a term ending the month before the keys fits, one ending in the keys month does not', () => {
    // 19 months ends June 2028, 20 ends July 2028, and with either one's interest (about €700 on
    // €25,000, less than a month's €1,100) the €47,000 is there in July 2028.
    const base = MARKET.products.find((product) => product.id === 'boi:savings.advantage_fixed')
    if (base === undefined || base.terms.kind !== 'deposit') throw new Error('no BoI ladder')
    const ladder: ProductView = {
      ...base,
      id: 'test:deposit.ladder',
      provenance: { ...base.provenance, sourceUrl: 'https://example.ie/ladder' },
      name: 'Test Ladder',
      terms: {
        ...base.terms,
        ladder: [
          { months: 19, aerPct: 2.5, productId: 'deposit.ladder' },
          { months: 20, aerPct: 2.5, productId: 'deposit.ladder' },
        ],
      },
    }
    const market = { ...MARKET, products: [...MARKET.products, ladder] }
    const result = productsCard(market, FIGURES, { arrangement: 'fits_date' }, PRODUCTS_AS_OF)
    const row = cardOf(result).rows.find((item) => item.id === 'test:deposit.ladder')
    expect(row?.kind).toBe('19-month fixed')
    expect(row?.figure).toMatch(/^keys Jul 2028, €[\d,]+$/)
    expect(basisOf(result, 'test:deposit.ladder')).toContain(
      'The 19-month term ends June 2028; with its interest the keys come in July 2028.',
    )
    expect(endsInTime('2028-06', '2028-07')).toBe(true)
    expect(endsInTime('2028-07', '2028-07')).toBe(false)
  })

  it('a term its own interest pushes out is listed as not fitting, and the next shorter one is shown', () => {
    const result = productsCard(MARKET, SLOW, { arrangement: 'fits_date' }, PRODUCTS_AS_OF)
    const card = cardOf(result)
    // Bank of Ireland's 18 months at 2.48% ends May 2028, and with its interest the €27,400 is
    // there in May 2028: inside the term. Its 12 months is shown, with the keys in July 2028.
    const boi = card.rows.find((row) => row.id === 'boi:savings.advantage_fixed')
    expect(boi?.kind).toBe('1-year fixed')
    expect(boi?.figure).toMatch(/^keys Jul 2028, €[\d,]+$/)
    expect(basisOf(result, 'boi:savings.advantage_fixed')).toContain(
      'The 12-month term ends November 2027; with its interest the keys come in July 2028. 18 months ends May 2028; with its interest the keys come in May 2028.',
    )
    expect(card.basis.assumptions).toContain(
      'Bank of Ireland Advantage Fixed Term Deposit Account at 18 months does not fit: 18 months ends May 2028; with its interest the keys come in May 2028.',
    )
    // PTSB's 18 months at 2.00% brings the keys to June 2028: it ends a month before, and fits.
    expect(card.rows.find((row) => row.id === 'ptsb:deposit.c485')?.kind).toBe('18-month fixed')
  })

  it('sorts the fixed terms by their own keys month, then by money', () => {
    const card = cardOf(productsCard(MARKET, SLOW, { arrangement: 'fits_date' }, PRODUCTS_AS_OF))
    const fixed = card.rows.filter((row) => row.kind.endsWith('fixed'))
    const keys = fixed.map((row) => /^keys (\w{3} \d{4})/.exec(row.figure)?.[1] ?? '')
    const asMonth = (text: string) => new Date(`1 ${text}`).getTime()
    expect(keys.map(asMonth)).toEqual([...keys.map(asMonth)].sort((a, b) => a - b))
    expect(fixed[0]?.id).toBe('ptsb:deposit.c485')
  })

  it('by_access judges its fixed terms by the same rule', () => {
    const card = cardOf(productsCard(MARKET, SLOW, { arrangement: 'by_access' }, PRODUCTS_AS_OF))
    expect(card.rows.find((row) => row.id === 'boi:savings.advantage_fixed')?.kind).toBe(
      '1-year fixed',
    )
    expect(card.basis.objective).toContain(TERM_FIT_RULE)
    expect(card.basis.assumptions.join(' ')).toMatch(
      /at 18 months does not fit: 18 months ends May 2028; with its interest the keys come in May 2028\./,
    )
  })

  it('works out the keys month with the product’s own interest, the rest before interest', () => {
    const boi = MARKET.products.find((product) => product.id === 'boi:savings.advantage_fixed')
    if (boi === undefined || boi.terms.kind !== 'deposit') throw new Error('no BoI ladder')
    const run = {
      savedEur: 25_000,
      monthlyEur: 100,
      neededEur: 27_400,
      keysMonth: '2028-10',
      asOf: PRODUCTS_AS_OF,
    }
    expect(keysMonthWith(boi.terms, run, 6)).toBe('2028-10')
    expect(keysMonthWith(boi.terms, run, 18)).toBe('2028-05')
    expect(keysMonthWith(boi.terms, { ...run, neededEur: null }, 18)).toBe('2028-10')
    expect(keysMonthWith(boi.terms, { ...run, savedEur: 30_000 }, 18)).toBe('2026-11')
    expect(termThatFits(boi.terms, run)).toEqual({
      fit: { months: 12, endsOn: '2027-11', keysOn: '2028-07' },
      pushedOut: [{ months: 18, endsOn: '2028-05', keysOn: '2028-05' }],
    })
  })
})

describe('productsCard: each row’s key facts and detail (2026-11-13)', () => {
  const SAYS_TO = /\b(check|ask|confirm|contact)\b/i
  const rowOf = (card: MarketProductsCard, id: string) => {
    const row = card.rows.find((item) => item.id === id)
    if (row === undefined) throw new Error(`no row ${id}`)
    return row
  }

  it('bunq: the rate’s end and the guarantee to know, the money sentence and the source behind it', () => {
    const card = cardOf(productsCard(MARKET, FIGURES, { arrangement: 'by_access' }, PRODUCTS_AS_OF))
    const bunq = rowOf(card, 'bunq:savings.bunq_savings')
    expect(bunq.providerId).toBe('bunq')
    expect(bunq.brand).toEqual({ bg: '#008145', fg: '#fff' })
    expect(bunq.mustKnow).toEqual([
      'Rate ends 1 Jan, then 1.61% to €10,000 and 1.51% above',
      'Deposit guarantee: Netherlands, not Ireland',
    ])
    expect(bunq.detail?.[0]).toMatch(
      /^€[\d,]+ counts 3\.11% to 1 January, then 1\.61% to €10,000 and 1\.51% above\.$/,
    )
    expect(bunq.detail).toContain('From bunq’s own page, checked 9 November 2026.')
  })

  it('Bank of Ireland’s 18 months: locked until it ends, and no monthly saving', () => {
    const card = cardOf(productsCard(MARKET, FIGURES, { arrangement: 'by_access' }, PRODUCTS_AS_OF))
    const boi = rowOf(card, 'boi:savings.advantage_fixed')
    expect(boi.kind).toBe('18-month fixed')
    expect(boi.value).toBe('2.48%')
    expect(boi.mustKnow).toEqual([
      'Money locked until May 2028',
      'Monthly saving not accepted; lump sum only',
    ])
    expect(boi.detail?.[0]).toMatch(
      /The 18-month term ends May 2028; with its interest the keys come in July 2028\.$/,
    )
    expect(boi.detail).toContain('Lump sum from €5,000.')
  })

  it('a rate from CCPC alone, and who can open MoCo’s account, are facts to know', () => {
    const card = cardOf(productsCard(MARKET, FIGURES, { arrangement: 'by_access' }, PRODUCTS_AS_OF))
    expect(rowOf(card, 'aib:deposit.c843').mustKnow).toContain(
      'Rate from CCPC only; how long it holds is not stated',
    )
    expect(rowOf(card, 'moco:savings.moco_easysaver').mustKnow).toEqual([
      'Rate for new accounts; how long it holds is not stated',
      'Deposit guarantee: Austria, not Ireland',
      'Who can open it: aged 18 or over, resident in Ireland, not a US citizen, individuals only, no joint accounts',
    ])
  })

  it('their own account: the provider matched by name, its money sentence as the detail', () => {
    const card = cardOf(
      productsCard(MARKET, FIGURES, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF),
    )
    const [own, current] = card.rows
    expect(own).toMatchObject({ providerId: 'boi', brand: { bg: '#0000ff', fg: '#fff' } })
    expect(own?.mustKnow).toEqual([])
    expect(own?.detail?.[0]).toMatch(/^€\d+ counts 0\.50%, the rate given for it, on €20,000/)
    expect(current?.providerId).toBe('aib')
  })

  it('a mortgage: the fixed period and what follows, the cashback, the option in a sentence', () => {
    const card = cardOf(
      productsCard(MARKET, FIGURES, { arrangement: 'mortgage_by_sort' }, PRODUCTS_AS_OF),
    )
    for (const row of card.rows) {
      expect(row.providerId).toMatch(/^[a-z_]+$/)
      expect(row.mustKnow?.[0]).toMatch(/^(Fixed for \d+ years|A variable rate)/)
      expect(row.detail?.[0]).toContain(' a month')
    }
    const avant = card.rows.find((row) => row.providerId === 'avant_money')
    expect(avant?.mustKnow).toEqual([
      'Fixed for 4 years, then 3.95% variable',
      '€7,200 cashback counted in the cost',
      'Incentives from CCPC only',
    ])
  })

  it('every row of every arrangement keeps the limits, and says nothing that advises or instructs', () => {
    for (const arrangement of [
      'held_vs_market',
      'by_access',
      'fits_date',
      'mortgage_by_sort',
    ] as const) {
      const card = cardOf(productsCard(MARKET, FIGURES, { arrangement }, PRODUCTS_AS_OF))
      // The arrangement line is one short sentence: the arrangement and how to change it.
      expect(card.arrangement.line.split(/\.\s/)).toHaveLength(1)
      expect(card.arrangement.line.length).toBeLessThanOrEqual(170)
      for (const row of card.rows) {
        expect(row.mustKnow?.length ?? 0, row.id).toBeLessThanOrEqual(3)
        expect(row.detail?.length ?? 0, row.id).toBeLessThanOrEqual(6)
        expect(row.detail?.length ?? 0, row.id).toBeGreaterThan(0)
        for (const text of [...(row.mustKnow ?? []), ...(row.detail ?? [])]) {
          expect(adviceWordsIn(text), text).toEqual([])
          expect(text, text).not.toMatch(SAYS_TO)
          expect(text, text).not.toMatch(/\b(best|should|recommended)\b/i)
        }
      }
    }
  })

  it('a card stored before the key facts still parses, its rows without them', () => {
    const card = cardOf(productsCard(MARKET, FIGURES, { arrangement: 'by_access' }, PRODUCTS_AS_OF))
    const old = {
      ...card,
      rows: card.rows.map(({ providerId: _p, brand: _b, detail: _d, mustKnow: _m, ...row }) => row),
    }
    const parsed = marketProductsCardSchema.parse(old)
    expect(parsed.rows[0]?.detail).toBeUndefined()
    expect(parsed.rows[0]?.note).toBe(card.rows[0]?.note)
  })
})

describe('productsCard: the rows in groups (2026-11-13)', () => {
  /** Each group's rows as the card lists them, and the rows in group order. */
  function groupsOf(card: MarketProductsCard) {
    const groups = card.arrangement.groups ?? []
    const flat = groups.flatMap((group) => group.rowIds)
    expect(flat).toEqual(card.rows.map((row) => row.id))
    return groups.map((group) => ({
      label: group.label,
      rows: group.rowIds.map((id) => card.rows.find((row) => row.id === id)),
    }))
  }

  it('held_vs_market: theirs, then the market by rate', () => {
    const result = productsCard(MARKET, FIGURES, { arrangement: 'held_vs_market' }, PRODUCTS_AS_OF)
    const groups = groupsOf(cardOf(result))
    expect(groups.map((group) => group.label)).toEqual(['Yours', 'The market'])
    expect(groups[0]?.rows.every((row) => row?.held)).toBe(true)
    expect(groups[1]?.rows.every((row) => row?.held === false)).toBe(true)
    const rates = (groups[1]?.rows ?? []).map((row) => Number(row?.value.replace(/%.*/, '')))
    expect(rates).toEqual([...rates].sort((a, b) => b - a))
    if (result.kind === 'card') {
      expect(result.figureBasis.map((row) => row.id)).toEqual(result.card.rows.map((row) => row.id))
    }
  })

  it('by_access: instant access by rate, then fixed term by its keys month', () => {
    const groups = groupsOf(
      cardOf(productsCard(MARKET, FIGURES, { arrangement: 'by_access' }, PRODUCTS_AS_OF)),
    )
    expect(groups.map((group) => group.label)).toEqual([
      'Instant access',
      'Fixed term',
      'Regular saver',
    ])
    expect(groups[0]?.rows.every((row) => row?.kind === 'instant access')).toBe(true)
    expect(groups[2]?.rows.every((row) => row?.kind === 'regular saver')).toBe(true)
    expect(groups[1]?.rows.every((row) => row?.kind.endsWith('fixed'))).toBe(true)
    const rates = (groups[0]?.rows ?? []).map((row) => Number(row?.value.replace(/%.*/, '')))
    expect(rates).toEqual([...rates].sort((a, b) => b - a))
    const keys = (groups[1]?.rows ?? []).map((row) =>
      new Date(`1 ${/^keys (\w{3} \d{4})/.exec(row?.figure ?? '')?.[1] ?? ''}`).getTime(),
    )
    expect(keys).toEqual([...keys].sort((a, b) => a - b))
  })

  it('fits_date: fixed terms that end in time, then regular savers, then instant access and notice', () => {
    const groups = groupsOf(
      cardOf(productsCard(MARKET, FIGURES, { arrangement: 'fits_date' }, PRODUCTS_AS_OF)),
    )
    expect(groups.map((group) => group.label)).toEqual([
      'Fixed term',
      'Regular saver',
      'Instant access',
    ])
    expect(groups[1]?.rows.every((row) => row?.kind === 'regular saver')).toBe(true)
    expect(
      groupsInWords(
        cardOf(productsCard(MARKET, FIGURES, { arrangement: 'fits_date' }, PRODUCTS_AS_OF)),
      ),
    ).toBe('“Fixed term” (3 rows), “Regular saver” (3 rows) and “Instant access” (2 rows)')
    // With no monthly saving there is no regular saver group, and notice keeps its place.
    const lump = groupsOf(
      cardOf(
        productsCard(
          MARKET,
          { ...FIGURES, monthlySavingEur: null },
          { arrangement: 'fits_date' },
          PRODUCTS_AS_OF,
        ),
      ),
    )
    expect(lump.map((group) => group.label)).toEqual(['Fixed term', 'Instant access', 'Notice'])
    expect(lump[2]?.rows.every((row) => row?.kind.endsWith('notice'))).toBe(true)
  })

  it('mortgage_by_sort: one comparison, no groups', () => {
    const card = cardOf(
      productsCard(MARKET, FIGURES, { arrangement: 'mortgage_by_sort' }, PRODUCTS_AS_OF),
    )
    expect(card.arrangement.groups).toBeUndefined()
    expect(groupsInWords(card)).toBeNull()
  })

  it('a card stored before groups still parses as one list', () => {
    const card = cardOf(productsCard(MARKET, FIGURES, { arrangement: 'by_access' }, PRODUCTS_AS_OF))
    const { groups: _groups, ...arrangement } = card.arrangement
    expect(
      marketProductsCardSchema.parse({ ...card, arrangement }).arrangement.groups,
    ).toBeUndefined()
  })
})

describe('productsCard: by_access shows fits_date’s fixed terms (2026-11-13)', () => {
  /** The fixed-term rows of a card, as the customer sees them. */
  const fixedOf = (card: MarketProductsCard) =>
    card.rows
      .filter((row) => row.kind.endsWith('fixed'))
      .map(({ id, kind, value, figure, note, mustKnow, detail }) => ({
        id,
        kind,
        value,
        figure,
        note,
        mustKnow,
        detail,
      }))
  const fixedGroup = (card: MarketProductsCard) =>
    card.arrangement.groups?.find((group) => group.label === 'Fixed term')?.rowIds ?? []

  /** €25,000 held and €100 a month towards €27,400 by October 2028. */
  const SLOW = { ...FIGURES, monthlySavingEur: 100, neededAtKeysEur: 27_400, keysMonth: '2028-10' }

  it('the same fixed-term rows, with the same figures, on the fixture', () => {
    for (const figures of [FIGURES, SLOW]) {
      const byAccess = cardOf(
        productsCard(MARKET, figures, { arrangement: 'by_access' }, PRODUCTS_AS_OF),
      )
      const fits = cardOf(
        productsCard(MARKET, figures, { arrangement: 'fits_date' }, PRODUCTS_AS_OF),
      )
      expect(fixedOf(byAccess).length).toBeGreaterThan(0)
      expect(fixedOf(byAccess)).toEqual(fixedOf(fits))
      expect(fixedGroup(byAccess)).toEqual(fixedGroup(fits))
    }
  })

  /**
   * The live case (2026-11-13): €32,000 held, €1,000 a month, keys July 2028 with €52,500
   * needed. The fixed terms as the live market had them that day (CCPC and Bank of Ireland's
   * own page), with bunq's ladder, which the fixture does not carry.
   */
  const base = MARKET.products.find((product) => product.id === 'ptsb:deposit.c485')
  if (base === undefined || base.terms.kind !== 'deposit') throw new Error('no ptsb 18-month')
  const baseTerms = base.terms
  const fixedTerm = (
    id: string,
    provider: string,
    name: string,
    ladder: readonly (readonly [number, number])[],
  ): ProductView => ({
    ...base,
    id,
    provider,
    providerName: provider === 'boi' ? 'Bank of Ireland' : provider,
    name,
    category: 'deposit',
    terms: {
      ...baseTerms,
      aerPct: null,
      takesMonthly: false,
      ladder: ladder.map(([months, aerPct]) => ({ months, aerPct, productId: id })),
    },
  })
  const LIVE_MARKET: Market = {
    ...MARKET,
    products: [
      ...MARKET.products.filter(
        (product) => product.terms.kind !== 'deposit' || product.terms.access !== 'fixed_term',
      ),
      fixedTerm('boi:savings.advantage_fixed', 'boi', 'Advantage Fixed Term Deposit Account', [
        [6, 2.01],
        [12, 2.4],
        [18, 2.48],
      ]),
      fixedTerm('ptsb:deposit.c485', 'ptsb', '18 Month Fixed Term', [[18, 2]]),
      fixedTerm('bunq:deposit.ladder_bunq_term_deposits', 'bunq', 'bunq Term Deposits', [
        [3, 1.76],
        [6, 1.86],
        [12, 2.11],
        [24, 1.91],
      ]),
      fixedTerm('ptsb:deposit.ladder_fixed_term_deposit', 'ptsb', 'Fixed Term Deposit', [
        [6, 1.25],
        [12, 2],
        [36, 2],
        [60, 2],
      ]),
    ],
  }
  const LIVE = {
    ...FIGURES,
    held: [
      {
        label: 'Savings',
        provider: null,
        balance: 32_000,
        ratePct: null,
        kind: 'savings' as const,
      },
    ],
    monthlySavingEur: 1_000,
    neededAtKeysEur: 52_500,
    keysMonth: '2028-07',
  }
  const LIVE_AS_OF = '2026-11-13'

  it('the live figures: the 18-month terms fit, under “Fixed term”, as by the date', () => {
    const byAccess = cardOf(
      productsCard(LIVE_MARKET, LIVE, { arrangement: 'by_access' }, LIVE_AS_OF),
    )
    const fits = cardOf(productsCard(LIVE_MARKET, LIVE, { arrangement: 'fits_date' }, LIVE_AS_OF))
    expect(byAccess.arrangement.groups?.map((group) => group.label)).toEqual([
      'Instant access',
      'Fixed term',
      'Regular saver',
    ])
    const rows = fixedOf(byAccess)
    expect(rows.find((row) => row.id === 'boi:savings.advantage_fixed')).toMatchObject({
      kind: '18-month fixed',
      figure: 'keys Jul 2028, €802',
    })
    expect(rows.find((row) => row.id === 'ptsb:deposit.c485')).toMatchObject({
      kind: '18-month fixed',
      figure: 'keys Jul 2028, €646',
    })
    expect(rows).toEqual(fixedOf(fits))
    expect(fixedGroup(byAccess)).toEqual(fixedGroup(fits))
  })

  it('a card narrowed to savings still sets instant access against the fixed terms', () => {
    const card = cardOf(
      productsCard(
        LIVE_MARKET,
        LIVE,
        { arrangement: 'by_access', category: 'savings' },
        LIVE_AS_OF,
      ),
    )
    expect(fixedGroup(card)).toContain('boi:savings.advantage_fixed')
  })

  it('bunq’s year: the money stops at the term’s end, so its keys come a month after the plan’s', () => {
    for (const arrangement of ['by_access', 'fits_date'] as const) {
      const card = cardOf(productsCard(LIVE_MARKET, LIVE, { arrangement }, LIVE_AS_OF))
      const bunq = card.rows.find((row) => row.id === 'bunq:deposit.ladder_bunq_term_deposits')
      expect(bunq?.figure, arrangement).toMatch(/^keys Aug 2028, €[\d,]+$/)
      expect(bunq?.detail, arrangement).toContain(
        "Interest stops at Nov 2027, the end of the term; the keys then come in August 2028, a month after the plan's.",
      )
      for (const line of bunq?.detail ?? []) expect(adviceWordsIn(line), line).toEqual([])
      // A term whose keys are the plan's own carries no such line.
      const boi = card.rows.find((row) => row.id === 'boi:savings.advantage_fixed')
      expect(boi?.detail?.some((line) => line.startsWith('Interest stops'))).toBe(false)
    }
  })
})

describe('productsCard: the regular savers in their own group (2026-11-13)', () => {
  /**
   * The live case Chris saw (2026-11-13 16:00): €32,000 held, €1,000 a month, keys July 2028.
   * Bank of Ireland's SuperSaver and MortgageSaver were not on the card, and nothing said why.
   */
  const LIVE = {
    ...FIGURES,
    held: [
      {
        label: 'Savings',
        provider: null,
        balance: 32_000,
        ratePct: null,
        kind: 'savings' as const,
      },
    ],
    monthlySavingEur: 1_000,
    neededAtKeysEur: 52_500,
    keysMonth: '2028-07',
  }
  const LIVE_AS_OF = '2026-11-13'
  /** The fixture with the regular savers on CCPC's figure alone left out: Bank of Ireland's three. */
  const BOI_SAVERS: Market = {
    ...MARKET,
    products: MARKET.products.filter(
      (product) => !(isRegularSaver(product) && !product.rateConfirmed),
    ),
  }
  const card = (
    market: Market,
    arrangement: 'held_vs_market' | 'by_access' | 'fits_date',
    focus?: 'lump' | 'monthly',
    figures: CaseFigures = LIVE,
  ) =>
    cardOf(
      productsCard(
        market,
        figures,
        { arrangement, ...(focus === undefined ? {} : { focus }) },
        LIVE_AS_OF,
      ),
    )
  const group = (shown: MarketProductsCard, label: string) =>
    (shown.arrangement.groups?.find((item) => item.label === label)?.rowIds ?? []).map((id) =>
      shown.rows.find((row) => row.id === id),
    )
  const money = (figure: string | undefined) =>
    Number(/€([\d,]+)/.exec(figure ?? '')?.[1]?.replace(/,/g, '') ?? Number.NaN)
  const regularIds = new Set(MARKET.products.filter(isRegularSaver).map((product) => product.id))

  it('isRegularSaver: the accounts built for monthly saving, not those that take any lump sum', () => {
    const ids = MARKET.products.filter(isRegularSaver).map((product) => product.id)
    for (const id of [
      'boi:savings.supersaver',
      'boi:savings.goalsaver',
      'boi:savings.mortgagesaver',
      'aib:savings.c396',
      'ebs:savings.c122',
      'ptsb:savings.c39',
    ]) {
      expect(ids, id).toContain(id)
    }
    for (const id of [
      'bunq:savings.bunq_savings',
      'moco:savings.moco_easysaver',
      'boi:savings.instant_access',
      'boi:savings.advantage_fixed',
    ]) {
      expect(ids, id).not.toContain(id)
    }
  })

  it('a regular saver appears once, under “Regular saver”, by money, on both arrangements', () => {
    for (const figures of [FIGURES, LIVE]) {
      for (const arrangement of ['by_access', 'fits_date'] as const) {
        const shown = card(MARKET, arrangement, undefined, figures)
        const ids = shown.rows.map((row) => row.id)
        expect(new Set(ids).size, arrangement).toBe(ids.length)
        const regular = group(shown, 'Regular saver')
        expect(regular.length, arrangement).toBeGreaterThan(0)
        for (const row of shown.rows) {
          // In the regular saver group if and only if it is a regular saver.
          expect(row.kind === 'regular saver', row.id).toBe(regularIds.has(row.id))
        }
        const amounts = regular.map((row) => money(row?.figure))
        expect(amounts).toEqual([...amounts].sort((a, b) => b - a))
      }
    }
    expect(card(MARKET, 'by_access').arrangement.groups?.map((item) => item.label)).toEqual([
      'Instant access',
      'Fixed term',
      'Regular saver',
    ])
    expect(card(MARKET, 'fits_date').arrangement.groups?.map((item) => item.label)).toEqual([
      'Fixed term',
      'Regular saver',
      'Instant access',
    ])
  })

  it('the live figures: the regular savers judged on the €1,000 a month, and the card says what it set aside', () => {
    const byAccess = card(MARKET, 'by_access')
    expect(group(byAccess, 'Regular saver').map((row) => [row?.id, row?.figure])).toEqual([
      ['ebs:savings.c122', '€354 by Jul 2028'],
      ['aib:savings.c396', '€297 by Jul 2028'],
    ])
    expect(byAccess.basis.coverage).toContain(
      '6 regular savers are judged on the €1,000 a month alone and shown in their own group, 4 of them not on the card for room: Bank of Ireland SuperSaver Account, ptsb Online Regular Saver Account (Variable), Bank of Ireland GoalSaver Account and Bank of Ireland MortgageSaver account; ',
    )
    expect(byAccess.basis.coverage).toContain(
      '1 account takes under half of the €32,000 and is left out: Bankinter Deposit Plus 12 Month Fixed Term Account 25% Access',
    )
    expect(byAccess.basis.objective).toContain(
      'Regular savers last, by interest after DIRT on the €1,000 a month alone, highest first.',
    )
    // `more` stays card-level: every account compared, less the rows shown.
    expect(byAccess.more).toBe(6)

    const fits = card(MARKET, 'fits_date')
    expect(group(fits, 'Regular saver').map((row) => [row?.id, row?.figure])).toEqual([
      ['ebs:savings.c122', 'keys Jul 2028, €354'],
      ['aib:savings.c396', 'keys Jul 2028, €297'],
      ['boi:savings.supersaver', 'keys Jul 2028, €279'],
    ])
    expect(fits.basis.coverage).toContain(
      '6 regular savers are judged on the €1,000 a month alone and shown in their own group, 3 of them not on the card for room: ptsb Online Regular Saver Account (Variable), Bank of Ireland GoalSaver Account and Bank of Ireland MortgageSaver account',
    )
    for (const shown of [byAccess, fits]) {
      expect(adviceWordsIn(productsCardText(shown))).toEqual([])
    }
  })

  /** SuperSaver's row: the rate's period and what follows, the money on the monthly saving alone. */
  const SUPERSAVER = {
    id: 'boi:savings.supersaver',
    lead: 'Bank of Ireland SuperSaver Account',
    kind: 'regular saver',
    value: '3.00% to Nov 2027',
    note: 'then 2.00%; the money counts both',
    mustKnow: [
      'Rate ends Nov 2027, then 2.00%',
      'Monthly payments only; the €32,000 needs another account',
    ],
  }
  const MORTGAGESAVER = {
    id: 'boi:savings.mortgagesaver',
    lead: 'Bank of Ireland MortgageSaver account',
    kind: 'regular saver',
    value: '2.00%',
    note: 'bonus paid after drawdown, not counted',
    mustKnow: [
      'Also takes up to €20,000 as a lump sum, at 0.50%; not counted here',
      'Bonus paid after the mortgage is drawn down; not counted',
    ],
  }

  it('SuperSaver and MortgageSaver: their rows in the group, with the figures and the must-knows', () => {
    const cases = [
      { shown: card(BOI_SAVERS, 'fits_date'), keys: true },
      { shown: card(BOI_SAVERS, 'fits_date', 'monthly'), keys: true },
      { shown: card(BOI_SAVERS, 'by_access', 'monthly'), keys: false },
    ]
    for (const { shown, keys } of cases) {
      const regular = group(shown, 'Regular saver')
      expect(regular.map((row) => row?.id)).toEqual([
        'boi:savings.supersaver',
        'boi:savings.goalsaver',
        'boi:savings.mortgagesaver',
      ])
      const superSaver = regular[0]
      const mortgageSaver = regular[2]
      expect(superSaver).toMatchObject({
        ...SUPERSAVER,
        figure: keys ? 'keys Jul 2028, €279' : '€279 by Jul 2028',
      })
      expect(superSaver?.detail?.slice(0, 2)).toEqual([
        '€279 counts 3.00% to November 2027, then 2.00%. It counts the €1,000 a month alone, not the €32,000 held.',
        'Monthly saving from €5 up to €2,500.',
      ])
      expect(mortgageSaver).toMatchObject({
        ...MORTGAGESAVER,
        figure: keys ? 'keys Jul 2028, €222' : '€222 by Jul 2028',
      })
      expect(mortgageSaver?.detail?.[0]).toBe(
        '€222 counts its balance-band rates, up to 2.00%, to July 2028. The €1,340 bonus is paid after drawdown and is not counted. It counts the €1,000 a month alone, not the €32,000 held.',
      )
      expect(mortgageSaver?.detail?.[1]).toMatch(
        /^Monthly saving from €200 up to €2,500; lump sum up to €20,000;/,
      )
    }
    // Not in the lump-sum groups: on by_access, the room goes to the top two by money, and
    // MortgageSaver is named in the coverage.
    const byAccess = card(BOI_SAVERS, 'by_access')
    for (const label of ['Instant access', 'Fixed term']) {
      const ids = group(byAccess, label).map((row) => row?.id)
      expect(ids).not.toContain('boi:savings.supersaver')
      expect(ids).not.toContain('boi:savings.mortgagesaver')
    }
    expect(group(byAccess, 'Regular saver')[0]).toMatchObject({
      ...SUPERSAVER,
      figure: '€279 by Jul 2028',
    })
    expect(byAccess.basis.coverage).toContain(
      '3 regular savers are judged on the €1,000 a month alone and shown in their own group, 1 of them not on the card for room: Bank of Ireland MortgageSaver account',
    )
  })

  it('without a monthly saving, no group: a regular saver stays under the lump-sum rule', () => {
    const shown = card(MARKET, 'by_access', undefined, { ...LIVE, monthlySavingEur: null })
    expect(shown.arrangement.groups?.map((item) => item.label)).toEqual([
      'Instant access',
      'Fixed term',
    ])
    // MortgageSaver takes €20,000 of the sum, so it is set against it as before; SuperSaver
    // takes no lump sum.
    expect(shown.rows.some((row) => row.kind === 'regular saver')).toBe(false)
    expect(shown.rows.find((row) => row.id === 'boi:savings.mortgagesaver')?.kind).toBe(
      'instant access',
    )
    expect(shown.rows.map((row) => row.id)).not.toContain('boi:savings.supersaver')
    expect(shown.basis.coverage).not.toMatch(/regular saver/)
    expect(shown.basis.coverage).toContain(
      '1 account takes under half of the €32,000 and is left out: Bankinter Deposit Plus 12 Month Fixed Term Account 25% Access',
    )
  })

  it('held_vs_market: their own regular saver brings the market’s regular savers beside it', () => {
    const own = {
      ...LIVE,
      held: [
        {
          label: 'BoI SuperSaver',
          provider: 'Bank of Ireland',
          balance: 6_000,
          ratePct: 3,
          kind: 'savings' as const,
        },
        ...LIVE.held,
      ],
    }
    expect(heldIsRegularSaver(MARKET, own.held[0]!)).toBe(true)
    expect(heldIsRegularSaver(MARKET, LIVE.held[0]!)).toBe(false)
    const shown = card(MARKET, 'held_vs_market', undefined, own)
    expect(shown.arrangement.groups?.map((item) => item.label)).toEqual([
      'Yours',
      'Regular saver',
      'The market',
    ])
    expect(group(shown, 'The market').some((row) => regularIds.has(row?.id ?? ''))).toBe(false)
    expect(shown.basis.coverage).toMatch(/regular savers are judged on the €1,000 a month alone/)
    // Their account a plain savings account: as before.
    expect(card(MARKET, 'held_vs_market').arrangement.groups?.map((item) => item.label)).toEqual([
      'Yours',
      'The market',
    ])
  })
})

describe('productsCard: a card on the monthly saving (focus “monthly”, 2026-11-13)', () => {
  const LIVE = {
    ...FIGURES,
    held: [
      {
        label: 'Savings',
        provider: null,
        balance: 32_000,
        ratePct: null,
        kind: 'savings' as const,
      },
    ],
    monthlySavingEur: 1_000,
    neededAtKeysEur: 52_500,
    keysMonth: '2028-07',
  }
  const monthly = (arrangement: 'by_access' | 'fits_date', figures: CaseFigures = LIVE) =>
    productsCard(MARKET, figures, { arrangement, focus: 'monthly' }, '2026-11-13')

  it('the accounts for the monthly saving, regular savers first, fixed terms left out, on both arrangements', () => {
    const fits = cardOf(monthly('fits_date'))
    const byAccess = cardOf(monthly('by_access'))
    for (const shown of [fits, byAccess]) {
      expect(shown.arrangement.title).toBe('Accounts for your €1,000 a month')
      expect(shown.arrangement.line).toBe(
        'By what each account earns on the €1,000 a month to the keys in July 2028, regular savers first; ask about the sum held, by access or by the date, instead.',
      )
      expect(shown.question).toBe('Where can the €1,000 a month go until the keys in July 2028?')
      expect(shown.arrangement.groups?.map((item) => item.label)).toEqual([
        'Regular saver',
        'Instant access',
        'Notice',
      ])
      expect(shown.rows.some((row) => row.kind.endsWith('fixed'))).toBe(false)
      expect(shown.rows.map((row) => row.id)).toEqual([
        'ebs:savings.c122',
        'aib:savings.c396',
        'boi:savings.supersaver',
        'ptsb:savings.c39',
        'moco:savings.moco_easysaver',
        'bunq:savings.bunq_savings',
        'ptsb:deposit.c6017',
        'boi:deposit.c505',
      ])
      expect(shown.basis.figures).toContain('€32,000 held, not counted on this card')
      expect(shown.basis.coverage).toBe(
        "13 savings accounts on the Irish market take the €1,000 a month, from CCPC's comparison tables and the providers' own pages, the oldest figure checked 2026-11-09; 6 regular savers are shown in their own group, 2 of them not on the card for room: Bank of Ireland GoalSaver Account and Bank of Ireland MortgageSaver account; 6 fixed terms take lump sums only and are left out; 1 more left out (the most for: for children or students).",
      )
      expect(shown.more).toBe(5)
      expect(shown.arrangement.line.split(/\.\s/)).toHaveLength(1)
      expect(shown.arrangement.line.length).toBeLessThanOrEqual(170)
      for (const row of shown.rows) {
        expect(row.mustKnow?.length ?? 0, row.id).toBeLessThanOrEqual(3)
        expect(row.detail?.length ?? 0, row.id).toBeLessThanOrEqual(6)
      }
      expect(adviceWordsIn(productsCardText(shown))).toEqual([])
    }
    // The same rows and money on both; only the figure's form differs.
    expect(fits.rows.map((row) => money(row.figure))).toEqual(
      byAccess.rows.map((row) => money(row.figure)),
    )
    expect(fits.rows[0]?.figure).toBe('keys Jul 2028, €354')
    expect(byAccess.rows[0]?.figure).toBe('€354 by Jul 2028')
    // Instant access judged on the monthly saving alone: MoCo's €247, not its €1,002 on both.
    expect(fits.rows.find((row) => row.id === 'moco:savings.moco_easysaver')?.figure).toBe(
      'keys Jul 2028, €247',
    )
    const result = monthly('fits_date')
    if (result.kind === 'card') {
      for (const row of result.figureBasis) expect(adviceWordsIn(row.line), row.line).toEqual([])
      expect(result.figureBasis.map((row) => row.id)).toEqual(result.card.rows.map((row) => row.id))
    }
  })

  it('asks for the monthly saving when there is none', () => {
    expect(monthly('fits_date', { ...LIVE, monthlySavingEur: null })).toEqual({
      kind: 'questions',
      questions: ['How much goes aside each month?'],
    })
  })

  const money = (figure: string | undefined) =>
    Number(/€([\d,]+)/.exec(figure ?? '')?.[1]?.replace(/,/g, '') ?? Number.NaN)
})
