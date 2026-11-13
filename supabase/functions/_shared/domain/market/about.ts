import type { About, AboutTopic } from '../../contracts/market-tools.ts'
import { CORE_STATEMENT } from '../../market/disclosures.ts'
import { CCPC_ATTRIBUTION } from '../../market/schema.ts'

/**
 * What Saoi says about itself, as static text the MCP server serves as resources and the app
 * can show. Markdown. Kept here, beside the engine it describes, so a change to how ranking
 * works and the words that explain it land in the same commit.
 */

const RANKING = `# How Saoi ranks

Saoi compares Irish savings, deposit, mortgage, loan, credit card and current account products
against the figures the customer gives: their amounts, their dates, their debts. It supplies
facts and arithmetic. It does not give advice, and nothing it returns says what anyone should do
or picks a product for them. Saoi is not regulated by the Central Bank of Ireland.

## The objective is stated, and can be changed

Every result names what it was ranked by, with the inputs used.

- **Savings and deposits:** by default, the most interest after DIRT that can be known over the
  customer's horizon. Easiest access first is the alternative.
- **Mortgages and loans:** by default, the lowest total cost over the term. Lowest monthly
  repayment is the alternative.
- **Credit cards:** the least interest on the balance over twelve months.
- **Current accounts:** the lowest yearly fee.

The top five are shown unless more are asked for. For a home, every eligible option that fits
the customer's own filters is shown, sorted by the cost over the first five years, the keys date
or the monthly repayment, as they choose. Saoi earns nothing from any provider.

## How the figures are worked out

- **DIRT** at 33% comes off interest, except on products the source marks DIRT-free (State
  Savings).
- **Interest** accrues monthly at a twelfth of the AER and is credited yearly and at the end.
  Tiers are applied: a balance above a tier earns the rate above it. Monthly saving is capped
  at each account's maximum, and what an account cannot take is reported, not counted.
- **Rates that change:** a variable rate is assumed to stay as published today, and the result
  says so.
- **Rates that are not known are never treated as zero, and never assumed to hold.** A fixed
  term ends at maturity; an introductory rate with nothing stated after it ends with its period.
  The figures stop there and say why. A product known for only part of the horizon counts only
  the known months, so a short teaser rate does not outrank a rate that holds.
- **Bonuses** (such as a first-time buyer's mortgage bonus) are shown with their conditions and
  never added to interest.
- **Mortgages:** the initial rate for the fixed period, then the provider's stated follow-on
  rate. Cashback is counted where a percentage is stated. Fees are listed as the source states
  them and not added. Affordability uses the Central Bank of Ireland's limits (loan to income 4
  times for first-time buyers, 3.5 times for others; loan to value 90%).
- **Loans and debts:** repayments from the APR, level each month.

## Where the data comes from

Every rate is from the Competition and Consumer Protection Commission's comparison tables, and
every result carries CCPC's attribution. Saoi does not read providers' own websites for rates.
What a product's CCPC entry states in its own words (a fixed period, a rate for new accounts, a
bonus) is read from those words; nothing else is assumed. Every product carries when it
was last checked, when Saoi last saw it change, and every field the source does not give.
Cashback and savings bonuses linked to a mortgage are recorded from the lenders' own pages, with
their source.

## Which providers are compared

Providers that operate in Ireland: Irish banks and credit unions, Ireland State Savings, and banks
from other EU countries with an Irish branch or service (such as bunq, Revolut, Avant Money and
MoCo). Their deposits may be protected by their home country's deposit guarantee scheme rather
than Ireland's, and the result says which. Banks reached only through a deposit platform, such
as Raisin, are not compared.

A savings rate whose CCPC entry calls it a bonus, introductory or promotional rate, or which is
fixed for a period with nothing stated after it, is flagged as not confirmed when it ranks near
the top: it may be paid only for a period, or only on part of the balance.

## What the data does not say

Who can open a product (for example, whether an account with the same bank is needed first) is
not in CCPC's data, so the result says so and names the provider.
`

const EARNINGS = `# How Saoi earns

Saoi is free, and it earns nothing from any provider. No provider pays Saoi, or pays to be
shown or to be placed higher. Links to a provider go to the provider's own page, with nothing
tracked that earns a fee.

## What is stored

A plan worked out for a customer is held for 24 hours behind a single-use link so they can open
it in the Saoi app; it is deleted then if the link has not been opened, and once opened it is
kept with the conversation it opened into. Each run of the home calculator keeps one anonymous
row of bands (the day, income band, how many months to the keys, whether the date is met,
county and rent band when given, kind of home, first-time buyer): no figures, no identifiers,
no IP address. Nothing else a customer sends is stored.

## How the order is decided

Every result is sorted by a metric the customer picks or can change (the most interest after
DIRT, the lowest cost over the first five years, the soonest keys date, the lowest monthly
repayment), and says which. Saoi shows every option that fits the customer's own filters; it
does not pick one for them.

## Not advice, and not regulated

${CORE_STATEMENT}

## The data

Every rate is from the Competition and Consumer Protection Commission's comparison tables,
shown with its attribution:

> ${CCPC_ATTRIBUTION}
`

export const ABOUT: Readonly<Record<AboutTopic, About>> = {
  ranking: { topic: 'ranking', title: 'How Saoi ranks', text: RANKING, updatedOn: '2026-11-13' },
  earnings: { topic: 'earnings', title: 'How Saoi earns', text: EARNINGS, updatedOn: '2026-11-13' },
}
