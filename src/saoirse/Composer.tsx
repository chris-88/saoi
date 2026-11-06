import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowUpIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGhostPrompt } from '@/saoirse/useGhostPrompt'

/**
 * The message composer.
 *
 * A `contenteditable` rather than a textarea, for one reason: iOS puts a previous/next/Done
 * strip above the keyboard whenever a real form control has focus, and it does not do that for
 * an editable region. That strip is about fifty pixels of system chrome sitting between the
 * conversation and the keys, and on a phone that is the most expensive space on the screen.
 *
 * It costs the things a native field gives away — paste arrives as HTML and has to be flattened,
 * the accessible name has to be declared rather than inferred — and buys back the growth logic,
 * since an editable region is already the size of its content.
 *
 * Enter sends, shift-enter breaks the line, which is the convention everywhere this is modelled
 * on and the one thing it would be annoying to get wrong.
 */
export function Composer({
  onSend,
  disabled,
  placeholder,
  hint = true,
  onFocusChange,
  className,
}: {
  onSend?: ((message: string) => void) | undefined
  /**
   * Whether a message can be *sent* — not whether one can be written.
   *
   * It used to disable the field itself, which the browser answers by blurring it. Every turn
   * therefore took the caret away mid-thought and, on a phone, dropped the keyboard with it.
   * Typing ahead while Saoirse is still answering is what every other chat allows and costs
   * nothing; only the send is held back, and the button greys out to show it.
   */
  disabled?: boolean | undefined
  /** Overrides the typed suggestions. Used where a fixed instruction is clearer than a hint. */
  placeholder?: string | undefined
  /**
   * Whether to type the sample openers.
   *
   * Only before anything has been said. Once there is a conversation the suggestions are not
   * suggestions any more — they are a loop of someone else's sentences under the one the
   * customer is trying to write.
   */
  hint?: boolean | undefined
  /** The opening screen dims itself while somebody is typing into it (spec §4). */
  onFocusChange?: ((focused: boolean) => void) | undefined
  className?: string | undefined
}): ReactNode {
  const box = useRef<HTMLDivElement>(null)
  /*
   * Mirrored rather than controlled. Writing React's value back into a `contenteditable` on
   * every keystroke moves the caret to the end, which makes it impossible to correct a word in
   * the middle of a sentence. The element owns its text; this only tracks enough of it to know
   * whether there is anything to send.
   */
  const [length, setLength] = useState(0)

  const canSend = length > 0 && disabled !== true
  const ghost = useGhostPrompt(hint && length === 0 && placeholder === undefined)

  const read = (): string => (box.current?.textContent ?? '').trim()

  const clear = (): void => {
    if (box.current !== null) box.current.textContent = ''
    setLength(0)
  }

  function submit(event?: FormEvent): void {
    event?.preventDefault()
    if (!canSend) return

    onSend?.(read())
    clear()
    // Sending by tapping the button puts focus on the button, which then greys out and loses
    // it. The caret belongs back where the next message is written.
    box.current?.focus()
  }

  return (
    <form onSubmit={submit} className={cn('flex items-end gap-2', className)}>
      <div className="border-input bg-card focus-within:ring-ring/40 relative min-w-0 flex-1 rounded-3xl border px-4 py-0.5 focus-within:ring-2">
        {/*
          The hint is drawn behind the box rather than put in `placeholder`, so that a string
          changing forty times a second is never read out, and never becomes the field's
          accessible name. `aria-label` below is the stable one.
        */}
        {length === 0 && (ghost.length > 0 || placeholder !== undefined) && (
          <p
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute inset-x-4 inset-y-0.5 truncate text-base leading-6 sm:text-sm"
          >
            {placeholder ?? ghost}
            {placeholder === undefined && (
              <span className="border-muted-foreground ml-px inline-block h-4 animate-pulse border-l align-middle" />
            )}
          </p>
        )}

        <div
          ref={box}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Message Saoirse"
          onInput={() => setLength(read().length)}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          onPaste={(event) => {
            /*
             * Plain text only. An editable region accepts whatever the clipboard holds, so a
             * paste from a web page arrives with its fonts, colours and links attached — and
             * then gets sent to a model as markup.
             */
            event.preventDefault()
            const text = event.clipboardData.getData('text/plain')
            document.execCommand('insertText', false, text)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            // A composition is a half-typed character in another script; Enter commits it
            // rather than sending, and sending here would swallow the word.
            if (event.nativeEvent.isComposing) return
            event.preventDefault()
            submit()
          }}
          /*
           * `max-h-40` with scrolling is the six-line cap. No measuring: an editable region is
           * already the height of its text, which is the one thing this is simpler at.
           *
           * 16px, not 14. iOS zooms the whole page the moment a focused field computes smaller
           * than that, and once it has zoomed the layout viewport no longer matches the screen.
           * Scaled back down above the phone breakpoint, where nothing zooms.
           */
          className="max-h-40 w-full overflow-y-auto text-base leading-6 break-words whitespace-pre-wrap outline-none sm:text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send"
        className="bg-primary text-primary-foreground focus-visible:ring-ring grid size-8 shrink-0 place-items-center rounded-full transition-opacity focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40"
      >
        <ArrowUpIcon aria-hidden className="size-4" />
      </button>
    </form>
  )
}
