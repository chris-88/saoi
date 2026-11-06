import { runGate } from '@shared/llm/gate.ts'
import { type Classifier } from '@shared/llm/classifier.ts'
import { type toneBucket } from '@shared/llm/persona.ts'
import { demoDomainConfig } from '@shared/tenants/demo/domain-config.ts'
import { previousAssistantTurn, type LoadedCase } from '@shared/db/loaded-case.ts'

export type TurnGate = Awaited<ReturnType<typeof runGate>>
export type GateBlocked = Extract<TurnGate, { allowed: false }>
export type GateAllowed = Extract<TurnGate, { allowed: true }>

/**
 * The gate (Invariant 4): a customer's message is classified before the model sees anything.
 * A tap, an opening and a return skip it, as they always have.
 */
export async function admit(args: {
  readonly isCustomerTurn: boolean
  readonly customerMessage: string
  readonly loaded: LoadedCase
  readonly classify: Classifier
  readonly tone: ReturnType<typeof toneBucket>
}): Promise<TurnGate> {
  const { isCustomerTurn, customerMessage, loaded, classify, tone } = args

  const gate: TurnGate = isCustomerTurn
    ? await runGate(customerMessage, {
        classify: (message, signal) => {
          const previous = previousAssistantTurn(loaded)
          return classify({
            message,
            ...(previous === undefined ? {} : { previousAssistantTurn: previous }),
            ...(signal === undefined ? {} : { signal }),
          })
        },
        domainConfig: demoDomainConfig,
        killSwitch: loaded.killSwitch,
        tone,
      })
    : ({
        allowed: true,
        category: 'banking',
        clarifyInScope: false,
        suppressHumour: false,
        suppressProductOffers: false,
        profanity: false,
        injectionFlagged: false,
      } as const)
  return gate
}
