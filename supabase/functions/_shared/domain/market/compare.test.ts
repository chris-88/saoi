import { describe, expect, it } from 'vitest'
import {
  cardSchema,
  productComparisonCardSchema,
  type ProductComparisonCard,
} from '../../contracts/cards.ts'
import { adviceWordsIn, RESULT_STATEMENT } from '../../market/disclosures.ts'
import { compareProducts, comparisonCardText, type ComparisonResult } from './compare.ts'
import { MARKET_FIXTURE } from './fixture.ts'
import { normaliseMarket } from './normalise.ts'
import { caseFigures, productsCard } from './products-card.ts'
import { PRODUCTS_AS_OF, productsHoldings, productsPlan } from './products-card.fixture.ts'

const MARKET = normaliseMarket(MARKET_FIXTURE)
const FIGURES = caseFigures({
  plan: productsPlan(),
  holdings: productsHoldings(),
  fact: () => undefined,
})

const BUNQ = 'bunq:savings.bunq_savings'
const SUPERSAVER = 'boi:savings.supersaver'
const BOI_FIXED = 'boi:savings.advantage_fixed'
const AIB_FIXED = 'aib:deposit.ladder_personal_fixed_term_deposit'

function cardOf(result: ComparisonResult): ProductComparisonCard {
  if (result.kind !== 'card') throw new Error(`expected a card, got ${JSON.stringify(result)}`)
  return productComparisonCardSchema.parse(result.card)
}

const compare = (...ids: string[]) => cardOf(compareProducts(MARKET, FIGURES, ids, PRODUCTS_AS_OF))

const rowOf = (card: ProductComparisonCard, label: string) => {
  const row = card.rows.find((item) => item.label === label)
  if (row === undefined) throw new Error(`no row ${label}`)
  return row
}

