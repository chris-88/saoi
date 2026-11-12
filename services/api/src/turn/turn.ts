import type { SaoirseTurnRequest } from '@shared/contracts/saoirse-turn.ts'
import { withdraw, type StreamEvent } from '@shared/contracts/stream.ts'
import { loadCase, writeEvent, type Db } from '@shared/db/case-repository.ts'
import { costIn, tokensIn } from '@shared/domain/cost.ts'
import { soundsLikeReturning } from '@shared/domain/continuity.ts'
import { outOfAllowance } from '@shared/llm/gate.ts'
import {
  SIGN_IN_PROMPT_EVENT,
  signInPromptCard,
  worthSigningInFor,
} from '@shared/llm/sign-in-prompt.ts'
import { refusalFor } from '@shared/llm/refusals.ts'
import type { Logger } from '../log.ts'
import { buildGeneration, loadTurnContext } from './context.ts'
import { admit, type GateAllowed } from './gate.ts'
import { createMeter, generate, type ModelFactory } from './generate.ts'
import { caseHasEvent, holdsMarketFigures } from './lookups.ts'
import { persistBlocked, persistReply, recordCustomerTurn } from './persist.ts'
import { markAlertsSeen } from '@shared/db/alerts.ts'
import { just } from './stream.ts'
import type { Market } from '@shared/domain/market/types.ts'
import { supabaseMarketStore } from '../store/market.ts'
import { createToolExecutor } from './tools.ts'

/**
 * A Saoirse turn, in the order that is the point of it: load, gate, persist what was said, build
 * what the model is told, generate, persist the reply. Nothing reaches the model that the gate
 * has not allowed, and the reply is stored only after the tools it called have taken effect, so
 * what the next turn reads is what actually happened.
 *
 * Two phases, because the HTTP response opens between them. Everything before the stream (load,
 * gate, the customer's message, the digest) happens in `startTurn`, and a throw there is the
 * caller's to turn into a single error frame. Everything after is the returned generator, which
 * reports its own failures as an `error` frame, so a stream that has begun always ends cleanly.
 */

export type TurnLimits = {
  /** The whole turn, gate included. Cloudflare cuts a connection at about 100 s. */
  readonly wallClockMs: number
  readonly maxOutputTokens: number
}

export const DEFAULT_TURN_LIMITS: TurnLimits = { wallClockMs: 85_000, maxOutputTokens: 3_072 }

export type TurnDeps = {
  readonly db: Db
  readonly models: ModelFactory
  /** Where the SPA is served; the privacy link on the data notice is built on it. */
  readonly appBaseUrl: string
  readonly limits?: Partial<TurnLimits>
  readonly log?: Logger
  /**
   * The whole market for `show_products`, shared with the comparison API's store so both read
   * one cached load. Unset: a store of the turn's own over the same table.
   */
  readonly market?: () => Promise<Market>
}

export type TurnInput = {
  readonly caseId: string
  /** The caller's seat on the case (the primary; `requireRole` has already said so). */
  readonly participantId: string
  readonly body: SaoirseTurnRequest
}

/** Opens a turn. Resolves to the stream; rejects only for a failure before the stream opens. */
export type TurnRunner = (input: TurnInput) => Promise<AsyncGenerator<StreamEvent>>

export class TurnTimeout extends Error {}

/** A cached market store over the case database, for a runner not handed one. */
function marketLoader(db: Db): () => Promise<Market> {
  const store = supabaseMarketStore(db)
  return () => store.load()
}

const TIMED_OUT = 'That took too long and I lost the thread. Say it again and I will pick it up.'

