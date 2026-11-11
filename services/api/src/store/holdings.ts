import type { Holding, UpdateHoldingBody } from '@shared/contracts/holdings.ts'
import {
  type HoldingInput,
  createHolding,
  deleteHolding,
  loadHoldings,
  updateHolding,
} from '@shared/db/holdings.ts'
import type { Db } from './client.ts'

/**
 * A case's holdings (`holdings`) for the routes: list (not deleted), create, update and soft
 * delete, each keeping the holding's reminder in step, through the shared helpers the turn's
 * `record_holding` uses too. Seeding from a claimed plan is the plan store's `recordClaim`.
 */
export type HoldingWriteContext = {
  readonly caseId: string
  readonly participantId: string | null
  /** YYYY-MM-DD in Europe/Dublin. */
  readonly today: string
}

export type HoldingStore = {
  list(caseId: string): Promise<Holding[]>
  create(context: HoldingWriteContext, input: HoldingInput): Promise<Holding>
  /** Null when there is no such holding on the case. */
  update(
    context: HoldingWriteContext,
    id: string,
    patch: UpdateHoldingBody,
  ): Promise<Holding | null>
  /** False when there is no such holding on the case. */
  remove(context: HoldingWriteContext, id: string): Promise<boolean>
}

export function supabaseHoldingStore(db: Db): HoldingStore {
  return {
    list: (caseId) => loadHoldings(db, caseId),
    create: (context, input) => createHolding(db, { ...context, actor: 'customer' }, input),
    update: (context, id, patch) => updateHolding(db, { ...context, actor: 'customer' }, id, patch),
    remove: (context, id) => deleteHolding(db, { ...context, actor: 'customer' }, id),
  }
}
