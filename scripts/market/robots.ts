/**
 * Whether robots.txt lets a generic crawler fetch a path.
 *
 * Reads only the `User-agent: *` group, which is the one that applies to us, with Google's
 * pattern rules: `*` matches anything, a trailing `$` anchors the end, and the longest
 * matching rule wins with Allow beating Disallow on a tie.
 */
export function robotsAllows(robots: string, path: string): boolean {
  const rules: { allow: boolean; pattern: string }[] = []
  let inStarGroup = false
  let lastWasAgent = false

  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (line.length === 0) continue
    const [field = '', ...rest] = line.split(':')
    const key = field.trim().toLowerCase()
    const value = rest.join(':').trim()

    if (key === 'user-agent') {
      // Consecutive agent lines form one group.
      inStarGroup = (lastWasAgent && inStarGroup) || value === '*'
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!inStarGroup) continue
    if ((key === 'allow' || key === 'disallow') && value.length > 0) {
      rules.push({ allow: key === 'allow', pattern: value })
    }
  }

  const matching = rules.filter((rule) => matches(rule.pattern, path))
  if (matching.length === 0) return true
  const best = matching.sort(
    (a, b) => b.pattern.length - a.pattern.length || Number(b.allow) - Number(a.allow),
  )[0]
  return best?.allow ?? true
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const regex = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${regex}${anchored ? '$' : ''}`).test(path)
}
