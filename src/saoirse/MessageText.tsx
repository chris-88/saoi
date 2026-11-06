import type { ReactNode } from 'react'

/**
 * What Saoirse said, with the little markdown it actually uses.
 *
 * Bold and bullets, and nothing else. The model reaches for `**label:**` and `- ` when it is
 * listing what changed since somebody was last here — which is the one turn the prompt asks
 * for a list — and the transcript was printing the asterisks.
 *
 * Hand-written rather than a markdown library for two reasons. The surface is two constructs,
 * so a parser that also does tables, images and raw HTML is a lot of behaviour to accept for
 * them. And it builds React nodes rather than HTML, so there is no sanitiser to get wrong:
 * text from the model can only ever become text.
 */
export function MessageText({ text }: { readonly text: string }): ReactNode {
  const blocks = groupIntoBlocks(text.split('\n'))

  return (
    <>
      {blocks.map((block, index) =>
        block.kind === 'list' ? (
          <ul
            // Index keys: the blocks of one finished message, which never reorder.
            key={index}
            className="my-1 list-disc space-y-0.5 pl-4 first:mt-0 last:mb-0"
          >
            {block.items.map((item, at) => (
              <li key={at}>{inline(item)}</li>
            ))}
          </ul>
        ) : (
          <span key={index} className="whitespace-pre-wrap">
            {inline(block.text)}
          </span>
        ),
      )}
    </>
  )
}

type Block = { kind: 'text'; text: string } | { kind: 'list'; items: readonly string[] }

/**
 * Consecutive `- ` lines become one list; everything else stays as it was written.
 *
 * Streaming matters here: a half-arrived list is still a list, and a line that is mid-way
 * through being typed must not flicker between a paragraph and a bullet. Grouping on the
 * prefix alone makes it stable — the line is a bullet the moment the dash and space exist.
 */
function groupIntoBlocks(lines: readonly string[]): readonly Block[] {
  const blocks: Block[] = []
  let items: string[] = []
  let text: string[] = []

  const flushList = (): void => {
    if (items.length === 0) return
    blocks.push({ kind: 'list', items })
    items = []
  }
  const flushText = (): void => {
    if (text.length === 0) return
    blocks.push({ kind: 'text', text: text.join('\n') })
    text = []
  }

  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      flushText()
      items.push(bullet[1] ?? '')
    } else {
      flushList()
      // A blank line between a list and what follows has already done its job as a separator.
      if (!(line.trim() === '' && text.length === 0 && blocks.length > 0)) text.push(line)
    }
  }

  flushList()
  flushText()
  return blocks
}

/** `**bold**`, and nothing else. An unclosed `**` mid-stream stays as typed. */
function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((part) => part !== '')

  return parts.map((part, index) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={index} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  )
}
