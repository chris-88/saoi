import { describe, expect, it } from 'vitest'
import { marketProductSchema } from '../supabase/functions/_shared/market/schema.ts'
import {
  advantageFixed,
  goalsaver,
  instantAccess,
  mortgagesaver,
  notice31,
  ParseError,
  rateSheetOf,
  supersaver,
} from '../scripts/market/boi.ts'
import { describeDiff, diffMarket } from '../scripts/market/diff.ts'
import { htmlToLines } from '../scripts/market/html.ts'
import { robotsAllows } from '../scripts/market/robots.ts'
import { runProviders } from '../scripts/market/run.ts'

/**
 * The parsers against the pages' own sentences, trimmed from what personalbanking.bankofireland.com
 * served on 2026-11-09. The point of each failure case: a page that changes shape stops the
 * refresh rather than writing a product with a rate or a tier missing.
 */

const page = (title: string, h1: string | null, body: string) =>
  `<html><head><title>${title}</title></head><body><nav><a href="/x">Mortgage rates 9.99%</a></nav>` +
  `${h1 === null ? '' : `<h1 class="u-font-size-2-5x">${h1}</h1>`}<main>${body}</main></body></html>`

const SUPERSAVER = page(
  'Features and Benefits - SuperSaver Account | Bank of Ireland',
  'SuperSaver Account',
  `<ul><li>Save monthly by Direct Debit minimum &euro;5 &#8211; maximum &euro;2,500.</li>
   <li>Lump sum lodgements are not allowed.</li>
   <li>Available to 16 years of age and over.</li>
   <li>Get our best fixed savings rate 3.00% AER (Annual Equivalent Rate) for 12 months, beginning when the first direct debit is taken.</li>
   <li>Following the 12 month fixed rate period, the account will default to the Standard Regular Saving variable rate (currently 2% AER).</li>
   <li>The interest rate reduces to 0.50% AER variable for amounts over &euro;30,000.</li></ul>`,
)

const GOALSAVER = page(
  'Features and Benefits - GoalSaver Account | Bank of Ireland',
  null,
  `<ul><li>Save monthly by Direct Debit &#8211; Minimum &euro;20, Maximum &euro;2,000 per month</li>
   <li>Interest rate is variable. Annual Equivalent Rates (AER) are quoted based on a 365 day calendar year</li>
   <li>Lump sum lodgements are not permitted</li></ul>
   <table><tbody><thead><tr><th><div><strong>Amount</strong></div></th><th><div>AER Variable</div></th></tr></thead>
   <tr><td><div class="u-text-center">&euro;0 &#8211; &euro;14,999</div></td><td><div>2.00%</div></td></tr>
   <tr><td><div class="u-text-center">&euro;15,000+</div></td><td><div>0.50%</div></td></tr></tbody></table>
   <ul><li>Be aged 18 years of age or older</li></ul>`,
)

const MORTGAGESAVER = page(
  'MortgageSaver | Bank of Ireland',
  'MortgageSaver account',
  `<p>Your account pays 2% Annual Equivalent Rate (AER) variable on the money you add regularly by direct debit, up to €15,000. Once you reach this amount, we move €15,000 into a separate balance that earns 0.50% AER (variable).</p>
   <p>You have the option to lodge lump sum payments at 0.50% AER variable, up to a total value of €20,000, in any branch.</p>
   <p>Save between €200 and €2,500 a month by direct debit.</p>
   <ul><li>Aged 18 or over</li></ul>
   <p>First-time buyers can get €2,000 bonus interest (less DIRT) on your savings.</p>
   <ul><li>Be a first-time buyer (all buyers must be buying their first home).</li>
   <li>Save between €200 and €2,500 each month for at least six months in a row and reach at least €5,000</li>
   <li>Draw down a Bank of Ireland first-time buyer mortgage within 30 months of opening your MortgageSaver account.</li></ul>`,
)

const INSTANT = page(
  'Features and Benefits - Instant Access Demand Account | Bank of Ireland',
  'Instant Access Demand Account',
  `<ul><li>Earn a variable interest rate of  0.10% AER (Annual Equivalent Rate).</li>
   <li>Minimum lodgement €1, no maximum.</li></ul>`,
)

const NOTICE = page(
  'Features and Benefits - 365 31 Day Notice Account | Bank of Ireland',
  '365 31 Day Notice Account',
  `<ul><li>Minimum lodgement of €5,000, no maximum lodgement amount.</li>
   <li>Withdraw money by giving 31 days notice using 365 Online or Phone</li>
   <li>Interest rate of 1.00%  is variable.</li>
   <li>Single lodgement only by direct debit from a Bank of Ireland personal current account</li>
   <li>Be aged 18 years of age or older</li></ul>`,
)

