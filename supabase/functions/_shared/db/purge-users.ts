/**
 * Clearing the sign-ins, which a purge used to leave behind.
 *
 * Deleting every case left every auth user standing, so a browser that had been here before
 * still resolved to a real account on its next visit: recognised, handed a fresh case, never
 * asked to sign in. Which is exactly what somebody resetting between run-throughs is testing.
 *
 * This lives apart from the `admin` function because the first version of it was wrong in a
 * way reading could not catch, and a Deno handler cannot be unit tested. The client is reduced
 * to the two calls it needs, so `purge-users.test.ts` can drive it with a fake that shrinks
 * the way GoTrue's listing really does.
 */

export type AuthUserRef = { readonly id: string }

export type UserStore = {
  /** The first page of users. Order does not matter; the sweep never asks for a second page. */
  readonly list: () => Promise<{
    readonly users: readonly AuthUserRef[]
    readonly error: { readonly message: string } | null
  }>
  readonly remove: (id: string) => Promise<{ readonly error: { readonly message: string } | null }>
}

export type SweepResult = {
  readonly removed: number
  /** Set when the listing failed. The caller reports it; a partial sweep still counts. */
  readonly error: string | null
}

/** Deletes in parallel, because serial was a round trip per visitor. */
const BATCH = 10

/**
 * Bounded so a store that keeps handing back users it will not delete cannot spin forever.
 * Forty passes of a full page is eight thousand users, well past anything a demo day leaves.
 */
const MAX_PASSES = 40

/**
 * Removes every user except those in `keep`, which is the administrators.
 *
 * Administrators are kept because they are the only way back into the console, and purging
 * yourself out of it is not a reset, it is a lockout.
 *
 * Always reads the first page, never the second. Deleting shortens the list under us, so
 * paging forward steps over whoever moved up into the page just emptied: that is how the first
 * version of this silently left half the visitors signed in. Re-reading page one terminates on
 * the right set instead, because eventually it holds nothing but the kept users.
 */
export async function sweepUsers(
  store: UserStore,
  keep: ReadonlySet<string>,
): Promise<SweepResult> {
  let removed = 0

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const listed = await store.list()
    if (listed.error) return { removed, error: listed.error.message }

    const doomed = listed.users.filter((user) => !keep.has(user.id))
    if (doomed.length === 0) return { removed, error: null }

    /*
     * A pass that removes nobody ends it. Without this, a user the store refuses to delete
     * would be listed, attempted and listed again until the pass bound ran out, turning one
     * stuck account into eight thousand pointless calls.
     */
    let progressed = false

    for (let at = 0; at < doomed.length; at += BATCH) {
      const batch = doomed.slice(at, at + BATCH)
      const results = await Promise.all(batch.map(async (user) => await store.remove(user.id)))
      for (const result of results) {
        if (!result.error) {
          removed += 1
          progressed = true
        }
      }
    }

    if (!progressed) return { removed, error: null }
  }

  return { removed, error: null }
}
