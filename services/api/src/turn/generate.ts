import Anthropic from '@anthropic-ai/sdk'
import type { StreamEvent } from '@shared/contracts/stream.ts'
import type { LoadedCase } from '@shared/db/loaded-case.ts'
import { type loadMortgageRates, type loadProductCatalogue } from '@shared/db/catalogue.ts'
import { EMPTY_USAGE, addUsage, type ModelUsage, type TurnUsage } from '@shared/domain/cost.ts'
import { anthropicProvider } from '@shared/llm/anthropic-provider.ts'
import { runSaoirseTurn, type ToolExecutor } from '@shared/llm/saoirse.ts'
import { createClassifier, type Classifier } from '@shared/llm/classifier.ts'
import { FIXTURE_BANKING, fixtureProvider } from '@shared/llm/fixture-provider.ts'
import type { ModelProvider } from '@shared/llm/model.ts'
import { demoDomainConfig } from '@shared/tenants/demo/domain-config.ts'
import { knowledgeBaseSection } from '@shared/tenants/demo/kb-prompt.ts'
import { mortgageRatesSection } from '@shared/tenants/demo/mortgage-rates-select.ts'
import { switchingSection } from '@shared/tenants/demo/switching.ts'
import { saoiDomainConfig } from '@shared/llm/market-prompt.ts'
import type { PromptInput } from '@shared/llm/prompt.ts'
import { fixtureScript } from './fixtures/index.ts'
import type { GateAllowed } from './gate.ts'
import { toolsForTurn } from './stage.ts'
import type { Generation } from './context.ts'

/**
 * The model behind a turn: the provider that streams Saoirse's reply and the classifier that gates
 * the customer's message. An explicit dependency, chosen once at start-up from `LLM_PROVIDER`,
 * so a test hands in the fixture and no code path in here can reach the network by accident.
 */
export type ModelHandle = {
  readonly provider: ModelProvider
  readonly model: string
  readonly classify: Classifier
}

export type ModelFactory = (args: {
  /** The case as loaded: the fixture picks its turn by how many times Saoirse has already spoken. */
  readonly loaded: LoadedCase
  readonly onGateUsage: (used: ModelUsage) => void
  /** Aborted when the turn runs out of time or the customer leaves. */
  readonly signal: AbortSignal
}) => ModelHandle

/**
 * The real model. The SDK default timeout is ten minutes, far longer than a turn may live, so
 * a stalled call is bounded here and fails as an error rather than as a hang.
 */
export function anthropicModels(options: {
  readonly apiKey: string
  readonly saoiModel: string
  readonly gateModel: string
  readonly timeoutMs: number
}): ModelFactory {
  return ({ onGateUsage, signal }) => {
    const client = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs,
      maxRetries: 1,
    })
    return {
      provider: anthropicProvider(client, { signal }),
      model: options.saoiModel,
      classify: createClassifier({
        apiKey: options.apiKey,
        model: options.gateModel,
        domainConfig: demoDomainConfig,
        client,
        onUsage: onGateUsage,
      }),
    }
  }
}

/**
 * Replays a script from `services/api/src/turn/fixtures/` instead of calling Anthropic.
 * The turn within the script is chosen by how many times Saoirse has already spoken on the case, so
 * a scripted conversation advances as a real one does. Past the end of the script the turn
 * fails before anything is stored, as the Edge Function's did.
 */
export function fixtureModels(options: { readonly fixture: string }): ModelFactory {
  return ({ loaded }) => {
    const script = fixtureScript(options.fixture)
    const ordinal = loaded.messages.filter((message) => message.role === 'assistant').length
    const turn = script.turns[ordinal]

    if (turn === undefined) {
      throw new Error(
        `Fixture "${options.fixture}" has ${String(script.turns.length)} turn(s) and this is turn ${String(ordinal + 1)}.`,
      )
    }

    return {
      provider: fixtureProvider(turn),
      model: `fixture:${options.fixture}`,
      classify: () => Promise.resolve(turn.gate ?? FIXTURE_BANKING),
    }
  }
}