const ADVANTAGE_TABLE = `<table><tr><th>Advantage</th><th>Fixed Term Return (interest paid at maturity)</th><th>AER Fixed</th></tr>
  <tr><td class="u-text-center">6 Month 25% access</td><td>0.99%</td><td>2.01%</td></tr>
  <tr><td class="u-text-center">12 Month 25% access</td><td>2.39%</td><td>2.40%</td></tr>
  <tr><td class="u-text-center">18 Month 25% access</td><td>3.73%</td><td>2.48%</td></tr></table>`

const advantage = (table: string) =>
  page(
    'Features and Benefits - Advantage Fixed Term Deposit Account | Bank of Ireland',
    'Advantage Fixed Term Deposit Account',
    `<ul><li>Term(s) available: 6, 12 and 18 Months</li>
     <li>Single lodgement only. Apart from the initial lodgement you cannot make other payments to the account</li>
     <li>Minimum lodgement €5,000, no maximum lodgement</li></ul>${table}`,
  )

describe('reading a page as lines', () => {
  it('puts a table row on one line and drops the navigation', () => {
    const lines = htmlToLines(GOALSAVER)

    expect(lines).toContain('€0 – €14,999 | 2.00%')
    expect(lines).toContain('€15,000+ | 0.50%')
    expect(lines.join('\n')).not.toContain('9.99%')
  })
})

describe('the Bank of Ireland parsers', () => {
  it('reads SuperSaver: the fixed rate, what follows it and the tier', () => {
    expect(supersaver(SUPERSAVER)).toEqual({
      providerProductName: 'SuperSaver Account',
      rates: {
        kind: 'deposit',
        aerPct: 3,
        basis: 'fixed',
        fixedMonths: 12,
        thenAerPct: 2,
        tierCapEur: 30000,
        aboveTierAerPct: 0.5,
      },
      conditions: {
        takesMonthly: true,
        takesLumpSum: false,
        minMonthlyEur: 5,
        maxMonthlyEur: 2500,
        minAge: 16,
      },
    })
  })

  it('reads GoalSaver from its tier table, named by the title when there is no heading', () => {
    const parsed = goalsaver(GOALSAVER)

    expect(parsed.providerProductName).toBe('GoalSaver Account')
    expect(parsed.rates).toMatchObject({ aerPct: 2, tierCapEur: 15000, aboveTierAerPct: 0.5 })
    expect(parsed.conditions).toMatchObject({ minMonthlyEur: 20, maxMonthlyEur: 2000 })
  })

  it('reads MortgageSaver with its lump-sum rate and every bonus condition', () => {
    const parsed = mortgagesaver(MORTGAGESAVER)

    expect(parsed.rates).toMatchObject({
      aerPct: 2,
      tierCapEur: 15000,
      aboveTierAerPct: 0.5,
      lumpSumAerPct: 0.5,
    })
    expect(parsed.conditions.bonus).toEqual({
      amountEur: 2000,
      lessDirt: true,
      firstTimeBuyerOnly: true,
      requiresMortgageHere: true,
      minMonthlyEur: 200,
      minMonths: 6,
      minTotalEur: 5000,
      withinMonths: 30,
    })
  })

  it('reads the demand and notice accounts', () => {
    expect(instantAccess(INSTANT).rates.aerPct).toBe(0.1)
    expect(notice31(NOTICE)).toMatchObject({
      rates: { aerPct: 1, basis: 'variable' },
      conditions: { takesMonthly: false, minLumpSumEur: 5000 },
    })
  })

  it('reads the Advantage ladder, with the term return as well as the AER', () => {
    expect(advantageFixed(advantage(ADVANTAGE_TABLE)).rates.terms).toEqual([
      { months: 6, termReturnPct: 0.99, aerPct: 2.01 },
      { months: 12, termReturnPct: 2.39, aerPct: 2.4 },
      { months: 18, termReturnPct: 3.73, aerPct: 2.48 },
    ])
  })

  it('produces records the schema accepts', () => {
    for (const [productId, html, parser] of [
      ['savings.supersaver', SUPERSAVER, supersaver],
      ['savings.goalsaver', GOALSAVER, goalsaver],
      ['savings.mortgagesaver', MORTGAGESAVER, mortgagesaver],
      ['savings.instant_access', INSTANT, instantAccess],
      ['savings.notice_31_day', NOTICE, notice31],
      ['savings.advantage_fixed', advantage(ADVANTAGE_TABLE), advantageFixed],
    ] as const) {
      const record = {
        provider: 'boi',
        source: 'bank',
        productId,
        category: 'savings',
        ...parser(html),
        sourceUrl: 'https://personalbanking.bankofireland.com/x/',
        checkedAt: '2026-11-09T10:00:00.000Z',
        effectiveFrom: null,
      }
      expect(marketProductSchema.safeParse(record).success, productId).toBe(true)
    }
  })
})

