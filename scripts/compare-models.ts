/**
 * Runs the same turns through several models and prints what each produced.
 *
 * The point is to make "has quality degraded?" answerable with evidence rather than a feeling.
 * Run it when changing SAOI_MODEL, and whenever a cheaper model starts looking suspect.
 *
 *   node --env-file=.env scripts/compare-models.ts
 *   node --env-file=.env scripts/compare-models.ts claude-haiku-4-5-20251001 claude-sonnet-5-5
 *
 * It calls the model directly with the real composed prompt — no database, so it writes
 * nothing and can be run against any case shape.
 */
import Anthropic from '@anthropic-ai/sdk'
import { runSaoirseTurn } from '../supabase/functions/_shared/llm/saoirse.ts'
import { anthropicProvider } from '../supabase/functions/_shared/llm/anthropic-provider.ts'
import type { PromptInput } from '../supabase/functions/_shared/llm/prompt.ts'
import { slidersFor } from '../supabase/functions/_shared/llm/persona.ts'
import { demoDomainConfig } from '../supabase/functions/_shared/tenants/demo/domain-config.ts'
import { knowledgeBaseSection } from '../supabase/functions/_shared/tenants/demo/kb-prompt.ts'
import {
  bankHeldFacts,
  canonicalCustomer,
} from '../supabase/functions/_shared/domain/seed/canonical.ts'
import { factCatalogue } from '../supabase/functions/_shared/domain/facts.ts'

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set. Try: node --env-file=.env scripts/compare-models.ts')
  process.exit(1)
}

const models =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5']

/** The canonical case as it stands at reset: signed in, bank-held facts, nothing else. */
const prompt: PromptInput = {
  domainConfig: demoDomainConfig,
  productCatalogue: knowledgeBaseSection(),
  sliders: slidersFor('default'),
  digest: {
    customerName: canonicalCustomer.firstName,
    authLevel: 'authenticated',
    facts: bankHeldFacts.map((fact) => ({
      label: factCatalogue[fact.key].label,
      value: String(fact.value),
      source: fact.source,
      verified: fact.verified,
    })),
    applications: [],
    declinedProducts: [],
    advisories: [],
    partner: null,
    eventsSinceLastSeen: [],
  },
}

/** Turns chosen to exercise what actually matters: discovery, agency, scope and sensitivity. */
const turns = [
  {
    id: 'discovery',
    message: 'Hi, my wife and I want to buy our first home. We also just had a baby.',
    looksFor:
      'extracts marriage/child/first-home, offers more than just a mortgage, lets the customer choose',
  },
  {
    id: 'short-answer',
    message: 'about 92k',
    history: [
      { role: 'assistant' as const, content: 'What is your annual basic salary before tax?' },
    ],
    looksFor: 'records income.annualBasic as a number, does not re-ask',
  },
  {
    id: 'product-detail',
    message: 'What rate would I get on the mortgage?',
    looksFor: 'uses the illustrative catalogue figure and says it is illustrative; invents nothing',
  },
  {
    id: 'frustrated',
    message: 'This is taking ages. Why is nothing happening with my mortgage?',
    looksFor: 'reacts like a person, does not open with "I understand that you are frustrated"',
  },
  {
    id: 'sensitive',
    message: 'My husband died last month and I need to sort out the mortgage.',
    looksFor: 'warmth stays, wit goes, no product pitch (§50)',
  },
]

const client = new Anthropic({ apiKey })

for (const model of models) {
  console.log(`\n${'='.repeat(72)}\n${model}\n${'='.repeat(72)}`)

  for (const turn of turns) {
    const text: string[] = []
    const tools: string[] = []
    const started = Date.now()

    const events = runSaoirseTurn({
      provider: anthropicProvider(client),
      model,
      prompt,
      enabledTools: ['record_facts', 'show_product_options', 'show_status'],
      history: [...(turn.history ?? []), { role: 'user', content: turn.message }],
      executeTool: (name, input) => {
        tools.push(`${name}(${JSON.stringify(input)})`)
        return Promise.resolve({ result: 'Done.' })
      },
    })

    for await (const event of events) {
      if (event.type === 'text_delta') text.push(event.text)
    }

    const answer = text.join('').trim()
    console.log(`\n--- ${turn.id} (${((Date.now() - started) / 1000).toFixed(1)}s) ---`)
    console.log(`looking for: ${turn.looksFor}`)
    console.log(`words: ${String(answer.split(/\s+/).length)}`)
    console.log(`tools: ${tools.length === 0 ? 'none' : ''}`)
    for (const tool of tools) console.log(`  ${tool.slice(0, 220)}`)
    console.log(`\n${answer}`)
  }
}
