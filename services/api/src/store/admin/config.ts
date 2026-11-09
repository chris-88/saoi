import Anthropic from '@anthropic-ai/sdk'
import type { GuardrailTest } from '@shared/contracts/admin.ts'
import { loadProductCatalogue } from '@shared/db/catalogue.ts'
import { createClassifier } from '@shared/llm/classifier.ts'
import { runGate } from '@shared/llm/gate.ts'
import { slidersFor, type PersonaSliders } from '@shared/llm/persona.ts'
import { composeSystemPrompt } from '@shared/llm/prompt.ts'
import { demoDomainConfig } from '@shared/tenants/demo/domain-config.ts'
import { knowledgeBaseSection } from '@shared/tenants/demo/kb-prompt.ts'
import { withMarketData } from '@shared/tenants/demo/market.ts'
import { loadMarket } from '@shared/db/market.ts'
import { ApiError } from '../../errors.ts'
import type { Db } from '../client.ts'
import type { AdminExternals } from './externals.ts'

export type PersonaUpdate = {
  readonly preset?: string | undefined
  readonly sliders?: PersonaSliders | undefined
}

/** Persona, the kill switch, and the two model-backed previews (§39, §56). */
export interface AdminConfigStore {
  setKillSwitch(enabled: boolean): Promise<{ killSwitch: boolean }>
  /** Returns what was written. Throws `bad_request` when there is nothing to set. */
  setPersona(update: PersonaUpdate): Promise<Record<string, unknown>>
  /** The gate, run on demand with the real classifier. Nothing is written. */
  testGuardrail(message: string): Promise<GuardrailTest>
  /** What the persona on screen would sound like, from the real prompt composer. */
  previewPersona(sliders: PersonaSliders, message: string): Promise<{ reply: string }>
}

function requireKey(externals: AdminExternals): string {
  if (externals.anthropicApiKey === undefined || externals.anthropicApiKey === '') {
    throw new ApiError('upstream_unavailable', 'The model is not configured.')
  }
  return externals.anthropicApiKey
}

export function supabaseAdminConfigStore(db: Db, externals: AdminExternals): AdminConfigStore {
  return {
    async setKillSwitch(enabled) {
      const result = await db
        .from('domain_config')
        .update({ kill_switch: enabled })
        .eq('scope', 'global')
      if (result.error) throw new Error(`Could not write domain_config: ${result.error.message}`)
      return { killSwitch: enabled }
    },

    async setPersona(update) {
      const row: { preset?: string; sliders?: PersonaSliders } = {}
      if (update.preset !== undefined) {
        row.preset = update.preset
        row.sliders = slidersFor(update.preset as Parameters<typeof slidersFor>[0])
      }
      // Explicit sliders win, so a preset can be nudged without becoming a different preset.
      if (update.sliders !== undefined) {
        row.sliders = update.sliders
        row.preset = update.preset ?? 'custom'
      }
      if (Object.keys(row).length === 0) throw new ApiError('bad_request', 'Nothing to set.')

      const result = await db
        .from('persona_config')
        .update(row as never)
        .eq('scope', 'global')
      if (result.error) throw new Error(`Could not write persona_config: ${result.error.message}`)
      return row
    },

    async testGuardrail(message) {
      const apiKey = requireKey(externals)
      const config = await db
        .from('domain_config')
        .select('kill_switch')
        .eq('scope', 'global')
        .maybeSingle()

      const classify = createClassifier({
        apiKey,
        model: externals.gateModel,
        domainConfig: demoDomainConfig,
        client: new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 }),
      })

      // No previous turn: a test request stands alone, which is also the hardest case for the
      // classifier and therefore the honest one to show.
      const result = await runGate(message, {
        classify: (text) => classify({ message: text }),
        domainConfig: demoDomainConfig,
        killSwitch: config.data?.kill_switch ?? false,
        tone: 'neutral',
      })

      return {
        category: result.category,
        reachesModel: result.allowed,
        response: result.allowed ? null : result.response,
        reason: result.allowed ? null : result.reason,
        injectionFlagged: result.injectionFlagged,
        profanity: false,
        sensitive: result.allowed ? result.suppressHumour : false,
      }
    },

    async previewPersona(sliders, message) {
      const apiKey = requireKey(externals)
      const anthropic = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 })
      const stream = anthropic.messages.stream({
        model: externals.saoiModel,
        max_tokens: 400,
        system: composeSystemPrompt({
          domainConfig: demoDomainConfig,
          productCatalogue: knowledgeBaseSection(
            withMarketData(
              (await loadProductCatalogue(db)).products,
              (await loadMarket(db)).products,
            ),
          ),
          sliders,
          digest: {
            customerName: null,
            authLevel: 'anonymous',
            facts: [],
            applications: [],
            declinedProducts: [],
            advisories: [],
            partner: null,
            eventsSinceLastSeen: [],
          },
        }),
        messages: [{ role: 'user', content: message }],
      })

      const reply = (await stream.finalMessage()).content
        .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim()
      return { reply }
    },
  }
}
