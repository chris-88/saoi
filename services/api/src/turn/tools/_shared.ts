import type { SaoirseTurnRequest } from '@shared/contracts/saoirse-turn.ts'
import type { GateAllowed } from '../gate.ts'
import type { NameFor } from '@shared/db/applications.ts'
import type { savingsOptionsFrom } from '@shared/tenants/demo/savings-options.ts'
import type { suitableCurrentAccount } from '@shared/tenants/demo/current-accounts.ts'
import type { loadMortgageRates, loadProductCatalogue } from '@shared/db/catalogue.ts'
import type { Db } from '@shared/db/case-repository.ts'
import type { buildCaseDigest } from '@shared/db/digest.ts'
import type { needContextFor } from '@shared/db/needs.ts'
import type { describeGoals, goalContextFor } from '@shared/db/goals.ts'
import type { LoadedCase } from '@shared/db/loaded-case.ts'
import type { ToolOutcome } from '@shared/llm/saoirse.ts'
import type { ToolName, TOOL_INPUTS } from '@shared/llm/tools.ts'
import type { Market } from '@shared/domain/market/types.ts'
import type { z } from 'zod'

/** Everything a tool call reads: the case as this turn loaded it, and what was worked out from it. */
export type ToolContext = {
  readonly admin: Db
  readonly turn: SaoirseTurnRequest
  readonly loaded: LoadedCase
  readonly primary: string | null
  readonly gate: GateAllowed
  readonly goals: ReturnType<typeof describeGoals>
  readonly goalContext: ReturnType<typeof goalContextFor>
  readonly kb: Awaited<ReturnType<typeof loadProductCatalogue>>
  readonly rateTable: Awaited<ReturnType<typeof loadMortgageRates>>
  readonly savingsOptions: ReturnType<typeof savingsOptionsFrom>
  readonly nameFor: NameFor
  readonly digest: ReturnType<typeof buildCaseDigest>
  readonly currentAccountPick: ReturnType<typeof suitableCurrentAccount>
  readonly needContext: ReturnType<typeof needContextFor>
  readonly customerMessage: string
  /**
   * The whole market, normalised (the comparison API's store, held ten minutes). Read only by
   * the tools that compare across providers (`show_products`); every other tool speaks from the
   * Demo Bank catalogue as before.
   */
  readonly market: () => Promise<Market>
  /** Refusals, written as events once the stream is done. */
  readonly rejections: { name: string; error: string }[]
}

/** One tool: its name as the model calls it, and what running it does. */
export type ToolModule<N extends ToolName> = {
  readonly name: N
  run(input: z.infer<(typeof TOOL_INPUTS)[N]>, ctx: ToolContext): Promise<ToolOutcome> | ToolOutcome
}

/** Whole euros, the way every card and sentence writes them. */
export const money = (amount: number): string => `€${Math.round(amount).toLocaleString('en-IE')}`
