import { useEffect, useState, type ReactNode } from 'react'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { Link, useSearchParams } from 'react-router-dom'
import { SaoirseChat } from '@/saoirse/SaoirseChat'
import { SaoirseWordmark } from '@/saoirse/SaoirseWordmark'
import { ConversationMenu } from '@/saoirse/ConversationMenu'
import { IdentityBadge } from '@/saoirse/IdentityBadge'
import { rememberPresenterKey } from '@/lib/session'
import { readArrivalSource, stripArrivalSourceFromPath } from '@/lib/arrival'
import { routes } from '@/app/routes'
import { cn } from '@/lib/utils'
import { useViewportHeight } from '@/lib/useViewportHeight'

/**
 * Saoirse, and nothing else.
 *
 * The same screen in a browser tab and in the installed app, which is the point: there is no
 * signed-in version with more in it. Every visitor gets a case of their own and tells Saoirse what
 * it needs to know, the way they would tell a person.
 */
export function SaoirseScreen(): ReactNode {
  useDocumentTitle('Saoirse')
  const [started, setStarted] = useState(false)
  const [caseId, setCaseId] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  useViewportHeight()

  /**
   * The presenter key arrives once in the address bar and is taken straight out of it.
   *
   * A key that stays in the URL is a key in every screenshot, every screen share and the
   * browser history of whatever machine it was opened on. It is stored on the device instead,
   * which is where the thing it unlocks is actually needed.
   */
  const presenter = searchParams.get('presenter')

  /*
   * The notification link's token, taken out of the address bar the same way.
   *
   * A push notification opens `#/?n=<code>`. The code was once redeemed by a handoff that
   * no longer exists, so it does nothing now, and a parameter that does nothing should not sit
   * in the address bar looking like it might. Under hash routing this is a fragment-only
   * change, so nothing remounts: the conversation notices the update it was sent about
   * through Realtime and the focus check instead.
   */
  const notification = searchParams.get('n')
  useEffect(() => {
    if (notification === null) return
    const next = new URLSearchParams(searchParams)
    next.delete('n')
    setSearchParams(next, { replace: true })
  }, [notification, searchParams, setSearchParams])
  useEffect(() => {
    if (presenter === null || presenter === '') return
    rememberPresenterKey(presenter)
    const next = new URLSearchParams(searchParams)
    next.delete('presenter')
    setSearchParams(next, { replace: true })
  }, [presenter, searchParams, setSearchParams])

  /*
   * Where they came in from, read once and then taken out of the address the same way (§44).
   *
   * Read into state on the first render rather than from the URL each time, because the
   * effect below removes it from the URL and the conversation still needs it for the first
   * start. It can sit before the hash (`/?src=qr#/`, which is what a printed code encodes)
   * or inside it; both are stripped.
   */
  const [source] = useState(() => readArrivalSource())
  const hashSource = searchParams.get('src')
  useEffect(() => {
    stripArrivalSourceFromPath()
    if (hashSource === null) return
    const next = new URLSearchParams(searchParams)
    next.delete('src')
    setSearchParams(next, { replace: true })
  }, [hashSource, searchParams, setSearchParams])

  return (
    /*
     * A fixed box the exact height of what is on screen, with only the transcript scrolling
     * inside it.
     *
     * `min-h-dvh` let the page grow taller than the phone and scroll as a whole, so when the
     * keyboard opened the composer went behind it and Saoirse's reply went off the top. Nothing
     * here can exceed the box, so there is no page scroll to go wrong.
     */
    <div className="bg-background flex h-[var(--viewport-height)] flex-col overflow-hidden overscroll-none">
      {/*
        Quiet while the screen is still asking the question, and settled once it is a
        conversation (spec §8).

        The wordmark and nothing else. It used to carry "AI banking assistant" under it, which
        was both too small to read and a label the product does not need up here: Saoirse says what
        it is in the first reply, and a strapline in a header is the kind of thing that is
        written for whoever commissioned the product rather than whoever is using it. Taking it
        out is what leaves room for the logo to be a legible size.

        No separate avatar either. There is already one in the middle of the opening screen
        waiting to move, and the whole point of that transition is that there is only one of it
        — here it is the `b` the wordmark opens with.
      */}
      <header
        className={cn(
          'bg-card/95 supports-[backdrop-filter]:bg-card/80 z-30 shrink-0 border-b backdrop-blur transition-opacity duration-200',
          started ? 'opacity-100' : 'opacity-75',
        )}
      >
        <div className="mx-auto grid w-full max-w-md grid-cols-[2.25rem_1fr_2.25rem] items-center px-2 py-2">
          <ConversationMenu caseId={caseId} />
          {/*
            A plain link rather than a ghost Button. The Button sets
            `[&_svg:not([class*='size-'])]:size-4` on everything inside it, which silently
            squashed the wordmark to sixteen pixels square — it looked like a styling choice
            rather than a rule firing, which is why it survived a redesign.
          */}
          <Link
            to={routes.saoirse}
            aria-label="Saoirse home"
            className="hover:bg-accent focus-visible:ring-ring justify-self-center rounded-md px-3 py-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <SaoirseWordmark className="h-6" transitionName="saoi-wordmark" />
          </Link>
          {/*
            The avatar, once there is one. It renders nothing while anonymous, which is also
            what keeps the wordmark centred: the column is reserved either way.
          */}
          <IdentityBadge className="justify-self-end" />
        </div>
      </header>

      <SaoirseChat
        onStarted={setStarted}
        onCase={setCaseId}
        className="mx-auto flex w-full max-w-md min-h-0 flex-1 flex-col"
        openingMessage={searchParams.get('say')}
        mode="new"
        source={source}
        /*
         * The old greeting opened by denying it was another useless bot, which is a strange
         * thing to lead with: it raises the doubt before anyone had it, and then promises only
         * to "see if I can actually help". This says the one thing that is actually different
         * and asks for the thing it needs.
         */
      />
    </div>
  )
}
