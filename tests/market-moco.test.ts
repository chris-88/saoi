import { describe, expect, it } from 'vitest'
import { ParseError } from '../scripts/market/boi.ts'
import { easySaver } from '../scripts/market/moco.ts'
import { marketProductSchema } from '../supabase/functions/_shared/market/schema.ts'

/**
 * MoCo's parser against the pages' own sentences, trimmed from what www.moco.ie served on
 * 2026-11-09 (the savings page, then its FAQ, as the refresh joins them).
 */

const SAVINGS = `<html><body>
<h2>Why save with MoCo?</h2><h3>Daily Interest</h3>
<p>*AER is the annual equivalent rate. MoCo&rsquo;s current variable rate is 2.1% AER. Interest is subject to Deposit Interest Retention Tax, where applicable.</p>
</body></html>`

const FAQ = `<html><body>
<p>The current minimum savings amount is &euro;1.</p>
<p>The current rate of interest payable on existing savings accounts can be found here <a href="https://savings.moco.ie/login">here</a>. For new accounts, MoCo's current variable rate is 2.1% AER.</p>
<p>Your MoCo savings account is an easy access account meaning that you can withdraw your money at any time (subject to payment processing timelines).</p>
<p>Subject to certain exemptions, the funds in your savings account are guaranteed up to &euro;100,000 by the Austrian Government pursuant to the Austrian Deposit Guarantee Scheme.</p>
<p>A standing order facility can be arranged with the bank from which you wish to transfer money to MoCo.</p>
<p>You need to be over 18 years old, resident in Ireland and not be a citizen of the United States. We can only facilitate the opening of a savings account by natural persons (as distinct from legal persons) at this time.</p>
<p>We are unable to facilitate the opening of joint savings accounts.</p>
</body></html>`

describe('MoCo EasySaver', () => {
  it('reads the rate, who can open it and how interest is paid', () => {
    const parsed = easySaver(`${SAVINGS}\n${FAQ}`)
    expect(parsed.rates).toEqual({ kind: 'deposit', aerPct: 2.1, basis: 'variable', noticeDays: 0 })
    expect(parsed.conditions).toMatchObject({
      takesLumpSum: true,
      takesMonthly: true,
      minLumpSumEur: 1,
      minAge: 18,
      eligibility: {
        residentIn: 'Ireland',
        notForUsCitizens: true,
        individualsOnly: true,
        jointAccounts: false,
      },
      interestPaid: 'daily',
      rateForNewAccounts: true,
    })
    expect(() =>
      marketProductSchema.parse({
        provider: 'moco',
        source: 'bank',
        productId: 'deposit.moco_easysaver',
        category: 'deposit',
        ...parsed,
        sourceUrl: 'https://www.moco.ie/moco/savings',
        checkedAt: '2026-11-09T15:00:00.000Z',
        effectiveFrom: null,
      }),
    ).not.toThrow()
  })

  it('fails when the pages disagree on the rate', () => {
    expect(() => easySaver(`${SAVINGS}\n${FAQ.replace('is 2.1% AER', 'is 2.4% AER')}`)).toThrow(
      /different rates/,
    )
  })

  it('fails rather than drop who can open it', () => {
    expect(() =>
      easySaver(`${SAVINGS}\n${FAQ.replace(/You need to be over 18/, 'Be 18')}`),
    ).toThrow(ParseError)
  })

  it('fails on a page with neither (a bot challenge, a redesign)', () => {
    expect(() => easySaver('<html><body>Verifying your browser</body></html>')).toThrow(ParseError)
  })
})
