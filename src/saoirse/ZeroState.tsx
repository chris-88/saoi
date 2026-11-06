import type { ReactNode } from 'react'
import { SaoirseMark } from '@/saoirse/SaoirseMark'
import { ReturningPrompt } from '@/saoirse/ReturningPrompt'
import { cn } from '@/lib/utils'

/**
 * What a new conversation opens on (spec §1).
 *
 * There was a scripted greeting here that explained what Saoirse was before the customer had done
 * anything. This says one thing and waits. The claim the product makes — that you do not have
 * to know which product you need — is better made by asking the question than by asserting it.
 *
 * The mark carries `view-transition-name`, which is what lets the browser move this exact
 * object into the avatar position on the first send rather than cross-fading one icon out and
 * a different one in (§5).
 */
export function ZeroState({ focused }: { readonly focused: boolean }): ReactNode {
  return (
    <section className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div
        /* The named element. The same name is on the chat avatar; the browser does the rest. */
        style={{ viewTransitionName: 'saoirse-avatar' }}
        className={cn(
          'text-saoi-primary size-20 transition-transform duration-200 ease-out sm:size-24',
          // A small acknowledgement that they have begun, and nothing more (§4).
          focused && 'scale-[0.96]',
        )}
      >
        <SaoirseMark breathing={!focused} title="Saoirse" />
      </div>

      <h1
        className={cn(
          'mt-6 text-xl font-semibold tracking-tight transition-opacity duration-200',
          focused && 'opacity-65',
        )}
      >
        What are you trying to do?
      </h1>

      {/*
        Plain text, never buttons. The moment these become tappable they are a product menu,
        which is the thing this screen exists to avoid.
      */}
      <p className="text-muted-foreground mt-3 max-w-xs text-xs">
        home · family · saving · borrowing · retirement · everyday money
      </p>

      <p className="text-muted-foreground/70 mt-2 text-[11px]">Saoirse, say SEER-sha</p>

      {/*
        Renders nothing unless this browser has signed in here before and is not signed in now,
        so a first visit sees exactly what it saw: one question, and nothing to press.
      */}
      <ReturningPrompt />
    </section>
  )
}
