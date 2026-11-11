import { describe, expect, it } from 'vitest'
import { asApplicationId, asParticipantId } from '@domain/facts.ts'
import { demoDomainConfig } from '../tenants/demo/domain-config.ts'
import { knowledgeBaseSection } from '../tenants/demo/kb-prompt.ts'
import { slidersFor } from './persona.ts'
import { POLICY, composeSystemPrompt, type PromptInput } from './prompt.ts'

const baseInput = (): PromptInput => ({
  domainConfig: demoDomainConfig,
  productCatalogue: knowledgeBaseSection(),
  sliders: slidersFor('default'),
  digest: {
    customerName: 'Aoife',
    authLevel: 'authenticated',
    facts: [
      { label: 'Annual basic salary', value: '92,000', source: 'bank_held', verified: false },
    ],
    applications: [
      {
        product: 'mortgage',
        displayName: 'Mortgage',
        state: 'in_progress',
        stateLabel: 'In progress',
        outstanding: ['Your PPS number'],
        waitingOn: 'primary',
      },
    ],
    declinedProducts: [],
    advisories: [],
    partner: null,
    eventsSinceLastSeen: [],
  },
})

describe('section order (CLAUDE.md > A Saoirse turn)', () => {
  it('places policy, domain, catalogue, persona and digest in that order', () => {
    const prompt = composeSystemPrompt(baseInput())

    const order = [
      '# Policy',
      '# Domain',
      '# Using your tools',
      '# Facts you can record',
      '# Products',
      '## Style',
      '# Case',
    ].map((heading) => prompt.indexOf(heading))

    expect(
      order.every((index) => index >= 0),
      'every section is present',
    ).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('puts the immutable policy first, so nothing after it can outrank it', () => {
    expect(composeSystemPrompt(baseInput()).indexOf('# Policy')).toBe(0)
  })
})

describe('prompt caching', () => {
  it('keeps the stable prefix byte-identical when only the case digest changes', () => {
    const a = composeSystemPrompt(baseInput())
    const b = composeSystemPrompt({
      ...baseInput(),
      digest: { ...baseInput().digest, customerName: 'Someone Else' },
    })

    const prefixOf = (prompt: string) => prompt.slice(0, prompt.indexOf('# Case'))
    expect(prefixOf(a)).toEqual(prefixOf(b))
  })

  it('changes the prefix when persona changes, because persona precedes the digest', () => {
    const a = composeSystemPrompt(baseInput())
    const b = composeSystemPrompt({ ...baseInput(), sliders: slidersFor('formal') })

    expect(a).not.toEqual(b)
  })

  it('reports where the cacheable prefix ends', () => {
    const input = baseInput()
    const prompt = composeSystemPrompt(input)
    const { stablePrefix } = composeSystemPrompt.withBreakpoint(input)

    expect(prompt.startsWith(stablePrefix)).toBe(true)
    expect(stablePrefix).toContain('# Products')
    expect(stablePrefix).not.toContain('# Case')
  })

  /*
   * The expensive one.
   *
   * A sensitive turn zeroes humour, which rewrites the persona block. While that block sat
   * inside the cached prefix, every such turn invalidated the whole 17,000-token prefix and
   * paid to write it again — and then the next ordinary turn paid to write it back. The demo
   * in §67 is built on life events, so this fired constantly.
   */
  it('keeps the cached prefix identical when a turn is sensitive', () => {
    const calm = composeSystemPrompt.withBreakpoint(baseInput()).stablePrefix
    const sensitive = composeSystemPrompt.withBreakpoint({
      ...baseInput(),
      sensitive: true,
    }).stablePrefix

    expect(sensitive).toBe(calm)
  })

  it('still composes persona before the case, and only once', () => {
    const prompt = composeSystemPrompt(baseInput())
    const persona = prompt.indexOf('# Style')

    expect(persona).toBeGreaterThan(prompt.indexOf('# Products'))
    expect(persona).toBeLessThan(prompt.indexOf('# Case'))
    expect(prompt.split('# Style')).toHaveLength(2)
  })
})

describe('policy', () => {
  it('states the rules that persona can never override', () => {
    for (const rule of [
      /never claim to be (a )?human/i,
      /state.*only.*product catalogue|only.*from the product catalogue/i,
      /never.*invent.*status|status.*only.*case/i,
      /health/i,
    ]) {
      expect(POLICY, rule.source).toMatch(rule)
    }
  })

  it('tells the model it cannot take actions itself', () => {
    expect(POLICY).toMatch(/you cannot|you do not have|the customer.*confirm/i)
  })
})

describe('the case digest (§14, Invariant 2)', () => {
  it('renders every application with its controlled state', () => {
    const prompt = composeSystemPrompt(baseInput())

    expect(prompt).toContain('Mortgage')
    expect(prompt).toContain('In progress')
    expect(prompt).toContain('Your PPS number')
  })

  it('lists declined products as not to be raised again (§49)', () => {
    const input = baseInput()
    const prompt = composeSystemPrompt({
      ...input,
      digest: { ...input.digest, declinedProducts: ['personal_loan'] },
    })

    expect(prompt).toMatch(/do not raise again/i)
    expect(prompt).toContain('personal_loan')
  })

  it('tells Saoirse not to speak as though an application exists when none does', () => {
    const input = baseInput()
    const prompt = composeSystemPrompt({
      ...input,
      digest: { ...input.digest, applications: [] },
    })

    expect(prompt).toMatch(/Nothing has been started/i)
    expect(prompt).toMatch(/Do not speak as though there is/i)
  })

  it('carries what changed since the customer was last here (§36)', () => {
    const input = baseInput()
    const prompt = composeSystemPrompt({
      ...input,
      digest: {
        ...input.digest,
        eventsSinceLastSeen: ['Your credit card application was approved'],
      },
    })

    expect(prompt).toMatch(/since.*last/i)
    expect(prompt).toContain('Your credit card application was approved')
  })

  it('states unseen plan alerts first, as facts, and lists the dates kept', () => {
    const input = baseInput()
    const alert =
      'A rate in your plan changed: Bank of Ireland SuperSaver: 3.00% to 2.75% from 10 Nov 2026 (bank’s site, read 11 Nov). Your plan counted 3.00%.'
    const prompt = composeSystemPrompt({
      ...input,
      digest: {
        ...input.digest,
        alerts: { unseen: [alert], reminders: ['AIB fixed rate, 1 Mar 2027'] },
      },
    })
    expect(prompt).toContain('Since you were here:')
    expect(prompt).toContain(`- ${alert}`)
    expect(prompt).toContain('- AIB fixed rate, 1 Mar 2027')
    expect(prompt).toMatch(/Pick nothing, advise nothing/)

    expect(composeSystemPrompt(input)).not.toContain('Since you were here')
  })

  it('names the partner and what is waiting on them', () => {
    const input = baseInput()
    const prompt = composeSystemPrompt({
      ...input,
      digest: {
        ...input.digest,
        partner: { name: 'Emma', joined: true, outstanding: ["Emma's latest payslip"] },
      },
    })

    expect(prompt).toContain('Emma')
    expect(prompt).toContain("Emma's latest payslip")
  })
})

describe('the product catalogue (§51)', () => {
  it('includes the synthetic-terms disclaimer so figures cannot be presented as real', () => {
    expect(composeSystemPrompt(baseInput())).toMatch(/illustrative/i)
  })

  it("carries each product's cautions", () => {
    const prompt = composeSystemPrompt(baseInput())
    expect(prompt).toMatch(/never infer health information/i)
  })
})

describe('sensitivity (§50, Invariant 5)', () => {
  it('suppresses humour and product offers when the turn is sensitive', () => {
    const prompt = composeSystemPrompt({ ...baseInput(), sensitive: true })

    expect(prompt).toContain('No jokes.')
    expect(prompt).toMatch(/do not (offer|raise|suggest).*product/i)
  })

  it('leaves an ordinary turn free to raise relevant products', () => {
    expect(composeSystemPrompt(baseInput())).not.toMatch(/do not (offer|raise|suggest).*product/i)
  })
})

describe('ambiguous turns (§20)', () => {
  it('instructs the model to clarify within banking scope', () => {
    const prompt = composeSystemPrompt({ ...baseInput(), clarifyInScope: true })
    expect(prompt).toMatch(/clarify/i)
  })
})

describe('identifiers never reach the model as noise', () => {
  it('renders no raw UUIDs in the digest', () => {
    const input = baseInput()
    const prompt = composeSystemPrompt({
      ...input,
      digest: {
        ...input.digest,
        applications: [
          {
            product: 'mortgage',
            displayName: 'Mortgage',
            state: 'in_progress',
            stateLabel: 'In progress',
            outstanding: [],
            waitingOn: 'primary',
            id: asApplicationId('3f8b0c7e-0000-4000-8000-000000000001'),
          },
        ],
      },
    })

    // Application ids are needed for tool calls, so they appear — but exactly once, labelled.
    expect(prompt.match(/3f8b0c7e-0000-4000-8000-000000000001/g)).toHaveLength(1)
    expect(prompt).not.toContain(asParticipantId('should-not-appear'))
  })
})

/**
 * The policy says what Saoirse may not do. Without this section a model holds a pleasant
 * conversation and records nothing — which looks fine on screen and orchestrates nothing
 * underneath. Haiku 4.5 did exactly that before this existed.
 */
describe('tool guidance', () => {
  const prompt = composeSystemPrompt(baseInput())

  it('tells the model to record facts in the same turn they are stated', () => {
    expect(prompt).toMatch(/record_facts/)
    expect(prompt).toMatch(/same\s+turn/i)
  })

  it('tells the model to offer products with a card rather than in prose', () => {
    expect(prompt).toMatch(/show_product_options/)
    expect(prompt).toMatch(/cannot be chosen/i)
  })

  it('sits inside the cacheable prefix, since it never varies by case', () => {
    const { stablePrefix } = composeSystemPrompt.withBreakpoint(baseInput())
    expect(stablePrefix).toContain('# Using your tools')
  })
})

/**
 * `record_facts` types its value as unknown, so without this the model guesses. It guessed
 * "spouse" for a key whose enum is alone/partner/other, and the fact was silently refused.
 */
describe('the fact reference', () => {
  const prompt = composeSystemPrompt(baseInput())

  it('names the allowed values for an enum key', () => {
    expect(prompt).toMatch(/household\.buyingWith.*one of alone, partner, other/)
  })

  it('says which keys belong to a person rather than the household', () => {
    expect(prompt).toMatch(/income\.annualBasic.*\[per person\]/)
    expect(prompt).not.toMatch(/household\.dependantCount.*\[per person\]/)
  })

  it('describes numbers as digits, so a model does not write them out in words', () => {
    expect(prompt).toMatch(/income\.annualBasic.*digits only/)
  })

  it('never lists a key the model is forbidden from writing (Invariant 6)', () => {
    expect(prompt).not.toContain('protection.health.smoker')
    expect(prompt).not.toContain('protection.health.conditions')
  })

  it('is part of the cacheable prefix, since the catalogue never varies by case', () => {
    const { stablePrefix } = composeSystemPrompt.withBreakpoint(baseInput())
    expect(stablePrefix).toContain('# Facts you can record')
  })
})

/**
 * The voice is what stops the prompt being 32 prohibitions and nothing else, which produced a
 * model that sounded like a compliance document. §13, §16, §63 priority 2.
 */
describe('voice', () => {
  const prompt = composeSystemPrompt(baseInput())

  it('tells the model who it is, not only what it may not do', () => {
    expect(prompt).toContain('# Who you are')
    expect(prompt).toMatch(/good company|worth talking to/i)
  })

  it('demonstrates the voice rather than only describing it', () => {
    // A model mirrors an example far better than it follows an adjective.
    expect(prompt).toMatch(/Bad:/)
    expect(prompt).toMatch(/Good:/)
  })

  it('bans the throat-clearing that makes a bot sound like a bot', () => {
    for (const phrase of [
      'I can help you with that',
      'Based on what you',
      'Is there anything else',
    ]) {
      expect(prompt).toContain(phrase)
    }
  })

  it('groups related questions but still refuses to become a form', () => {
    // "One question at a time" read well and played badly: a mortgage has dozens of
    // requirements, so it turned the conversation into forty timed turns.
    expect(prompt).toMatch(/related things together/i)
    expect(prompt).toMatch(/never a bulleted list/i)
  })

  it('refuses to ask twice for the same number in different words', () => {
    expect(prompt).toMatch(/never ask twice for the same number/i)
  })

  it('guarantees the AI disclosure from policy, where no persona can remove it (§16, §18)', () => {
    for (const preset of ['default', 'dry_humour', 'poetic', 'formal'] as const) {
      const composed = composeSystemPrompt({ ...baseInput(), sliders: slidersFor(preset) })
      expect(composed, preset).toMatch(/never claim to be a human/i)
    }
  })

  it('still suppresses the wit on a sensitive turn, warmth intact (§50)', () => {
    const sensitive = composeSystemPrompt({ ...baseInput(), sensitive: true })
    expect(sensitive).toContain('No jokes.')
    expect(sensitive).toContain('No sarcasm at all.')
    expect(sensitive).toMatch(/Be plain, warm and brief/)
  })
})

describe('switching guidance', () => {
  it('sits in the cached prefix when the tenant publishes it, and is absent otherwise', () => {
    const guidance = '# Switching a mortgage to us\n\nThe eight steps.'
    const withIt = composeSystemPrompt.withBreakpoint({
      ...baseInput(),
      switchingGuidance: guidance,
    })
    expect(withIt.stablePrefix).toContain(guidance)
    expect(withIt.caseSuffix).not.toContain(guidance)

    const without = composeSystemPrompt.withBreakpoint(baseInput())
    expect(without.stablePrefix).not.toContain('Switching a mortgage')
  })

  it('tells the model a mortgage is the exception to "no forms"', () => {
    expect(composeSystemPrompt(baseInput())).toContain('The exception is a mortgage')
  })
})

describe('linked accounts in the digest (open banking, simulated)', () => {
  it('says nothing at all when nothing is linked', () => {
    expect(composeSystemPrompt(baseInput())).not.toContain('## Linked accounts')
  })

  it('lists each account, what was read off the transactions, and any transfer', () => {
    const input = baseInput()
    const prompt = composeSystemPrompt({
      ...input,
      digest: {
        ...input.digest,
        linkedAccounts: {
          accounts: [
            { bank: 'AIB', name: 'Current Account', type: 'current', balance: 2_340.5 },
            { bank: 'AIB', name: 'Online Saver', type: 'savings', balance: 32_000 },
          ],
          salary: { monthly: 4_100, annualised: 49_200, employer: 'Acme Ltd', months: 3 },
          rent: { monthly: 1_800 },
          savingsHeld: 32_000,
          daysOfHistory: 90,
          consentEndsOn: '2027-01-20',
          transfers: [
            { amount: 32_000, cadence: 'once', toLabel: 'SuperSaver', state: 'initiated' },
          ],
        },
      },
    })

    const section = prompt.slice(
      prompt.indexOf('## Linked accounts'),
      prompt.indexOf('## Applications'),
    )
    expect(section).toContain('- AIB Current Account (current): €2,341')
    expect(section).toContain('- AIB Online Saver (savings): €32,000')
    expect(section).toContain(
      'Salary seen: €4,100 a month from Acme Ltd, 3 months (about €49,200 a year).',
    )
    expect(section).toContain('Rent seen: €1,800 a month.')
    expect(section).toContain('Savings held there: €32,000.')
    expect(section).toContain('consent that ends 2027-01-20; 90 days of history')
    expect(section).toContain('- Transfer €32,000 once to SuperSaver: initiated')
    // Sits with what is known, before the applications.
    expect(prompt.indexOf('## What you already know')).toBeLessThan(
      prompt.indexOf('## Linked accounts'),
    )
    // Short: it is read on every round of every turn once something is linked.
    expect(section.length).toBeLessThan(700)
  })
})
