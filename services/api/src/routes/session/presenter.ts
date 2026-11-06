import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Whether the caller is running the demonstration.
 *
 * The switcher lists every case in the system, which is what a presenter needs and precisely
 * what a stranger must not have: the conversations hold what real people typed. Set
 * PRESENTER_KEY and the menu opens up on the device that has it; leave it unset and nobody
 * gets the wider list. Compared in constant time (as digests, so length does not leak).
 */
export function isPresenter(expected: string, offered: string | undefined): boolean {
  if (expected.length === 0 || offered === undefined) return false
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(expected), digest(offered))
}
