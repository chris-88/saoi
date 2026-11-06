import type { Context } from 'hono'
import type { SessionResponse } from '@shared/contracts/session.ts'
import type { AppEnv } from '../../context.ts'
import { ApiError } from '../../errors.ts'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Opens a fresh case for the caller (§47).
 *
 * A ceiling on a burst, not on a lifetime: it counts customer cases created in the last day, so
 * a room full of people cannot exhaust the project in an afternoon and the cap never
 * accumulates into a wall. Everyone gets a case of their own that knows nothing about them yet;
 * the bank learns who somebody is when they sign in. `source` is kept from the start and never
 * rewritten; `new_case` carries none.
 */
export async function openCase(
  c: Context<AppEnv>,
  mode: 'new' | 'known',
  source: string | null,
): Promise<SessionResponse> {
  const sessions = c.get('sessions')
  const since = new Date(Date.now() - DAY_MS).toISOString()
  if ((await sessions.customerCasesSince(since)) >= c.get('config').audienceMaxCases) {
    throw new ApiError(
      'rate_limited',
      'The demonstration is at capacity right now. Try again in a few minutes.',
    )
  }

  const created = await sessions.createCase({ userId: c.get('user').id, mode, source })
  return sessions.describe(
    { participantId: created.participantId, caseId: created.caseId, role: 'primary' },
    c.get('identity'),
    true,
  )
}