/** What this turn consumed and how long it took, accumulated as it happens. */
export function createMeter(startedAt: number) {
  let spend: TurnUsage = EMPTY_USAGE
  let rounds = 0
  let coldPrefix = false
  let firstTextMs: number | null = null
  let gateMs = 0

  return {
    recordModel(used: ModelUsage): void {
      spend = addUsage(spend, { model: used, gate: EMPTY_USAGE.gate })
      rounds += 1
      // The stable prefix is written, not read, on the first round after the cache went cold.
      // A later breakpoint writes a few thousand tokens every turn; the prefix is tens.
      if (rounds === 1 && used.cacheWrite >= 15_000) coldPrefix = true
    },
    recordGate(used: ModelUsage): void {
      spend = addUsage(spend, { model: EMPTY_USAGE.model, gate: used })
    },
    gateDone(): void {
      gateMs = Date.now() - startedAt
    },
    firstText(): void {
      if (firstTextMs === null) firstTextMs = Date.now() - startedAt
    },
    /** The usage as the message row stores it: tokens plus where the time went. */
    usage(): TurnUsage {
      return {
        ...spend,
        timing: { gateMs, firstTextMs, totalMs: Date.now() - startedAt, rounds, coldPrefix },
      }
    },
  }
}

export type Meter = ReturnType<typeof createMeter>

/**
 * Saoirse's reply as stream events: text, retractions and cards, in the order `runSaoirseTurn` gives
 * them. `done` and `error` belong to the caller, which owns the message id.
 */
export function generate(args: {
  readonly handle: ModelHandle
  readonly generation: Generation
  readonly gate: GateAllowed
  readonly loaded: LoadedCase
  readonly kb: Awaited<ReturnType<typeof loadProductCatalogue>>
  readonly rateTable: Awaited<ReturnType<typeof loadMortgageRates>>
  readonly executeTool: ToolExecutor
  readonly maxTokens: number
  readonly meter: Meter
  readonly rejections: { name: string; error: string }[]
  readonly called: string[]
  /**
   * The market's catalogue section (`marketCatalogueSection`) for a market conversation, the
   * case holding a claimed plan or holdings; null for a Demo Bank conversation.
   */
  readonly marketCatalogue: string | null
}): AsyncGenerator<StreamEvent> {
  const { handle, generation } = args

  return runSaoirseTurn({
    provider: handle.provider,
    model: handle.model,
    maxTokens: args.maxTokens,
    /*
     * The form tool is offered only when there is a form to answer. A tool the model can see is
     * a tool it will eventually try, and on a case with no form-backed application every call
     * would be refused by the server and spend a round doing it.
     */
    enabledTools: toolsForTurn(
      generation.stage,
      generation.digest.forms !== undefined,
      generation.hasFigures,
    ),
    // The return turn after a plan edit is text only (`returnsAfterPlanEdit`).
    textOnly: generation.afterPlanEdit,
    onToolRejected: (rejection) => args.rejections.push(rejection),
    onToolCalled: (name) => args.called.push(name),
    onUsage: (used) => args.meter.recordModel(used),
    prompt: promptFor(args),
    history: generation.history,
    executeTool: args.executeTool,
  })
}

/**
 * What the system prompt is built from this turn. A market conversation (the case holds a
 * claimed plan or holdings) is told the market and Saoi's scope, with none of Demo Bank's
 * catalogue, rate table or switching guidance (2026-11-13); every other case is the Demo Bank
 * POC as before. The persona and the digest are the same either way.
 */
export function promptFor(args: {
  readonly generation: Generation
  readonly gate: GateAllowed
  readonly loaded: LoadedCase
  readonly kb: Awaited<ReturnType<typeof loadProductCatalogue>>
  readonly rateTable: Awaited<ReturnType<typeof loadMortgageRates>>
  readonly marketCatalogue: string | null
}): PromptInput {
  const shared = {
    sliders: args.loaded.persona,
    digest: args.generation.digest,
    sensitive: args.gate.suppressHumour,
    clarifyInScope: args.gate.clarifyInScope,
  }
  if (args.marketCatalogue !== null) {
    return {
      ...shared,
      domainConfig: saoiDomainConfig,
      productCatalogue: args.marketCatalogue,
      marketConversation: true,
    }
  }
  return {
    ...shared,
    domainConfig: demoDomainConfig,
    productCatalogue: knowledgeBaseSection(args.kb.products),
    rateGuidance: mortgageRatesSection(args.rateTable),
    switchingGuidance: switchingSection(),
  }
}
