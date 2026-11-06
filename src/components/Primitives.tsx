import type { ReactNode } from 'react'
import { m } from 'motion/react'
import { DURATION, EASE, enter, useStill } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The visual vocabulary, shared by the explainer and the conversation.
 *
 * These began as the explainer's parts and stayed there, which produced two products: a page
 * with elevation, entry motion and provenance labels, and a chat with none of them. A reader
 * persuaded by the one met the other cold. One vocabulary now, so a card in the conversation
 * and a specimen on the explainer are recognisably the same kind of thing.
 *
 * The rules, unchanged from the explainer:
 *
 *   - the page sits on a tinted surface and the evidence sits on white cards above it, so
 *     evidence looks like evidence rather than more paragraphs;
 *   - anything countable gets a tile, a colour and a size;
 *   - colour is semantic, from the token set, and always comes with a label;
 *   - nothing is only legible once it has animated, and under reduced motion nothing animates.
 *
 * Built on `m` rather than `motion`, so the conversation's chunk carries only the lazy
 * `domAnimation` feature set that `providers.tsx` loads. A QR cold start on conference wifi is
 * the case that matters.
 */

/** Which half of the system makes a decision. The explainer's whole argument, as a type. */
export type Decides = 'code' | 'model'

/**
 * A white card on the page's tinted surface.
 *
 * The elevation is the point: it is what makes a panel read as a specimen rather than as more
 * copy. `lift` is for the two or three things a reader should land on first.
 */
export function Surface({
  children,
  className,
  lift,
  accent,
}: {
  readonly children: ReactNode
  readonly className?: string
  readonly lift?: boolean
  readonly accent?: Decides
}): ReactNode {
  return (
    <div
      className={cn(
        'bg-card rounded-xl border',
        lift === true
          ? 'shadow-[0_1px_2px_rgba(16,24,40,0.04),0_10px_28px_-14px_rgba(16,24,40,0.22)]'
          : 'shadow-xs',
        accent === 'code' && 'border-t-decides-code border-t-[3px]',
        accent === 'model' && 'border-t-decides-model border-t-[3px]',
        className,
      )}
    >
      {children}
    </div>
  )
}

export type ClaimKind = 'poc' | 'production' | 'illustrative' | 'synthetic' | 'measured'

const CLAIM: Readonly<Record<ClaimKind, { readonly text: string; readonly tone: string }>> = {
  poc: { text: 'POC', tone: 'bg-primary/10 text-primary' },
  production: { text: 'Production direction', tone: 'bg-muted text-muted-foreground' },
  illustrative: { text: 'Illustrative', tone: 'bg-warning-border/30 text-warning-foreground' },
  synthetic: { text: 'Synthetic example', tone: 'bg-muted text-muted-foreground' },
  measured: { text: 'Measured', tone: 'bg-success/10 text-success' },
}

/** What kind of claim something is. Colour plus a word, never colour alone. */
export function Claim({ kind }: { readonly kind: ClaimKind }): ReactNode {
  const claim = CLAIM[kind]
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.08em] uppercase',
        claim.tone,
      )}
    >
      {claim.text}
    </span>
  )
}

/**
 * An entry that rises a few pixels as it fades in, and does nothing when motion is not wanted.
 *
 * Reduced motion gets the final state immediately rather than a faster animation: somebody who
 * asked for no movement has not asked for quicker movement.
 *
 * `view` waits until it scrolls into view, which is what a long page wants. `mount` plays as
 * soon as it appears, which is what a card arriving in a conversation wants: the transcript is
 * already scrolled to it, and an entry that waits to be scrolled to never plays.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  mode = 'view',
}: {
  readonly children: ReactNode
  readonly delay?: number
  readonly className?: string
  readonly mode?: 'view' | 'mount'
}): ReactNode {
  const still = useStill()

  /*
   * `min-w-0` because this is nearly always a grid or flex child, and a grid child defaults to
   * a minimum of its content. One `truncate` line inside a card, which is `white-space: nowrap`,
   * then sets the column's minimum to the full length of the string it was supposed to be
   * truncating, and the page gains a horizontal scrollbar on a phone.
   */
  if (still) return <div className={cn('min-w-0', className)}>{children}</div>

  const transition = { duration: DURATION.slow, delay, ease: EASE }

  if (mode === 'mount') {
    return (
      <m.div
        className={cn('min-w-0', className)}
        initial={enter.initial}
        animate={enter.animate}
        transition={transition}
      >
        {children}
      </m.div>
    )
  }

  return (
    <m.div
      className={cn('min-w-0', className)}
      initial={enter.initial}
      whileInView={enter.animate}
      viewport={{ once: true, margin: '-60px' }}
      transition={transition}
    >
      {children}
    </m.div>
  )
}

/** The tinted tile that fronts anything worth noticing. Tones are tokens, never invented. */
export function Tile({
  children,
  tone = 'primary',
  size = 'md',
}: {
  readonly children: ReactNode
  readonly tone?: 'primary' | 'success' | 'deep' | 'warning' | 'code' | 'model' | 'savings' | 'loan'
  readonly size?: 'sm' | 'md'
}): ReactNode {
  const tones: Readonly<Record<string, string>> = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    deep: 'bg-brand-deep/10 text-brand-deep',
    warning: 'bg-warning-border/30 text-warning-foreground',
    code: 'bg-decides-code/10 text-decides-code',
    model: 'bg-decides-model/10 text-decides-model',
    savings: 'bg-product-savings/10 text-product-savings',
    loan: 'bg-product-personal-loan/10 text-product-personal-loan',
  }

  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-lg',
        size === 'sm' ? 'size-7 [&>svg]:size-3.5' : 'size-9 [&>svg]:size-4',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

/**
 * A measured figure, sized so it is read before the sentence beside it.
 *
 * The basis sits on the card rather than in a footnote, because a number whose provenance is
 * somewhere else is a number nobody checks.
 */
export function Stat({
  value,
  label,
  basis,
  icon,
  tone = 'primary',
}: {
  readonly value: string
  readonly label: string
  readonly basis?: string
  readonly icon?: ReactNode
  readonly tone?: 'primary' | 'success' | 'deep' | 'warning'
}): ReactNode {
  return (
    <Surface className="h-full p-5">
      {icon ? (
        <div className="mb-3">
          <Tile tone={tone}>{icon}</Tile>
        </div>
      ) : null}
      <p
        className={cn(
          'text-[1.75rem] leading-none font-bold tracking-tight tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'primary' && 'text-primary',
          tone === 'deep' && 'text-brand-deep',
          tone === 'warning' && 'text-warning-foreground',
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-[13px] leading-snug font-medium">{label}</p>
      {basis === undefined ? null : (
        <p className="text-muted-foreground mt-1.5 text-[11.5px] leading-snug">{basis}</p>
      )}
    </Surface>
  )
}