describe('a page that has changed shape stops the refresh', () => {
  it('when a rate sentence is reworded', () => {
    const reworded = SUPERSAVER.replace('reduces to 0.50% AER variable', 'falls to 0.50% AER')
    expect(() => supersaver(reworded)).toThrow(ParseError)
    expect(() => supersaver(reworded)).toThrow(/rate above the balance tier/)
  })

  it('when the Advantage table loses a row the page still offers', () => {
    const short = ADVANTAGE_TABLE.replace(/<tr><td[^>]*>18 Month[\s\S]*?<\/tr>/, '')
    expect(() => advantageFixed(advantage(short))).toThrow(
      /terms \[6, 12\] but the page offers \[6, 12, 18\]/,
    )
  })

  it('when the GoalSaver tiers stop meeting', () => {
    expect(() => goalsaver(GOALSAVER.replace('&euro;15,000+', '&euro;20,000+'))).toThrow(
      /do not meet/,
    )
  })

  it('when the page is about something else', () => {
    expect(() => supersaver(SUPERSAVER.replaceAll('SuperSaver', 'MegaSaver'))).toThrow(
      /not headed SuperSaver/,
    )
  })
})

describe('the rate sheet', () => {
  it('reads the date out of the sheet’s file name without fetching it', () => {
    const html =
      '<a href="https://personalbanking.bankofireland.com/app/uploads/Deposit-Interest-Rates-Table-22nd-October-2026-A.pdf">x</a>'
    expect(rateSheetOf(html)).toEqual({
      url: 'https://personalbanking.bankofireland.com/app/uploads/Deposit-Interest-Rates-Table-22nd-October-2026-A.pdf',
      asOf: '2026-10-22',
    })
    expect(rateSheetOf('<a href="/other">x</a>')).toBeNull()
  })
})

describe('robots.txt', () => {
  const robots = 'User-agent: * \nDisallow: /*.pdf$\n\nSitemap: https://example.com/sitemaps.xml'

  it('lets the product pages through and keeps the PDFs out', () => {
    expect(
      robotsAllows(robots, '/save-and-invest/savings/regular-savings-accounts/mortgagesaver/'),
    ).toBe(true)
    expect(
      robotsAllows(robots, '/app/uploads/Deposit-Interest-Rates-Table-22nd-October-2026-A.pdf'),
    ).toBe(false)
  })

  it('reads only the group for every agent, longest rule winning', () => {
    const mixed =
      'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /save-and-invest/\nAllow: /save-and-invest/savings/'
    expect(robotsAllows(mixed, '/save-and-invest/savings/x/')).toBe(true)
    expect(robotsAllows(mixed, '/save-and-invest/investments/')).toBe(false)
    expect(robotsAllows(mixed, '/borrow/')).toBe(true)
  })
})

describe('the diff', () => {
  const base = {
    provider: 'boi',
    source: 'bank' as const,
    productId: 'savings.advantage_fixed',
    category: 'deposit' as const,
    providerProductName: 'Advantage Fixed Term Deposit Account',
    rates: {
      kind: 'deposit' as const,
      aerPct: null,
      basis: 'fixed' as const,
      terms: [{ months: 6, aerPct: 1.51 }],
    },
    conditions: { takesMonthly: false, takesLumpSum: true },
    sourceUrl: 'https://personalbanking.bankofireland.com/x/',
    checkedAt: '2026-10-08T00:00:00.000Z',
    effectiveFrom: null,
  }

  it('names each moved field, and ignores the date it was checked', () => {
    const later = {
      ...base,
      rates: { ...base.rates, terms: [{ months: 6, aerPct: 2.01 }] },
      checkedAt: '2026-11-09T00:00:00.000Z',
    }
    const diff = diffMarket([base], [later])

    expect(diff.changed).toEqual([
      {
        productId: 'savings.advantage_fixed',
        fields: [{ path: 'rates.terms[0].aerPct', from: 1.51, to: 2.01 }],
      },
    ])
    expect(diffMarket([base], [{ ...base, checkedAt: later.checkedAt }]).unchanged).toEqual([
      'savings.advantage_fixed',
    ])
  })

  it('reports what appeared and what disappeared', () => {
    const goal = { ...base, productId: 'savings.goalsaver' }
    const diff = diffMarket([base], [goal])

    expect(diff.added.map((product) => product.productId)).toEqual(['savings.goalsaver'])
    expect(diff.disappeared).toEqual(['savings.advantage_fixed'])
    expect(describeDiff(diff)).toContain('GONE     savings.advantage_fixed')
  })
})

describe('running several providers', () => {
  it('keeps going past a provider that fails or throws, and names each one that did', async () => {
    const ran: string[] = []
    const failed = await runProviders(
      [{ provider: 'boi' }, { provider: 'aib' }, { provider: 'ptsb' }],
      (p) => {
        ran.push(p.provider)
        if (p.provider === 'boi') throw new Error('robots.txt answered 403')
        return Promise.resolve(p.provider !== 'aib')
      },
      () => undefined,
    )

    expect(ran).toEqual(['boi', 'aib', 'ptsb'])
    expect(failed).toEqual(['boi', 'aib'])
  })
})
