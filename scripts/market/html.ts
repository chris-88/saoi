/**
 * Just enough HTML handling to read a product page as lines of text, with no dependency.
 *
 * The pages are server-rendered WordPress. A table row becomes one line with its cells joined
 * by " | ", so a rate table reads as `6 Month 25% access | 0.99% | 2.01%`; every block element
 * starts a new line; entities are decoded and whitespace (including non-breaking spaces)
 * collapsed. The parsers match sentences on these lines, so they never depend on markup.
 */

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  euro: '€',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    }
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    return NAMED[body.toLowerCase()] ?? whole
  })
}

const stripTags = (html: string): string => html.replace(/<[^>]+>/g, ' ')

const tidy = (text: string): string =>
  decodeEntities(text)
    .replace(/[\u00a0\u2009\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export function htmlToLines(html: string): readonly string[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|nav)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_row, inner: string) => {
      const cells = [...inner.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
        tidy(stripTags(cell[1] ?? '')),
      )
      return `\n${cells.join(' | ')}\n`
    })
    .replace(
      /<\/?(p|div|li|ul|ol|h[1-6]|br|table|tbody|thead|section|article|header|footer)\b[^>]*>/gi,
      '\n',
    )

  return stripTags(body)
    .split('\n')
    .map(tidy)
    .filter((line) => line.length > 0)
}

/** The page's first `<h1>`, or the first segment of its `<title>`. */
export function headingOf(html: string): string | null {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]
  if (h1 !== undefined && tidy(stripTags(h1)).length > 0) return tidy(stripTags(h1))
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  if (title === undefined) return null
  return tidy(title).split(/\s+[|–-]\s+/)[0] ?? null
}

/** Every `href` on the page, decoded. */
export function linksOf(html: string): readonly string[] {
  return [...html.matchAll(/href="([^"]+)"/gi)].map((match) => decodeEntities(match[1] ?? ''))
}