/** Words that tell the customer what to do, or rank one for them (CLAUDE.md, the lines Saoi holds). */
const INSTRUCTION =
  /\b(you should|best|better|recommend\w*|go with|choose|switch|open (it|one|an?)|move (it|the)|clear|make sure|be aware|worth checking|don't|do not)\b/i

function heldToTheLine(card: ProductComparisonCard) {
  const text = comparisonCardText(card)
  expect(adviceWordsIn(text)).toEqual([])
  // The facts and the question Saoi writes: no instruction, no ranking.
  for (const line of [card.title, ...card.differences, card.decides]) {
    expect(line, line).not.toMatch(INSTRUCTION)
  }
  for (const line of [
    ...card.mustKnow.flatMap((item) => item.facts),
    ...card.mustKnow.flatMap((item) => item.detail ?? []),
  ]) {
    expect(adviceWordsIn(line), line).toEqual([])
    expect(line, line).not.toMatch(/\b(check|ask|confirm|contact)\b/i)
  }
}

describe('the product_comparison card contract', () => {
  it('is one of the cards a turn can stream, and not one that waits on a tap', () => {
    const card = compare(BUNQ, SUPERSAVER)
    expect(cardSchema.parse(card)).toEqual(card)
    expect(card.statement).toBe(RESULT_STATEMENT)
  })

  it('takes two or three columns, and one value per column in every row', () => {
    const card = compare(BUNQ, SUPERSAVER)
    expect(
      productComparisonCardSchema.safeParse({ ...card, columns: card.columns.slice(0, 1) }).success,
    ).toBe(false)
    const [first] = card.rows
    expect(first).toBeDefined()
    expect(
      productComparisonCardSchema.safeParse({
        ...card,
        rows: [{ ...first, values: ['a', 'b', 'c'] }, ...card.rows.slice(1)],
      }).success,
    ).toBe(false)
  })
})

describe('compareProducts: bunq against SuperSaver (instant access against a regular saver)', () => {
  const card = compare(BUNQ, SUPERSAVER)

  it('keeps the columns in the order selected, named and branded', () => {
    expect(card.title).toBe('bunq Savings Account against Bank of Ireland SuperSaver Account')
    expect(card.columns).toEqual([
      {
        rowId: BUNQ,
        lead: 'bunq Savings Account',
        providerId: 'bunq',
        brand: { bg: '#008145', fg: '#fff' },
        kind: 'instant access',
      },
      expect.objectContaining({ rowId: SUPERSAVER, providerId: 'boi', kind: 'instant access' }),
    ])
    // Selected the other way round, the columns and every row's values follow.
    const swapped = compare(SUPERSAVER, BUNQ)
    expect(swapped.columns.map((column) => column.rowId)).toEqual([SUPERSAVER, BUNQ])
    for (const [index, row] of swapped.rows.entries()) {
      expect(row.values).toEqual([...(card.rows[index]?.values ?? [])].reverse())
    }
  })

  it('sets the fixed rows side by side, marking what differs', () => {
    expect(card.rows.map((row) => row.label)).toEqual([
      'Rate',
      'Rate period',
      'Money by July 2028',
      'Access',
      'Takes monthly payments',
      'Lump sum',
      'Caps',
      'Deposit guarantee',
      'Source, checked',
    ])
    expect(rowOf(card, 'Rate').values).toEqual(['3.11% to 1 Jan', '3.00% to Nov 2027'])
    expect(rowOf(card, 'Rate period').values).toEqual([
      'To 1 January, then 1.61% to €10,000 and 1.51% above',
      'To November 2027, then 2.00%',
    ])
    expect(rowOf(card, 'Access')).toEqual({
      label: 'Access',
      values: ['Instant access', 'Instant access'],
      differs: false,
    })
    expect(rowOf(card, 'Takes monthly payments')).toEqual({
      label: 'Takes monthly payments',
      values: ['Yes', 'Yes, €5 to €2,500 a month'],
      differs: true,
    })
    expect(rowOf(card, 'Lump sum')).toEqual({
      label: 'Lump sum',
      values: ['Yes', 'No'],
      differs: true,
    })
    expect(rowOf(card, 'Caps').values).toEqual([
      'None stated',
      '€2,500 a month; 3.00% to €30,000 and 0.50% above',
    ])
    expect(rowOf(card, 'Deposit guarantee').values).toEqual([
      'Netherlands, to €100,000 a person',
      'Ireland, to €100,000 a person',
    ])
    expect(rowOf(card, 'Source, checked').values).toEqual([
      'bunq’s own page, 9 Nov 2026',
      'Bank of Ireland’s own page, 9 Nov 2026',
    ])
    for (const row of card.rows) expect(row.differs).toBe(new Set(row.values).size > 1)
  })

  it('works the money on the products card’s rules: placed where each takes it, periods as stated', () => {
    const [bunq, superSaver] = rowOf(card, 'Money by July 2028').values
    expect(bunq).toMatch(/^€\d[\d,]*$/)
    expect(superSaver).toMatch(/^€\d[\d,]*$/)
    // SuperSaver takes no lump sum: its money is the monthly saving's alone.
    const [bunqDetail, superDetail] = card.mustKnow.map((item) => item.detail ?? [])
    expect(bunqDetail?.[0]).toBe(
      `${bunq ?? ''} by July 2028 counts 3.11% to 1 January, then 1.61% to €10,000 and 1.51% above, on both the €25,000 held and €1,100 a month.`,
    )
    expect(superDetail?.[0]).toBe(
      `${superSaver ?? ''} by July 2028 counts 3.00% to November 2027, then 2.00%, on €1,100 a month, not the €25,000 held.`,
    )
  })

  it('states the differences as facts and puts the one question that separates them', () => {
    expect(card.differences).toContain(
      'bunq Savings Account takes both the €25,000 held and €1,100 a month; Bank of Ireland SuperSaver Account takes €1,100 a month, not the €25,000 held.',
    )
    expect(card.differences).toContain(
      'In bunq Savings Account, the rate ends 1 January, then 1.61% to €10,000 and 1.51% above; in Bank of Ireland SuperSaver Account, the rate ends November 2027, then 2.00%.',
    )
    expect(card.differences).toContain(
      'The deposit guarantee is from the Netherlands in bunq Savings Account and from Ireland in Bank of Ireland SuperSaver Account.',
    )
    expect(
      card.differences.some((line) => /^By July 2028 the interest after DIRT is/.test(line)),
    ).toBe(true)
    expect(card.decides).toBe(
      'Is this account for the €25,000 already saved, the €1,100 a month from here, or both?',
    )
  })

  it('carries each row’s must-knows and detail as the products card has them', () => {
    const fits = productsCard(MARKET, FIGURES, { arrangement: 'fits_date' }, PRODUCTS_AS_OF)
    if (fits.kind !== 'card') throw new Error('expected the fits_date card')
    const bunqRow = fits.card.rows.find((row) => row.id === BUNQ)
    expect(card.mustKnow).toEqual([
      { rowId: BUNQ, facts: bunqRow?.mustKnow, detail: expect.any(Array) as unknown },
      expect.objectContaining({ rowId: SUPERSAVER }),
    ])
    expect(card.mustKnow[0]?.facts).toContain('Deposit guarantee: Netherlands, not Ireland')
    // A regular saver's must-knows are its Regular saver row's own (2026-11-13), never the
    // lump-sum wording.
    const superRow = fits.card.rows.find((row) => row.id === SUPERSAVER)
    expect(superRow?.kind).toBe('regular saver')
    expect(card.mustKnow[1]?.facts).toEqual(superRow?.mustKnow)
    expect(card.mustKnow[1]?.facts).toContain(
      'Monthly payments only; the €25,000 needs another account',
    )
    expect(card.mustKnow[1]?.facts.join(' ')).not.toMatch(/above what it takes/)
    // The detail is the row's own, beside its facts, its money sentence restated on the
    // comparison's figures.
    const bunqDetail = card.mustKnow[0]?.detail ?? []
    expect(bunqDetail).toContain('From bunq’s own page, checked 9 November 2026.')
    expect(bunqDetail.length).toBeLessThanOrEqual(6)
    for (const line of (bunqRow?.detail ?? []).slice(1)) expect(bunqDetail).toContain(line)
  })

  it('says nothing that advises, instructs or ranks', () => {
    heldToTheLine(card)
    expect(card.basis.coverage).toMatch(/in the order you selected them; no order of preference/)
  })
})

describe('compareProducts: two fixed terms, decided by the term’s end against the keys', () => {
  const card = compare(BOI_FIXED, AIB_FIXED)

  it('shows each at the longest term that ends in time for the keys (the clamp)', () => {
    expect(card.columns.map((column) => column.kind)).toEqual(['18-month fixed', '1-year fixed'])
    expect(rowOf(card, 'Access').values).toEqual(['Locked until May 2028', 'Locked until Nov 2027'])
    expect(rowOf(card, 'Rate').values).toEqual(['2.48%', '2.00%'])
    expect(rowOf(card, 'Takes monthly payments')).toMatchObject({
      values: ['No', 'No'],
      differs: false,
    })
    expect(rowOf(card, 'Money by July 2028').values[0]).toMatch(/; interest stops May 2028$/)
    expect(card.basis.assumptions.join(' ')).toMatch(
      /A fixed term is shown when it ends at least one month before/,
    )
  })

  it('puts the term ends against the keys month first, and asks about the money before the later end', () => {
    expect(card.differences[0]).toBe(
      'The 18-month term in Bank of Ireland Advantage Fixed Term Deposit Account ends May 2028, 2 months before the keys in July 2028; the 12-month term in AIB Personal Fixed Term Deposit ends November 2027, 8 months before them.',
    )
    expect(card.decides).toBe('Will you need any of the €25,000 before May 2028?')
    expect(card.mustKnow.map((item) => item.facts[0])).toEqual([
      'Money locked until May 2028',
      'Money locked until November 2027',
    ])
    heldToTheLine(card)
  })

  it('takes a ladder rung’s own row id for that term, even past the keys, and says so', () => {
    const rung = compare('aib:deposit.c5065', BUNQ)
    expect(rung.columns[0]).toMatchObject({ rowId: 'aib:deposit.c5065', kind: '2-year fixed' })
    expect(rung.differences).toContain(
      'The 24-month term in AIB Personal Fixed Term Deposit ends November 2028, 4 months after the keys in July 2028.',
    )
    expect(rung.differences[0]).toMatch(
      /^Locking the €25,000 until November 2028 in AIB Personal Fixed Term Deposit earns €\d[\d,]* (more|less) than in bunq Savings Account by July 2028, where the money is at hand\.$/,
    )
    expect(rung.decides).toBe('Will you need any of the €25,000 before November 2028?')
    heldToTheLine(rung)
  })
})

describe('compareProducts: their own account, three columns, and what it refuses', () => {
  it('sets their own account beside the market on its own balance and rate', () => {
    const card = compare(BOI_FIXED, 'moco:savings.moco_easysaver', 'held:1')
    expect(card.columns.map((column) => column.lead)).toEqual([
      'Bank of Ireland Advantage Fixed Term Deposit Account',
      'MoCo EasySaver',
      'Your BoI savings',
    ])
    expect(card.title).toBe(
      'Bank of Ireland Advantage Fixed Term Deposit Account, MoCo EasySaver and Your BoI savings, side by side',
    )
    expect(rowOf(card, 'Rate').values[2]).toBe('0.50%')
    expect(rowOf(card, 'Money by July 2028').values[2]).toMatch(/^€\d[\d,]* on €20,000 held$/)
    expect(card.mustKnow[2]).toMatchObject({ rowId: 'held:1', facts: [] })
    heldToTheLine(card)
  })

  it.each([
    [[BUNQ], /2 or 3 products/],
    [[BUNQ, BUNQ], /named twice/],
    [[BUNQ, 'nobody:savings.nothing'], /not in the market Saoi holds/],
    [[BUNQ, 'held:9'], /not one of their accounts/],
  ])('refuses %j', (ids, reason) => {
    const result = compareProducts(MARKET, FIGURES, ids, PRODUCTS_AS_OF)
    expect(result.kind).toBe('refused')
    if (result.kind === 'refused') expect(result.reason).toMatch(reason)
  })

  it('refuses a mortgage: the comparison is of savings and deposit accounts', () => {
    const mortgage = MARKET.products.find((product) => product.terms.kind === 'mortgage')
    expect(mortgage).toBeDefined()
    const result = compareProducts(MARKET, FIGURES, [BUNQ, mortgage?.id ?? ''], PRODUCTS_AS_OF)
    expect(result).toMatchObject({ kind: 'refused' })
    if (result.kind === 'refused') expect(result.reason).toMatch(/not a savings or deposit account/)
  })

  it('refuses with nothing to work on, asking for the figures', () => {
    const empty = caseFigures({ plan: null, holdings: [], fact: () => undefined })
    const result = compareProducts(MARKET, empty, [BUNQ, SUPERSAVER], PRODUCTS_AS_OF)
    expect(result).toMatchObject({ kind: 'refused' })
    if (result.kind === 'refused') expect(result.reason).toMatch(/how much is saved now/)
  })

  it('runs twelve months when no date is known', () => {
    const undated = { ...FIGURES, keysMonth: null, keysFrom: null, neededAtKeysEur: null }
    const card = cardOf(compareProducts(MARKET, undated, [BOI_FIXED, BUNQ], PRODUCTS_AS_OF))
    expect(card.rows.map((row) => row.label)).toContain('Money by November 2027')
    expect(card.columns[0]?.kind).toBe('1-year fixed')
    heldToTheLine(card)
  })
})
