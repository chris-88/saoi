import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A quotation from a machine, rendered as one.
 *
 * Shared by the explainer and the admin console's digital-forms screen, because both are
 * showing the same kind of thing: a published definition and the wire packet it produces.
 * One highlighter, so the two cannot drift into looking like different claims.
 */
export function Code({
  text,
  language,
  className,
}: {
  readonly text: string
  readonly language: 'json' | 'wire' | 'ts'
  readonly className?: string
}): ReactNode {
  /*
   * Dark, always, whatever the page around it is doing.
   *
   * A code block is a quotation from a machine and it should look like one: the page is a light
   * editorial surface, and the published definition and the wire packet are the two things on it
   * that are not prose. The `dark` class is how this codebase switches themes, and it redefines
   * every token beneath it, so the syntax colours here are the dark variants that were tuned
   * for a dark background rather than a second set picked by hand.
   */
  return (
    <div className={cn('dark bg-card min-w-0 overflow-hidden', className)}>
      <pre className="text-foreground overflow-x-auto p-4 font-mono text-[12px] leading-[1.7] whitespace-pre">
        <code>
          {text.split('\n').map((line, index) => (
            <span key={`${String(index)}-${line}`} className="block">
              {colour(line, language)}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

/** One line, split into coloured spans. Deliberately small: it only handles these blocks. */
function colour(line: string, language: 'json' | 'wire' | 'ts'): ReactNode {
  if (language === 'wire') {
    const match = /^(\s*)([\w[\].]+)(\s*=\s*)(.*)$/.exec(line)
    if (!match) return line
    return (
      <>
        {match[1]}
        <span className="text-code-key">{match[2]}</span>
        <span className="text-muted-foreground">{match[3]}</span>
        <span className="text-code-string">{match[4]}</span>
      </>
    )
  }

  if (language === 'ts') {
    if (line.trim().startsWith('//')) return <span className="text-code-comment">{line}</span>
    return line.split(/(\b(?:const|return|await|if|import|from)\b)/g).map((part, index) =>
      /^(const|return|await|if|import|from)$/.test(part) ? (
        <span key={`${String(index)}-${part}`} className="text-code-keyword">
          {part}
        </span>
      ) : (
        <span key={`${String(index)}-${part}`}>{part}</span>
      ),
    )
  }

  return line
    .split(
      /("(?:[^"\\]|\\.)*"\s*:|"(?:[^"\\]|\\.)*"|\b\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/g,
    )
    .map((part, index) => {
      const key = `${String(index)}-${part}`
      if (/^"(?:[^"\\]|\\.)*"\s*:$/.test(part)) {
        return (
          <span key={key} className="text-code-key">
            {part}
          </span>
        )
      }
      if (/^"(?:[^"\\]|\\.)*"$/.test(part)) {
        return (
          <span key={key} className="text-code-string">
            {part}
          </span>
        )
      }
      if (/^(\d|true|false|null)/.test(part)) {
        return (
          <span key={key} className="text-code-number">
            {part}
          </span>
        )
      }
      return <span key={key}>{part}</span>
    })
}

/**
 * A miniature of a real interface, for the before and after of a pivot.
 *
 * Text lists did not work. "Products, Plans, Applications, Navigation" reads as four words,
 * where four stacked tiles read as the screen somebody deleted, and the deleting is the point
 * of that whole section.
 */
