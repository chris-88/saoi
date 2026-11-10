import { runGate } from '@shared/llm/gate.ts'
import { type Classifier } from '@shared/llm/classifier.ts'
import { type toneBucket } from '@shared/llm/persona.ts'
import { demoDomainConfig, type DomainConfig } from '@shared/tenants/demo/domain-config.ts'
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
  /**
   * The case holds a comparison the customer brought from their own AI (2026-11-10). Its
   * providers are real banks, so a question about one of them ("the conditions on the Bank of
   * Ireland one") is about their comparison, not a request to compare with a competitor: those
   * reach Saoirse, who answers from the comparison and picks none.
   */
  readonly comparesProviders?: boolean
}): Promise<TurnGate> {
  const { isCustomerTurn, customerMessage, loaded, classify, tone } = args
  const domainConfig =
    args.comparesProviders === true ? withProvidersInScope(demoDomainConfig) : demoDomainConfig

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
        domainConfig,
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

/** The same domain, with questions about other providers let through to Saoirse. */
export function withProvidersInScope(config: DomainConfig): DomainConfig {
  return {
    ...config,
    categories: config.categories.map((category) =>
      category.id === 'competitor' ? { ...category, reachesModel: true } : category,
    ),
  }
}
