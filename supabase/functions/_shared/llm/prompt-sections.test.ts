import { describe, expect, it } from 'vitest'
import { composeSystemPrompt } from './prompt.ts'
import { demoDomainConfig } from '../tenants/demo/domain-config.ts'
import { demoProducts } from '../tenants/demo/products.ts'
import { knowledgeBaseSection } from '../tenants/demo/kb-prompt.ts'
import type { CaseDigest } from './prompt.ts'
import {
  MARKET_TOOL_GUIDANCE,
  marketCatalogueSection,
  marketConversationSection,
  saoiDomainConfig,
} from './market-prompt.ts'
import type { MarketSummary } from '../domain/market/lookup.ts'
import { adviceWordsIn } from '../market/disclosures.ts'

const SLIDERS = {
  length: 0.5,
  humour: 0.3,
  sarcasm: 0.1,
  formality: 0.5,
  playfulness: 0.3,
  poetic: 0,
}

const digest = (extra: Partial<CaseDigest> = {}): CaseDigest => ({
  customerName: 'Aoife',
  sensitiveHeld: [],
  needs: { surface: [], ask: null, hold: [] },
  plan: null,
  authLevel: 'anonymous',
  facts: [],
  applications: [],
  declinedProducts: [],
  advisories: [],
  partner: null,
  eventsSinceLastSeen: [],
  ...extra,
})

/**
 * Whitespace-normalised, because these assertions are about what the prompt says rather than
 * how it is wrapped — a phrase broken across two lines is still the phrase.
 */
const compose = (extra: Partial<CaseDigest> = {}): string => raw(extra).replaceAll(/\s+/g, ' ')

const raw = (extra: Partial<CaseDigest> = {}): string =>
  composeSystemPrompt({
    domainConfig: demoDomainConfig,
    productCatalogue: knowledgeBaseSection(),
    sliders: SLIDERS,
    digest: digest(extra),
    sensitive: false,
    clarifyInScope: false,
  })

/**
 * That what the digest holds actually reaches the model.
 *
 * `goals` and `suitability` were computed every turn and silently dropped between the digest
 * builder and here, which no test caught because each half worked. This is the other end of the
 * same guard as `digest.test.ts`: there, everything handed in comes back out; here, everything
 * in the digest ends up in the prompt.
 */
describe('the digest reaches the prompt', () => {
  it('carries where the customer is trying to get to', () => {
    expect(compose({ goals: ['What they came in about: buying a first home.'] })).toContain(
      'buying a first home',
    )
  })

  it('carries whether something else would suit them better', () => {
    expect(compose({ suitability: ['Personal loan: cheaper over that term.'] })).toContain(
      'cheaper over that term',
    )
  })

  it('carries what applying would involve, under a heading that says not to recite it', () => {
    const prompt = compose({
      prospect: ['Mortgage — what applying would involve:', '  3 things already known: A, B, C.'],
    })

    expect(prompt).toContain('What applying would actually involve')
    expect(prompt).toContain('3 things already known')
    expect(prompt).toContain('rather than reciting it')
  })

  it('leaves a section out entirely when there is nothing to say', () => {
    const empty = compose()

    expect(empty).not.toContain('What applying would actually involve')
    expect(empty).not.toContain('Something else may suit them better')
  })
})

/**
 * How an application is conducted, which is the thing customers least expect.
 *
 * Asked how long one takes, whether an appointment was needed and what documents were required,
 * Saoirse declined all three. Two were honest; the third was wrong. But the real miss was that the
 * answer to "how long does this take" is not a number — it is that there is nothing to turn up
 * to and nothing to have ready, and nothing in the prompt said so.
 */
describe('what changed since they were last here', () => {
  it('carries a plan edit’s reading and says how to speak about it', () => {
    const prompt = compose({
      eventsSinceLastSeen: [
        'You changed the plan in the app. Moving the keys to March 2028 means €4,751 less saved by then at this pace.',
      ],
    })
    expect(prompt).toContain('## Changed since they were last here')
    expect(prompt).toContain('Moving the keys to March 2028 means €4,751 less saved by then')
    expect(prompt).toContain(
      'A change they made to their plan in the app: say what changed and which options now fit or no longer fit, as facts in their figures. Never call it better or worse, never pick.',
    )
    expect(prompt).toContain(
      'Say it in words only: no `show_products` and no other card, unless their own message asks to see products.',
    )
  })
})

