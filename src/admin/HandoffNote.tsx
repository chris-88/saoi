import { useState, type ReactNode } from 'react'
import { AlertTriangleIcon, CheckIcon, CopyIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { AdminCase } from '@contracts/admin.ts'

/**
 * What a person reads before picking up the phone.
 *
 * The point of the whole system, from the customer's side, is not having to start again. That
 * only holds if whoever answers can see what was agreed — so this is the first tab, and it is
 * composed from the case rather than written by a model. Somebody is going to act on it.
 *
 * Two columns, because the cautions are not a footnote. Read down the left and the last thing
 * you see is a check-in agenda; pinned to the right, "they already said no to a mortgage" is
 * still on screen when the call starts.
 */
export function HandoffNote({ handoff }: { readonly handoff: AdminCase['handoff'] }): ReactNode {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard
      .writeText(handoff.text)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      // Clipboard access is refused often enough that failing loudly would be worse than the
      // button quietly doing nothing; the note is on screen either way.
      .catch(() => undefined)
  }

  const cautions = handoff.sections.filter((section) => section.caution)
  const body = handoff.sections.filter((section) => !section.caution)

  return (
    <div className="@3xl:grid-cols-[1fr_20rem] grid items-start gap-6">
      <Card className="min-w-0">
        <CardContent className="space-y-6">
          {body.map((section, index) => (
            <div key={section.heading} className="space-y-2">
              {index > 0 && <Separator className="mb-6" />}
              <h3 className="text-sm font-semibold">{section.heading}</h3>
              <ul className="max-w-prose space-y-1.5">
                {section.lines.map((line) => (
                  <li
                    key={line}
                    className="text-muted-foreground text-sm"
                    // Nested detail — a check-in agenda under its check-in — is indented in the
                    // source rather than restructured, so the text and the screen stay identical.
                    style={{ paddingLeft: `${String(indentOf(line))}rem` }}
                  >
                    {line.trimStart()}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="@3xl:sticky @3xl:top-4 space-y-4">
        <Button variant="outline" className="w-full" onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied to clipboard' : 'Copy the note'}
        </Button>

        {cautions.map((section) => (
          <Card key={section.heading} className="border-destructive/30 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2 text-base">
                <AlertTriangleIcon className="size-4" />
                {section.heading}
              </CardTitle>
              <CardDescription>Things not to get wrong on the call.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {section.lines.map((line) => (
                  <li key={line} className="text-sm">
                    {line}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function indentOf(line: string): number {
  return (line.length - line.trimStart().length) / 2
}
