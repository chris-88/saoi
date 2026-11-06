import { describe, expect, it } from 'vitest'
import { sweepUsers, type UserStore } from './purge-users.ts'

/**
 * Stands in for GoTrue's admin listing, including the part that matters: the list shrinks as
 * users are deleted, so a page read after a delete is not the page read before it.
 *
 * `perPage` is deliberately small in the tests. The real cap is 200, and a fake that never
 * fills a page cannot catch a sweep that pages forward.
 */
function fakeStore(
  ids: readonly string[],
  options: { readonly perPage?: number; readonly refuse?: readonly string[] } = {},
): UserStore & { readonly remaining: () => readonly string[]; readonly listings: () => number } {
  const perPage = options.perPage ?? 200
  const refuse = new Set(options.refuse ?? [])
  let live = [...ids]
  let listings = 0

  return {
    list: async () => {
      listings += 1
      return await Promise.resolve({
        users: live.slice(0, perPage).map((id) => ({ id })),
        error: null,
      })
    },
    remove: async (id: string) => {
      if (refuse.has(id)) return await Promise.resolve({ error: { message: 'cannot delete' } })
      live = live.filter((candidate) => candidate !== id)
      return await Promise.resolve({ error: null })
    },
    remaining: () => live,
    listings: () => listings,
  }
}

describe('sweepUsers', () => {
  it('removes the visitors and keeps the administrators', async () => {
    const store = fakeStore(['admin', 'joe', 'anon-1', 'anon-2'])

    const result = await sweepUsers(store, new Set(['admin']))

    expect(result).toEqual({ removed: 3, error: null })
    expect(store.remaining()).toEqual(['admin'])
  })

  /**
   * The bug this file exists for.
   *
   * The first version read pages forward while deleting, so emptying page one and then asking
   * for page two stepped over the ten users who had moved up into the page just cleared. The
   * interface here cannot express that, since `list` takes no page: what this guards instead is
   * the same failure's surviving shape, a sweep that clears one page and calls it done. Drop
   * the pass bound to one and it fails. Either way, users are left signed in and the only
   * symptom is a returning browser being recognised.
   */
  it('clears more users than fit on one page', async () => {
    const ids = ['admin', ...Array.from({ length: 24 }, (_, index) => `anon-${String(index)}`)]
    const store = fakeStore(ids, { perPage: 10 })

    const result = await sweepUsers(store, new Set(['admin']))

    expect(result).toEqual({ removed: 24, error: null })
    expect(store.remaining()).toEqual(['admin'])
  })

  it('stops when a pass removes nobody, rather than spinning', async () => {
    const store = fakeStore(['admin', 'stuck', 'joe'], { refuse: ['stuck'] })

    const result = await sweepUsers(store, new Set(['admin']))

    // The deletable one goes, the refused one is reported by being left behind, and the sweep
    // ends after the pass that achieved nothing instead of retrying it forty times.
    expect(result.removed).toBe(1)
    expect(store.remaining()).toEqual(['admin', 'stuck'])
    expect(store.listings()).toBeLessThanOrEqual(3)
  })

  it('does nothing when only administrators are left', async () => {
    const store = fakeStore(['admin'])

    const result = await sweepUsers(store, new Set(['admin']))

    expect(result).toEqual({ removed: 0, error: null })
    expect(store.listings()).toBe(1)
  })

  it('reports a listing failure and keeps what it already removed', async () => {
    let calls = 0
    const store: UserStore = {
      list: async () => {
        calls += 1
        if (calls === 1) {
          return await Promise.resolve({ users: [{ id: 'joe' }, { id: 'anon' }], error: null })
        }
        return await Promise.resolve({ users: [], error: { message: 'listing failed' } })
      },
      remove: async () => await Promise.resolve({ error: null }),
    }

    const result = await sweepUsers(store, new Set())

    expect(result).toEqual({ removed: 2, error: 'listing failed' })
  })
})