describe('how applying works', () => {
  const prompt = compose()

  it('says there is no appointment and nothing to sit down to', () => {
    expect(prompt).toContain('no appointment')
    expect(prompt).toMatch(/no branch visit/i)
  })

  it('says an application can be left and picked up later', () => {
    expect(prompt).toMatch(/picked up whenever/i)
    expect(prompt).toMatch(/place is held/i)
  })

  it('says nothing has to be gathered up front', () => {
    expect(prompt).toMatch(/one thing at a time/i)
  })

  it('still refuses to invent a decision timeframe', () => {
    expect(prompt).toMatch(/do not have a timeframe/i)
    expect(prompt).toMatch(/must not invent one/i)
  })

  it("keeps starting an application the customer's tap", () => {
    expect(prompt).toMatch(/customer's tap/i)
  })
})

describe('what happens after what-is-involved', () => {
  const prompt = compose({ prospect: ['Mortgage — what applying would involve:'] })

  it('asks when, not what they earn', () => {
    expect(prompt).toMatch(/ask when they are hoping to do it/i)
    expect(prompt).toContain('Not their income')
  })

  it('routes a distant date to a plan rather than an application', () => {
    expect(prompt).toContain('propose_plan')
    expect(prompt).toMatch(/comes back to them when they reach/i)
  })
})

/**
 * The model cannot reason about "next year" without knowing what year it is.
 *
 * `goals.targetDate` wants a month. Somebody said "next year", nothing was recorded, so the
 * clarifying question behind it stayed unanswered, the need sat a hair under its threshold, and
 * the card was never offered. The whole chain started with a date the model could not compute.
 */
describe("today's date", () => {
  it('is in the prompt', () => {
    expect(compose()).toMatch(/Today is \d{4}-\d{2}-\d{2}/)
  })

  it('is in the volatile half, not the cached prefix', () => {
    const parts = composeSystemPrompt.withBreakpoint({
      domainConfig: demoDomainConfig,
      productCatalogue: knowledgeBaseSection(),
      sliders: SLIDERS,
      digest: digest(),
      sensitive: false,
      clarifyInScope: false,
    })

    // In the prefix it would be stale within a day and break the cache every night.
    expect(parts.stablePrefix).not.toMatch(/Today is/)
    expect(parts.caseSuffix).toMatch(/Today is/)
  })
})

describe('what the engine governs', () => {
  const prompt = compose()

  it('scopes the need scores to what Saoirse volunteers', () => {
    expect(prompt).toMatch(/governs what you volunteer, and nothing else/i)
    expect(prompt).toMatch(/has asked, and "the engine has not scored it highly enough yet"/i)
  })

  it('says a rough timeframe is still an answer', () => {
    expect(prompt).toMatch(/A rough answer is still an answer/i)
    expect(prompt).toMatch(/They can correct a month\. They cannot correct a blank/i)
  })
})

/**
 * A turn is sent as it is written, so none of it can be taken back.
 *
 * Saoirse told somebody "Tap the card to start it", asked a question, then wrote "Actually, hold off
 * on that card for a moment" — and no card was ever drawn, because the tool was never called. It
 * composes across rounds and had changed its mind between two of them.
 */
describe('committing to what has been said', () => {
  const prompt = compose()

  it('says a sentence already written cannot be withdrawn', () => {
    expect(prompt).toMatch(/You cannot take it back/i)
    expect(prompt).toMatch(/hold off on that/i)
  })

  it('forbids mentioning a card the tool was not called for', () => {
    expect(prompt).toMatch(/Never mention a card you have not called the tool for/i)
  })

  it('stops discovery being a reason to stall somebody who is ready', () => {
    expect(prompt).toMatch(/not a reason to keep them waiting/i)
    expect(prompt).toMatch(/they are ready. Offer the card/i)
  })
})

/**
 * What the bank can do depends on where the customer banks, and that has to be said.
 *
 * Saoirse promised "we'll come back to you when your savings reach €32,000" to somebody holding no
 * account here. The watch is only ever created once a savings account exists, so the promise was
 * conditional on something the customer could not see.
 */
describe('what the bank can do', () => {
  const prompt = compose()

  it('says a balance can only be watched where the bank can see it', () => {
    expect(prompt).toMatch(/only see accounts it holds/i)
    expect(prompt).toMatch(/come back to you when you get there/i)
  })

  it('asks where the salary is paid, not who they bank with', () => {
    expect(prompt).toMatch(/where their salary is paid/i)
    expect(prompt).toContain('Not "who do you bank with"')
  })

  it('gives both reasons the salary matters', () => {
    expect(prompt).toMatch(/read from the account instead of asked for/i)
    expect(prompt).toMatch(/standing order/i)
  })

  it('is explicit that none of it is a condition of being lent to', () => {
    expect(prompt).toMatch(/None of them is a condition of being lent to/i)
    expect(prompt).toMatch(/nobody has to move their banking/i)
  })

  it('says what to do when the answer is another bank', () => {
    expect(prompt).toMatch(/the plan still stands/i)
    expect(prompt).toMatch(/Do not repeat the offer after they have declined/i)
  })
})

/**
 * The rates in the prompt are the rates on the card.
 *
 * `illustrativeTerms` used to carry its own, and they had drifted: the mortgage advertised
 * "3.85% for 3 years" in prose while the quote card offered 3.1%, 3.3%, 3.4% and 3.9%.
 */
describe('product rates', () => {
  const prompt = compose()

  it('states every variant the quote card can show', () => {
    for (const variant of demoProducts.mortgage.variants ?? []) {
      expect(prompt, variant.name).toContain(variant.name)
    }
  })

  it('states them as the figures they actually are', () => {
    expect(prompt).toContain('4-year fixed: 3.1% fixed for 4 years')
  })

  it('no longer carries the rate that contradicted them', () => {
    expect(prompt).not.toContain('3.85%')
  })
})

/**
 * A market conversation (2026-11-13): the case holds a claimed plan or holdings, and Saoirse
 * called Bank of Ireland's 18-month rate "Demo Bank's own deposit range". There the catalogue
 * is the market and the scope is Saoi's; a Demo Bank case is told what it always was.
 */
describe('a market conversation', () => {
  const summary = {
    total: 741,
    byCategory: [
      { category: 'deposit', count: 300 },
      { category: 'mortgage', count: 441 },
    ],
    byProvider: [
      { name: 'AIB', count: 120 },
      { name: 'Bank of Ireland', count: 150 },
      { name: 'MoCo', count: 2 },
    ],
    checkedOn: '2026-11-09',
  } as const satisfies MarketSummary

  const market = (extra: Partial<CaseDigest> = {}): string =>
    composeSystemPrompt({
      domainConfig: saoiDomainConfig,
      productCatalogue: marketCatalogueSection(summary),
      sliders: SLIDERS,
      digest: digest({ banksHere: null, holdings: { lines: [], progress: null }, ...extra }),
      marketConversation: true,
    }).replaceAll(/\s+/g, ' ')

  it('never says Demo Bank, and names the market and Saoi’s scope', () => {
    const prompt = market()
    expect(prompt).not.toContain('Demo Bank')
    expect(prompt).toContain('# The market')
    expect(prompt).toContain('Saoi holds 741 products from 3 providers')
    expect(prompt).toContain('last checked 9 November 2026')
    expect(prompt).toContain('Bank of Ireland (150)')
    expect(prompt).toContain(
      'Irish savings, deposit, mortgage, loan, credit card and current account products compared on the customer’s figures',
    )
    expect(prompt).toContain("You are Saoirse, Saoi's banking assistant.")
  })

  it('tells Saoirse to look a named product up before saying it is not held', () => {
    const prompt = market()
    expect(prompt).toContain('call `lookup_products` with their words before you answer')
    expect(prompt).toContain(
      'Never say a figure is not held until `lookup_products` has found nothing for it',
    )
    expect(prompt).toContain('Never tell them to check with the provider or the bank')
    expect(adviceWordsIn(marketCatalogueSection(summary))).toEqual([])
  })

  it('leaves out applying to, and banking with, Demo Bank', () => {
    const prompt = market()
    expect(prompt).not.toContain('# How applying works')
    expect(prompt).not.toContain('# What the bank can do')
    expect(prompt).not.toContain('## Banking here')
  })

  it('says so when the market could not be read, with no figure', () => {
    const section = marketCatalogueSection(null)
    expect(section).toContain('The market could not be read as this conversation started.')
    expect(section).not.toMatch(/\d+ products/)
  })

  /*
   * 2026-11-13, a claimed home plan: ten replies ended "would you like this kept as a plan that
   * follows your deposit, or would you rather look at the accounts?", "yes a plan" ran the POC's
   * plan flow, and the price and income the plan held were asked for again.
   */
  it('runs none of the Demo Bank arc: no stage, no fork, no plan to build', () => {
    const prompt = market({
      stage: 'direction',
      goals: ['Still unknown for it: Annual basic salary, Property price.'],
      needs: {
        surface: [{ name: 'Mortgage', framing: 'They are buying.' }],
        ask: { name: 'Protection', question: 'Who depends on them?' },
        hold: [],
      },
      plans: [{ title: 'Buy my first home', lines: ['Deposit first'] }],
      arrangement: ['Lump sum: fixed term'],
      arrangementNeeds: ['When do they need the money?'],
    })
    expect(prompt).toContain('## How this conversation runs')
    expect(prompt).not.toContain('## Where this conversation has got to')
    expect(prompt).not.toContain('put the choice back to them')
    expect(prompt).not.toContain('Still unknown for it')
    expect(prompt).not.toContain('## What this customer appears to need')
    expect(prompt).not.toContain('## Plans they are keeping')
    expect(prompt).not.toContain('## How their money would be arranged')
    expect(prompt).not.toContain('## One question before their money can be arranged')
    expect(prompt).not.toContain('## Applications')
    expect(prompt).not.toContain('Nothing has been started.')
    expect(prompt).toContain('Never offer to build, propose or start another.')
    expect(prompt).toContain(
      'Never end on a choice of what to do next: not "a plan or the accounts"',
    )
  })

  it('tells the tools a market conversation has, and none of the POC’s', () => {
    const prompt = market()
    expect(prompt).toContain(MARKET_TOOL_GUIDANCE.replaceAll(/\s+/g, ' '))
    for (const tool of ['show_product_options', 'show_comparison', 'show_review', 'propose_plan']) {
      expect(prompt, tool).not.toContain(tool)
    }
  })

  it('lists a claimed plan’s gross income nowhere a form collects (and the POC as it was)', () => {
    expect(market()).not.toContain('Annual income before tax')
    expect(compose()).not.toContain('Annual income before tax')
  })

  it('holds the no "check with" rule in its own rules', () => {
    const section = marketConversationSection().replaceAll(/\s+/g, ' ')
    expect(section).toContain('Never tell them to check anything with the provider or the bank')
    expect(adviceWordsIn(section)).toEqual([])
    expect(adviceWordsIn(MARKET_TOOL_GUIDANCE)).toEqual([])
  })

  it('keeps a Demo Bank case’s prompt as it was', () => {
    const poc = composeSystemPrompt({
      domainConfig: demoDomainConfig,
      productCatalogue: knowledgeBaseSection(),
      sliders: SLIDERS,
      digest: digest({ banksHere: null }),
    })
    expect(poc).toContain("You are Saoirse, Demo Bank's banking assistant.")
    expect(poc).toContain('- Demo Bank products and services')
    expect(poc).toContain(knowledgeBaseSection())
    expect(poc).toContain('# How applying works')
    expect(poc).toContain('# What the bank can do')
    expect(poc).toContain('## Banking here')
    expect(poc).not.toContain('# The market')
    expect(
      composeSystemPrompt({
        domainConfig: demoDomainConfig,
        productCatalogue: knowledgeBaseSection(),
        sliders: SLIDERS,
        digest: digest({ banksHere: null }),
        marketConversation: false,
      }),
    ).toBe(poc)
  })
})