export function createTurnRunner(deps: TurnDeps): TurnRunner {
  const limits: TurnLimits = { ...DEFAULT_TURN_LIMITS, ...deps.limits }
  const market = deps.market ?? marketLoader(deps.db)

  return async (input) => {
    // Everything below is timed from here, so a slow turn can say where the time went.
    const startedAt = Date.now()
    const admin = deps.db
    const { caseId, participantId, body: turn } = input

    const { loaded, kb, rateTable, savingsOptions, nameFor, tone } = await loadTurnContext(
      admin,
      caseId,
    )

    const meter = createMeter(startedAt)
    const cancel = new AbortController()
    /*
     * Tool calls the server refused this turn, written as events once the stream is done.
     * Collected rather than written as they happen because the stream is still open and an
     * unawaited write can be cut off with it.
     */
    const rejections: { name: string; error: string }[] = []
    const called: string[] = []

    const handle = deps.models({
      loaded,
      onGateUsage: (used) => meter.recordGate(used),
      signal: cancel.signal,
    })

    const customerMessage = turn.message ?? ''
    const isCustomerTurn = turn.trigger === 'message'

    const gate = await admit({
      isCustomerTurn,
      customerMessage,
      loaded,
      classify: handle.classify,
      tone,
      comparesProviders: isCustomerTurn && (await holdsMarketFigures(admin, caseId)),
    })
    meter.gateDone()

    const { pendingNotice, pendingReuse, pendingWelcome, pendingPlan } = await recordCustomerTurn(
      admin,
      {
        turn: { ...turn, caseId },
        participantId,
        customerMessage,
        isCustomerTurn,
        gate,
        loaded,
        appBaseUrl: deps.appBaseUrl,
      },
    )

    if (!gate.allowed) {
      const messageId = await persistBlocked(admin, {
        turn: { ...turn, caseId },
        customerMessage,
        gate,
        pendingNotice,
        usage: meter.usage(),
      })
      return just(
        { type: 'text_delta', text: gate.response },
        ...(pendingNotice === undefined ? [] : [{ type: 'card', card: pendingNotice } as const]),
        { type: 'done', messageId, gateCategory: gate.category },
      )
    }

    // Narrowed here; the generator below is a function of its own and would lose it.
    const allowedGate: GateAllowed = gate

    const generation = await buildGeneration(admin, {
      turn: { ...turn, caseId },
      loaded,
      gate: allowedGate,
      kb,
      savingsOptions,
      customerMessage,
      isCustomerTurn,
    })

    const shown: unknown[] = []
    const spoken: string[] = []

    async function* run(): AsyncGenerator<StreamEvent> {
      try {
        const executeTool = createToolExecutor({
          admin,
          turn: { ...turn, caseId },
          loaded,
          primary: generation.primary,
          gate: allowedGate,
          goals: generation.goals,
          goalContext: generation.goalContext,
          kb,
          rateTable,
          savingsOptions,
          nameFor,
          digest: generation.digest,
          currentAccountPick: generation.currentAccountPick,
          needContext: generation.needContext,
          customerMessage,
          market,
          rejections,
        })

        const events = generate({
          handle,
          generation,
          gate: allowedGate,
          loaded,
          kb,
          rateTable,
          executeTool,
          maxTokens: limits.maxOutputTokens,
          meter,
          rejections,
          called,
        })

        // The plan they brought is the reason for this turn: it is on screen before anything.
        if (pendingPlan !== undefined) {
          shown.push(pendingPlan)
          yield { type: 'card', card: pendingPlan }
        }

        // Before everything, the reuse card included: the account being open is the news, and
        // the model's sentence follows what the customer can already see.
        if (pendingWelcome !== undefined) {
          shown.push(pendingWelcome)
          yield { type: 'card', card: pendingWelcome }
        }

        // First, so it is what the customer sees happen; the model's sentence follows it.
        if (pendingReuse !== undefined) {
          shown.push(pendingReuse)
          yield { type: 'card', card: pendingReuse }
        }

        for await (const event of withinTime(
          events,
          Math.max(1_000, limits.wallClockMs - (Date.now() - startedAt)),
          () => cancel.abort(),
        )) {
          if (event.type === 'text_delta') {
            meter.firstText()
            spoken.push(event.text)
          }
          if (event.type === 'card') shown.push(event.card)
          // Withdrawn from the record as well as the screen: the saved reply is what the
          // customer was left reading, not what was said and then taken back.
          if (event.type === 'retract') {
            spoken.splice(0, spoken.length, withdraw(spoken.join(''), event.length))
          }
          yield event
        }

        // Last, so it reads as a footnote to the answer rather than interrupting it.
        if (pendingNotice !== undefined) {
          shown.push(pendingNotice)
          yield { type: 'card', card: pendingNotice }
        }

        /*
         * The offer to sign in, once there is something it would protect. Checked after the
         * turn because the thing that makes it worth asking, an application, is usually created
         * by the tap that happened during it. Once per case: a prompt that returns every turn
         * is a wall by instalments. A customer who says they were here before is owed the way
         * back whatever the gate says (phrase-matched, narrowly, because a card appearing is
         * not a judgement to leave to a reading of a sentence).
         */
        const after = await loadCase(admin, caseId)
        const asking =
          isCustomerTurn &&
          after !== null &&
          after.authLevel !== 'authenticated' &&
          soundsLikeReturning(customerMessage)

        if (after && (asking || worthSigningInFor(after) || generation.signInForPlan)) {
          const suppressed = !asking && (await caseHasEvent(admin, caseId, SIGN_IN_PROMPT_EVENT))
          if (!suppressed) {
            await writeEvent(admin, {
              caseId,
              type: SIGN_IN_PROMPT_EVENT,
              actor: 'system',
              payload: asking ? { reason: 'returning_cue' } : {},
            })
            const card = signInPromptCard(`${deps.appBaseUrl}#/privacy`)
            shown.push(card)
            yield { type: 'card', card }
          }
        }

        const usage = meter.usage()
        const messageId = await persistReply(admin, {
          turn: { ...turn, caseId },
          text: spoken.join(''),
          shown,
          digest: generation.digest,
          called,
          rejections,
          usage,
        })
        // The reply that stated the unseen alerts is saved: they have been seen. Never fails the turn.
        await markAlertsSeen(admin, caseId, generation.alertIds).catch((error: unknown) => {
          deps.log?.warn('alerts not marked seen', {
            caseId,
            error: error instanceof Error ? error.message : 'unknown',
          })
        })

        deps.log?.info('turn', {
          caseId,
          trigger: turn.trigger,
          rounds: usage.timing?.rounds,
          totalMs: usage.timing?.totalMs,
          tokens: tokensIn(usage),
          costEur: Number(costIn(usage).toFixed(4)),
          refused: rejections.length,
        })

        yield { type: 'status', caseId, invalidate: ['case', 'facts', 'applications'] }
        yield { type: 'done', messageId, gateCategory: gate.category }
      } catch (error) {
        /*
         * Whatever went wrong, the customer does not read the upstream's words. A turn driven
         * by a tap skips the gate, so this is the only place a model failure is handled. Out of
         * allowance gets the same honest line the gate gives, because the advice is the same.
         * Nothing of the reply is persisted: the message is saved only on the way out.
         */
        const detail = error instanceof Error ? error.message : String(error)
        deps.log?.error('turn failed', { caseId, error: detail })

        yield {
          type: 'error',
          error: {
            code: 'upstream_unavailable',
            message:
              error instanceof TurnTimeout
                ? TIMED_OUT
                : outOfAllowance(detail)
                  ? refusalFor('allowance_reached', tone)
                  : 'Something went wrong on my side. Try that again?',
          },
        }
      } finally {
        // Ends a provider call still in flight when the customer leaves or the clock runs out.
        cancel.abort()
      }
    }

    return run()
  }
}

/**
 * Yields what `source` yields, and throws `TurnTimeout` when it has not finished in `ms`. The
 * source is not awaited past that: `onTimeout` aborts whatever it is waiting on.
 */
export async function* withinTime<T>(
  source: AsyncGenerator<T>,
  ms: number,
  onTimeout: () => void,
): AsyncGenerator<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<'expired'>((resolve) => {
    timer = setTimeout(() => resolve('expired'), ms)
  })

  try {
    for (;;) {
      const next = await Promise.race([source.next(), expired])
      if (next === 'expired') {
        onTimeout()
        void source.return(undefined).catch(() => undefined)
        throw new TurnTimeout('The turn ran out of time.')
      }
      if (next.done === true) return
      yield next.value
    }
  } finally {
    clearTimeout(timer)
  }
}
