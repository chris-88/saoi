import { describe, expect, it } from 'vitest'
import type { Db } from './client.ts'
import { hasUpdatesSince } from './sessions.ts'

/**
 * `hasUpdates` on `POST /api/sessions`: news is a narratable event after `last_seen_at`. A plan
 * edited in the profile is news (2026-11-12, "6. The saving months"), so the app runs the return
 * turn that says what the edit did.
 */
function eventsDb(events: readonly { type: string; createdAt: string }[], lastSeen: string | null) {
  const from = (table: string): unknown => {
    const filters: { in?: string[]; gt?: string } = {}
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: (_column: string, values: string[]) => {
        filters.in = values
        return builder
      },
      gt: (_column: string, value: string) => {
        filters.gt = value
        return builder
      },
      maybeSingle: () =>
        Promise.resolve({
          data: table === 'cases' ? { last_seen_at: lastSeen } : null,
          error: null,
        }),
      then: (resolve: (value: unknown) => void) => {
        const count = events.filter(
          (event) =>
            (filters.in ?? []).includes(event.type) &&
            (filters.gt === undefined || event.createdAt > filters.gt),
        ).length
        resolve({ count, error: null })
      },
    }
    return builder
  }
  return { from } as unknown as Db
}

describe('whether there is news since they were last seen', () => {
  const SEEN = '2026-11-20T10:00:00.000Z'

  it('counts a plan edited after they were last seen', async () => {
    const db = eventsDb([{ type: 'plan_edited', createdAt: '2026-11-20T10:05:00.000Z' }], SEEN)
    expect(await hasUpdatesSince(db, 'case-1')).toBe(true)
  })

  it('stops once it is seen, and ignores events that are not news', async () => {
    expect(
      await hasUpdatesSince(
        eventsDb([{ type: 'plan_edited', createdAt: '2026-11-20T09:00:00.000Z' }], SEEN),
        'case-1',
      ),
    ).toBe(false)
    expect(
      await hasUpdatesSince(
        eventsDb([{ type: 'holding_changed', createdAt: '2026-11-20T10:05:00.000Z' }], SEEN),
        'case-1',
      ),
    ).toBe(false)
    expect(await hasUpdatesSince(eventsDb([], null), 'case-1')).toBe(false)
  })
})
