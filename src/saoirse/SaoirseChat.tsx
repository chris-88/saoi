import { useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { MessageText } from '@/saoirse/MessageText'
import { pushPermission, subscribeToPush } from '@/lib/push'
import { TriangleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ChatBubble } from '@/saoirse/ChatBubble'
import { TypingBubble } from '@/saoirse/TypingBubble'
import { TurnFeedback } from '@/saoirse/TurnFeedback'
import { Composer } from '@/saoirse/Composer'
import { SuggestionList, type Suggestion } from '@/saoirse/SuggestionList'
import { ZeroState } from '@/saoirse/ZeroState'
import { chatUiState, showsZeroState } from '@/saoirse/chatUiState'
import { useMinimumDuration } from '@/saoirse/useMinimumDuration'
import { withViewTransition } from '@/lib/viewTransition'
import { QUOTE_FOLLOW_UPS } from '@/saoirse/suggestions'
import { CardRenderer } from '@/saoirse/cards/CardRenderer'
import { Reveal } from '@/components/Primitives'
import { useCaseUpdates } from '@/saoirse/useCaseUpdates'
import { useInstallOffer } from '@/saoirse/useInstallOffer'
import { InstallCard } from '@/saoirse/InstallCard'
import { BellRingIcon } from 'lucide-react'
import { useConversation } from '@/saoirse/useConversation'
import { startSession } from '@/lib/session'
import { noteSignedInMoment, takeSignedInMoment } from '@/lib/identity'
import { useQueryClient } from '@tanstack/react-query'
import { loadCaseState } from '@/saoirse/cardState'
import { useSignInSignal } from '@/saoirse/signInSignal'
import { loadHistory } from '@/saoirse/history'
import { runCaseAction } from '@/lib/caseActions'
import { uploadDocumentApi } from '@/lib/saoiApi'
import type { CardActions } from '@/saoirse/cards/CardRenderer'
import type { Product } from '@domain/journey.ts'
import { isBackendConfigured, missingEnvVars } from '@/lib/env'
import { cn } from '@/lib/utils'

/**
 * The conversation itself: joins a case, shows the turns, offers openers, takes input.
 *
 * Both the public website and the app render this — the only difference is the chrome around
 * it, which is the point of §32: Saoirse is the same capability wherever it is placed.
 */
/** What Saoirse is told on the turn after a sign-in. The stage decides what it asks for next. */
const SIGNED_IN_NOTE = [
  'They have just signed in, on this screen, a moment ago.',
  'Say so in a few words and move straight on. Do not explain what signing in does, do not',
  'thank them for it, and do not offer it again.',
  'Then pick up where the case actually is: ask for the next thing outstanding, starting',
  'with the details every application opens with, and only the ones not already held.',
].join(' ')

export function SaoirseChat({
  openingMessage,
  onStarted,
  onCase,
  mode = 'new',
  source,
  footer,
  composerClassName,
  className,
}: {
  /** A line typed elsewhere and carried in, sent automatically on arrival. */
  openingMessage?: string | null
  /** Whether a conversation has started, so the chrome around this can settle with it (§8). */
  onStarted?: ((started: boolean) => void) | undefined
  /**
   * The case this joined, for chrome that needs it.
   *
   * Reported rather than looked up again. A second caller of `startSession` is a second
   * request racing the first on a cold load, and two requests that both find no mapping both
   * create a case — which is how one visitor ends up owning two conversations.
   */
  onCase?: ((caseId: string | null) => void) | undefined
  /** `fresh` knows nothing about the visitor; `demo` joins the seeded customer (§46). */
  mode?: 'new' | 'known'
  /**
   * Where they came in from, when the address said (§44). Sent with the first start only;
   * the starts that follow a sign-in or a reset are the same arrival.
   */
  source?: string | null | undefined
  /** Shown once there is something worth carrying into the app (§29). */
  footer?: (caseId: string) => ReactNode
  /** Extra space under the composer, for shells with a fixed bar of their own. */
  composerClassName?: string | undefined
  className?: string | undefined
}): ReactNode {
  const [caseId, setCaseId] = useState<string | null>(null)
  const [joining, setJoining] = useState(isBackendConfigured)
  const [joinError, setJoinError] = useState<string | null>(null)
  const { entries, streaming, error, send, loadFrom, resettle, reset } = useConversation(caseId)

  /**
   * The fork offered after a quote option has been talked through.
   *
   * Local and short-lived: anything the customer does next clears it, because a pair of chips
   * still sitting there two turns later is answering a question nobody is still asking.
   */
  const [followUps, setFollowUps] = useState<readonly Suggestion[]>([])
  const [loadingHistory, setLoadingHistory] = useState(isBackendConfigured)

  const transcript = useRef<HTMLDivElement>(null)
  /** Whether they were reading the newest turn, remembered from before the keyboard opens. */
  /** Whether the first paint has already put the newest message on screen. */
  const landed = useRef(false)
  /**
   * Where history ends and the live conversation begins, as an index into `entries`.
   *
   * State rather than a ref, because it is read during render. Set in the same tick as the
   * loaded history is handed to React, so the two are batched and the first render already
   * knows it. A card at or past this index arrived during this session and enters with
   * motion; one before it was already here, and twenty cards rising in sequence on every
   * reload is not an entrance, it is a loading screen.
   */
  const [liveFrom, setLiveFrom] = useState(0)
  const atBottom = useRef(true)
  const openingSent = useRef(false)
  const returnSent = useRef(false)
  const [hasUpdates, setHasUpdates] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  /**
   * The opening, as a state rather than a message count (spec §10).
   *
   * `transitioning` is held true from the first send until the browser's view transition has
   * finished, because between pressing send and the first token the count has changed but the
   * conversation has not started — and keying off the count alone tears the opening screen
   * down a frame early, which is exactly the tear the transition exists to avoid.
   */
  const [composerFocused, setComposerFocused] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  /** What they wrote, kept so a failed first send does not cost them the message (§12). */
  const [failedDraft, setFailedDraft] = useState<string | null>(null)
  const lastSent = useRef<string | null>(null)

  const lastEntry = entries.at(-1)

  const uiState = chatUiState({
    entries: entries.length,
    streaming,
    spoken: lastEntry?.kind === 'message' && lastEntry.author === 'assistant',
    composerFocused,
    failed: failedDraft !== null,
    transitioning,
  })

  /*
   * Not while history is still arriving (§13).
   *
   * A returning conversation has no entries for the moment it takes to load them, so reading
   * the state alone would put the opening screen up and tear it down again — replaying an
   * animation that is only ever meant for a genuinely new conversation.
   */
  const zeroState = showsZeroState(uiState) && !loadingHistory && (openingMessage ?? null) === null

  /*
   * Four hundred milliseconds minimum. Turns come back in about a second and sometimes much
   * less, and a thinking state that appears and vanishes inside a frame reads as a flicker.
   */
  const thinking = useMinimumDuration(uiState === 'saoirse_thinking', 400)

  // The header quietens itself on the opening screen and settles once there is a conversation.
  useEffect(() => {
    // Whether anything has been said, not the inverse of the opening screen: the opening screen
    // is also absent while history loads, which had the subtitle fading in before there was a
    // conversation to describe.
    onStarted?.(entries.length > 0)
  }, [entries.length, onStarted])

  /**
   * Send, wrapped in the shared-element transition for the first message only (§5, §13).
   *
   * Afterwards there is nothing to move: the mark is already in the avatar position, and a
   * transition on every turn would animate the whole transcript on each send.
   */
  const sendFromComposer = (message: string): void => {
    setFollowUps([])
    setFailedDraft(null)
    lastSent.current = message

    if (entries.length > 0) {
      void send(message)
      return
    }

    setTransitioning(true)
    /*
     * `flushSync`, so the customer's bubble and the typing bubble are in the DOM before the
     * browser takes its "after" snapshot. Without it the state changes were only queued, the
     * snapshot showed the page as it was, and the designed morph played as a plain fade.
     */
    withViewTransition(() => {
      flushSync(() => {
        void send(message)
      })
    })
    // Long enough for the transition to land; the state machine only uses it to hold the
    // opening screen in place while it does.
    window.setTimeout(() => setTransitioning(false), 500)
  }

  /**
   * Runs an action, then tells Saoirse what happened so it can react. The follow-up is phrased as
   * the customer, because from the model's point of view the customer did it — which is true.
   */
  /**
   * Returns whether the action actually went through. A card may only tell the customer
   * something is done once the server has said so — the model's reply arrives separately and
   * cannot be the evidence (Invariant 2).
   */
  const commit = async (
    action: Parameters<typeof runCaseAction>[0],
    nudge: string,
  ): Promise<boolean> => {
    setActionError(null)
    try {
      const result = await runCaseAction(action, caseId === null ? {} : { caseId })

      /**
       * Reported as an action, not as something the customer said.
       *
       * It used to go through as a `message`, so the server stored it as customer speech and
       * the transcript showed "Started Savings account, Joint current account, Mortgage. 7
       * things carried over." in their own bubble. They ticked two boxes.
       *
       * Sent as soon as the server confirms rather than awaited: telling Saoirse is a full streamed
       * turn, and waiting left the card that committed the action sitting on "Submitting…" with
       * the answer already in hand. Cards are disabled while a turn streams, so nothing else
       * can be committed in the meantime.
       */
      void send(result.summary, 'action', nudge)
      return true
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'That did not work.')
      return false
    }
  }

  /**
   * The presenter resets the case from the console and every open screen is suddenly attached
   * to a participant that no longer exists, so the next turn fails with "This is not your
   * case." and the phone is dead until someone clears its storage. That will happen on the
   * day, so it recovers itself: a fresh session on the rebuilt case, and a clean transcript.
   */
  useEffect(() => {
    if (error === null || !/not your case|no such case/i.test(error)) return

    let cancelled = false
    startSession(mode)
      .then((session) => {
        if (cancelled) return
        reset()
        setCaseId(session.caseId)
      })
      .catch(() => {
        // Leave the original error on screen; a second failure is not more informative.
      })

    return () => {
      cancelled = true
    }
  }, [error, mode, reset])

  useEffect(() => {
    if (!isBackendConfigured) return

    let cancelled = false
    startSession(mode, source)
      .then(async (session) => {
        if (cancelled) return
        setCaseId(session.caseId)
        setHasUpdates(session.hasUpdates)

        // Show what was said before, so the screen matches what the model remembers.
        try {
          const history = await loadHistory(session.caseId)
          if (!cancelled) {
            setLiveFrom(history.length)
            loadFrom(history)
          }
        } finally {
          if (!cancelled) setLoadingHistory(false)
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setJoinError(caught instanceof Error ? caught.message : 'Could not start a conversation.')
          setLoadingHistory(false)
        }
      })
      .finally(() => {
        if (!cancelled) setJoining(false)
      })

    return () => {
      cancelled = true
    }
    // loadFrom is stable; listed to satisfy the exhaustive-deps rule honestly. `source` is
    // read once by the screen and never changes, so it does not re-run this either.
  }, [loadFrom, mode, source])

  useEffect(() => {
    onCase?.(caseId)
  }, [caseId, onCase])

  useEffect(() => {
    if (caseId === null || loadingHistory || !openingMessage || openingSent.current) return
    openingSent.current = true
    void send(openingMessage)
  }, [caseId, loadingHistory, openingMessage, send])

  /**
   * §36 — the customer did not ask anything, they came back. The turn runs itself so the first
   * thing they see is what changed, not an empty composer.
   */
  useEffect(() => {
    if (caseId === null || loadingHistory || !hasUpdates || returnSent.current) return
    if (openingMessage) return
    returnSent.current = true
    void send('', 'return')
  }, [caseId, loadingHistory, hasUpdates, openingMessage, send])

  /**
   * Keep this device registered for notifications, without ever asking again.
   *
   * A push subscription lives in two places and only one of them is visible to the browser:
   * the permission, which the browser remembers, and the row on the server, which it does not.
   * The two come apart easily — a purge between run-throughs, a case that was reset, a
   * conversation switched from the menu — and when they do, the phone believes notifications
   * are on, the menu hides its own switch because permission is granted, and the server has
   * nowhere to send anything. A notification was sent to a real phone and went nowhere for
   * exactly this reason: `push_subscriptions` was empty while the phone said yes.
   *
   * So the registration is re-asserted whenever a case loads. Only when permission has already
   * been granted, so nobody is ever prompted by this, and the server upserts on the endpoint,
   * so doing it on every load costs one request and changes nothing.
   */
  const registeredPush = useRef<string | null>(null)

  useEffect(() => {
    if (caseId === null || registeredPush.current === caseId) return
    if (pushPermission() !== 'granted') return
    registeredPush.current = caseId

    void subscribeToPush(caseId)
  }, [caseId])

  /**
   * Pick the conversation back up after a sign-in.
   *
   * Signing in ends in a reload, so nothing was asking Saoirse to say anything: the transcript
   * came back with "Signed in" under the card and silence after it. Somebody who has just
   * handed over an address and typed a code should be met, not left looking at their own last
   * message.
   *
   * It goes through as an `action` rather than a message, for the same reason tapping a card
   * does: it is something that happened, not something they said, and it should not appear in
   * their own voice in the record.
   *
   * What Saoirse does next is the stage's business, not this note's. With applications started the
   * case is in `applying`, where the guidance is already to work through what is outstanding —
   * which is exactly the identity details a signed-in customer should now be asked for.
   */
  const greetedSignIn = useRef(false)

  useEffect(() => {
    if (caseId === null || loadingHistory || greetedSignIn.current) return
    if (!takeSignedInMoment()) return
    greetedSignIn.current = true

    void send('Signed in.', 'action', SIGNED_IN_NOTE)
  }, [caseId, loadingHistory, send])

  /**
   * Signing in, without leaving the page.
   *
   * The form signals; this does what a reload used to do by force. Refresh the identity so
   * the badge appears; re-run the session so the server attaches the address, marks the case
   * authenticated and records what the account saved them typing; settle the cards on screen
   * in place, so the sign-in card cross-fades into "Signed in" rather than being replaced;
   * then have Saoirse pick up.
   *
   * One case where the reload stays: the account already had a different conversation and
   * the server landed on it. Everything on this screen belongs to the other one, and a clean
   * load is the honest way to change conversations.
   */
  /**
   * The bank moving while the screen is open (§35, §36).
   *
   * Realtime on this customer's own events, and a check on coming back to the tab. Nothing
   * fires a turn by itself: the pill says what happened, in the digest's own words, and the
   * customer taps it when they are ready. The tap is the same `return` turn that opens a
   * conversation after time away, so what Saoirse then says is what it would have said anyway.
   */
  const updates = useCaseUpdates(caseId)
  const installOffer = useInstallOffer()
  const catchUp = () => {
    updates.acknowledge()
    void send('', 'return')
  }

  const queryClient = useQueryClient()
  const signedInAt = useSignInSignal((signal) => signal.signedInAt)
  const acknowledge = useSignInSignal((signal) => signal.acknowledge)

  useEffect(() => {
    if (signedInAt === null || caseId === null) return

    let cancelled = false
    void (async () => {
      await queryClient.invalidateQueries({ queryKey: ['identity'] })
      const session = await startSession(mode)
      if (cancelled) return

      if (session.caseId !== caseId) {
        noteSignedInMoment()
        window.location.reload()
        return
      }

      resettle(await loadCaseState(caseId))
      acknowledge()
      void send('Signed in.', 'action', SIGNED_IN_NOTE)
    })().catch(() => {
      // The sign-in itself succeeded. If the follow-through fails, a reload is the fallback.
      noteSignedInMoment()
      window.location.reload()
    })

    return () => {
      cancelled = true
    }
  }, [signedInAt, caseId, mode, queryClient, resettle, acknowledge, send])

  /**
   * Keep the newest turn in view.
   *
   * `scrollIntoView` moved the nearest scrollable ancestor — the page, not the transcript —
   * which nudged the whole screen and left Saoirse's reply under the composer. Scrolling the
   * transcript itself is exact. It only follows when the customer is already at the bottom,
   * so scrolling up to re-read something is not yanked back down mid-stream.
   */
  useEffect(() => {
    const el = transcript.current
    if (el === null) return

    /*
     * Open on the newest message, not the oldest.
     *
     * The rule below is "follow only if they are already at the bottom", which is right while
     * a conversation is running and wrong the moment it loads: a restored transcript starts at
     * scrollTop zero, which is the furthest possible from the bottom, so the rule declined to
     * move and left somebody reading the first thing they ever said to Saoirse. The first paint
     * after history arrives jumps, once.
     */
    if (!landed.current && !loadingHistory && entries.length > 0) {
      landed.current = true
      el.scrollTop = el.scrollHeight
      atBottom.current = true
      return
    }

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom > 160) return

    el.scrollTop = el.scrollHeight
    atBottom.current = true
  }, [entries, streaming, loadingHistory])

  /**
   * And keep it in view when the keyboard opens.
   *
   * The transcript gets shorter the moment the keyboard appears, which pushes whatever was at
   * the bottom out of sight — the reply and the options the customer was about to tap. Nothing
   * in the conversation changed, so the effect above never runs.
   *
   * Whether they were at the bottom has to be remembered from before the resize. Measuring it
   * afterwards always says no: shrinking the box is itself what put the bottom out of reach.
   */
  useEffect(() => {
    const el = transcript.current
    const viewport = window.visualViewport
    if (el === null || !viewport) return undefined

    const remember = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 160
    }

    const pin = () => {
      if (!atBottom.current) return

      /*
       * After the next frame, not now. The resize handler runs before the browser has
       * reflowed for the new height, so scrolling here lands on where the bottom used to be
       * and leaves the newest turn just as hidden.
       */
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
      })
    }

    el.addEventListener('scroll', remember, { passive: true })
    viewport.addEventListener('resize', pin)

    return () => {
      el.removeEventListener('scroll', remember)
      viewport.removeEventListener('resize', pin)
    }
  }, [])

  const ready = caseId !== null && !joining && !loadingHistory
  const problem = joinError ?? error ?? actionError

  /*
   * A failed turn keeps the message and offers to send it again (§12).
   *
   * The customer should never have to retype what they wrote, and the screen should never go
   * back to the opening question with their words gone — which is what happened, because the
   * composer clears its draft the moment it hands the message over.
   */
  useEffect(() => {
    if (error === null || lastSent.current === null) return
    setFailedDraft(lastSent.current)
    lastSent.current = null
  }, [error])

  const retry = (): void => {
    const message = failedDraft
    if (message === null) return
    setFailedDraft(null)
    reset()
    sendFromComposer(message)
  }

  /**
   * The customer's taps. Each one goes to `case-action`, which re-validates everything, and
   * the outcome is told back to Saoirse so the conversation stays in step with the case
   * (Invariant 1, Invariant 2).
   */
  const actions: CardActions = {
    onSelectProducts: async (products) => {
      await commit(
        {
          action: 'select_products',
          caseId: caseId ?? '',
          products: products.map((choice) => ({
            product: choice.product as Product,
            ...(choice.catalogueId === undefined ? {} : { catalogueId: choice.catalogueId }),
          })),
        },
        'Say what is now in progress and what you need from them first.',
      )
    },
    /**
     * A quote option the customer wants to go through.
     *
     * Nothing is committed — no application, no recorded decision.
     *
     * The instruction used to end "then keep finding out what the money is for and how soon they
     * expect to clear it", and Saoirse did exactly that: it explained the four-year fixed and in the
     * same breath asked what the two of them earned and which county the house was in. Somebody
     * who has just chosen something to look at more closely has not finished looking at it.
     *
     * So the turn ends on their move instead — more about this option, or what applying would
     * involve — and discovery picks up after they have answered. Same reason the product options
     * card says not to ask a question in the turn that offers it: explaining and interrogating at
     * once reads as not listening.
     */
    /**
     * A catalogue product they want to hear about.
     *
     * Same shape as discussing a quote option and for the same reason: nothing is committed,
     * and the turn ends on their move rather than on a question. The difference is only that
     * these are different products rather than different terms for one.
     */
    onChooseComparison: async (option) => {
      setFollowUps([])
      await send(
        `Asked about "${option.name}".`,
        'action',
        'Go through that one properly: what it is for, what is good about it and what is less ' +
          'good, from the catalogue and nothing else. The others are still on screen, so do not ' +
          'list them again. Then stop and let them steer. Ask whether they want to go further ' +
          'into this one or look at what opening it would involve. Ask nothing else in this ' +
          'turn, and do not start anything.',
      )
      setFollowUps(QUOTE_FOLLOW_UPS)
    },

    onDiscussQuote: async (option) => {
      setFollowUps([])
      await send(
        `Chose "${option.name}" to talk through.`,
        'action',
        'Explain what that option means in practice and what is good and less good about it, in ' +
          'a few sentences. Then stop and let them steer: ask whether they want to go further ' +
          'into this one or hear what applying would actually involve. Ask nothing else in this ' +
          'turn: no income, no property, no timing, however obviously you need it next. Do not ' +
          'start an application.',
      )
      setFollowUps(QUOTE_FOLLOW_UPS)
    },

    onDeclineProducts: async (products) => {
      const first = products[0]
      if (!first) return
      await commit(
        { action: 'decline_product', caseId: caseId ?? '', product: first.product as Product },
        'Acknowledge briefly and move on; do not raise those again.',
      )
    },
    onSubmit: (applicationId, confirmations) =>
      commit(
        { action: 'submit_application', applicationId, confirmations: [...confirmations] },
        'Say what happens next and roughly when.',
      ),
    onInvitePartner: async (name) => {
      setActionError(null)
      try {
        const result = await runCaseAction({ action: 'invite_partner', caseId: caseId ?? '', name })

        // The link exists the moment the server returns it, so it goes on screen now rather
        // than ten seconds later when Saoirse has finished talking about it.
        void send(result.summary, 'action', 'Say what happens on their side.')
        return result.inviteUrl
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : 'That did not work.')
        return undefined
      }
    },
    onConsent: async (applicationId, requirementId) => {
      await commit(
        { action: 'grant_consent', applicationId, requirementId },
        'Say what is still outstanding on that application.',
      )
    },
    onAttachFormDocument: async (formApplicationId, fieldId, file) => {
      setActionError(null)
      const form = new FormData()
      form.append('formApplicationId', formApplicationId)
      form.append('fieldId', fieldId)
      form.append('file', file)

      // Throws on failure so the card says so where the customer is looking.
      if (caseId === null) throw new Error('There is no conversation to attach that to yet.')
      await uploadDocumentApi(caseId, form)
      void send(
        `I attached ${file.name}.`,
        'action',
        'Confirm it is attached and say what is left.',
      )
    },
    onConfirmDeclarations: async (applicationId, fieldIds) => {
      await commit(
        { action: 'confirm_form_declarations', applicationId, fieldIds: [...fieldIds] },
        'Say what that leaves, and do not repeat the declarations back.',
      )
    },
    onHealthForm: async (applicationId, values) => {
      await commit(
        { action: 'submit_health_form', applicationId, values: [...values] },
        'Say where that leaves the application.',
      )
    },
    onConfirmPlan: (planId) =>
      commit(
        { action: 'decide_plan', caseId: caseId ?? '', planId, decision: 'keep' },
        'Say what is worth doing first.',
      ),
    onDeclinePlan: async (planId) => {
      await commit(
        { action: 'decide_plan', caseId: caseId ?? '', planId, decision: 'not_now' },
        'Say it is set aside, and that you can draw a fresh one up whenever they are ready. Do not say it is parked or paused: it cannot be picked up again as it is.',
      )
    },
    onEnableNotifications: async () => {
      // The case is what a notification is about, so there is nothing to subscribe to before
      // there is one.
      if (caseId === null) {
        return { state: 'failed' as const, reason: 'Nothing to be notified about yet.' }
      }
      return await subscribeToPush(caseId)
    },
    onUpload: async (requestId, file, documentType) => {
      setActionError(null)
      const form = new FormData()
      form.append('requestId', requestId)
      form.append('documentType', documentType)
      form.append('file', file)

      // Throws on failure so the card can say so where the customer is looking, rather than
      // the error appearing somewhere else on screen.
      if (caseId === null) throw new Error('There is no conversation to attach that to yet.')
      await uploadDocumentApi(caseId, form)
      void send(
        `Uploaded ${file.name}.`,
        'action',
        'Say whether that clears the request and what is still outstanding.',
      )
    },
    onPauseDecision: async (applicationId, decision) => {
      if (decision === 'pause') {
        await commit({ action: 'pause_application', applicationId }, 'I have put that on hold.')
      }
    },

    /*
     * Open banking, simulated. The link is the consent; the server generates the accounts
     * under it and the summary says what it can now see. A refusal commits nothing, so it is
     * told to Saoirse the way a declined quote is: as something that happened, not something said.
     */
    onLinkAccounts: async (bank, scope) => {
      await commit(
        { action: 'link_accounts', caseId: caseId ?? '', bank, scope: [...scope] },
        'Say in one line what you can now see, then show them their money in one place. ' +
          'Do not list the accounts in words: the card does that.',
      )
    },
    onDeclineLink: async () => {
      await send(
        'Decided not to link other accounts for now.',
        'action',
        'Acknowledge in a few words and carry on from what they tell you. Do not offer the ' +
          'link again unless they ask for it.',
      )
    },
    onTransfer: async (transfer) => {
      await commit(
        { action: 'initiate_transfer', caseId: caseId ?? '', ...transfer },
        'Say it is on its way and what happens when it lands. Do not say it has landed: it ' +
          'has not yet, and you will be told when it does.',
      )
    },
    onDeclineTransfer: async (toLabel) => {
      await send(
        `Decided not to move money into ${toLabel} for now.`,
        'action',
        'Acknowledge briefly: the money stays where it is. Do not offer the transfer again ' +
          'unless they ask.',
      )
    },
  }

  return (
    <div className={className}>
      <div
        ref={transcript}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4',
          // The opening screen centres in the space; a transcript stacks from the top.
          zeroState ? 'flex flex-col' : 'space-y-3',
        )}
      >
        {updates.update !== null && !streaming && (
          <div className="sticky top-0 z-10 flex justify-center">
            <Reveal mode="mount">
              <button
                type="button"
                onClick={catchUp}
                className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex max-w-full items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium shadow-md focus-visible:ring-2 focus-visible:outline-none"
              >
                <BellRingIcon aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{updates.update.text}</span>
                <span className="shrink-0 opacity-80">· Catch up</span>
              </button>
            </Reveal>
          </div>
        )}

        {zeroState && <ZeroState focused={composerFocused} />}

        {entries.map((entry, index) => {
          if (entry.kind === 'card') {
            return (
              <div key={entry.id} className="pl-10">
                {index >= liveFrom ? (
                  <Reveal mode="mount">
                    <CardRenderer
                      card={entry.card}
                      actions={actions}
                      disabled={streaming}
                      settled={entry.settled}
                    />
                  </Reveal>
                ) : (
                  <CardRenderer
                    card={entry.card}
                    actions={actions}
                    disabled={streaming}
                    settled={entry.settled}
                  />
                )}
              </div>
            )
          }

          // Only the last bubble in a run of same-author messages carries the avatar.
          const next = entries[index + 1]
          const endsRun =
            next === undefined || next.kind !== 'message' || next.author !== entry.author

          const bubble = (
            <ChatBubble
              key={entry.id}
              author={entry.author}
              showAvatar={endsRun}
              first={
                entry.author === 'assistant' &&
                entries.findIndex((e) => e.kind === 'message' && e.author === 'assistant') === index
              }
            >
              <MessageText text={entry.text} />
            </ChatBubble>
          )

          /*
           * Thumbs under a reply, once it is a row (§44).
           *
           * Only Saoirse's turns, and only with a message id: a reply still streaming has none,
           * so the thumbs appear when the turn finishes and not under half a sentence. The
           * thinking bubble and the system notes never reach here.
           */
          if (entry.author !== 'assistant' || entry.messageId === undefined || caseId === null) {
            return bubble
          }

          return (
            <div key={entry.id} className="space-y-1">
              {bubble}
              <TurnFeedback caseId={caseId} messageId={entry.messageId} />
            </div>
          )
        })}

        {/*
          Shown directly during the opening transition, bypassing the minimum-duration hold:
          the typing bubble is the morph's destination and has to be in the very first commit.
          The 500 ms dead window after the first send, hero gone and nothing in its place, was
          this bubble not being rendered until the transition state had already passed.
        */}
        {/*
          Offered once per device, to somebody signed in, in a conversation, in a browser tab.
          It follows the sign-in beat because that is when they decided this was worth keeping,
          and it is what leads into the move to the installed app on the big screen.
        */}
        {installOffer.offer && entries.length > 0 && !streaming && (
          <div className="pl-10">
            <Reveal mode="mount">
              <InstallCard onDismiss={installOffer.dismiss} />
            </Reveal>
          </div>
        )}

        {(thinking || uiState === 'first_message_transition') && (
          <TypingBubble
            first={
              !entries.some((entry) => entry.kind === 'message' && entry.author === 'assistant')
            }
          />
        )}

        {/*
          One region, always mounted, so the announcement is made once rather than every time
          a node appears. Announcing each streamed token would read the whole answer aloud a
          word at a time (§16).
        */}
        <p aria-live="polite" className="sr-only">
          {uiState === 'saoirse_thinking' ||
          uiState === 'saoirse_streaming' ||
          uiState === 'first_message_transition'
            ? 'Saoirse is responding'
            : ''}
        </p>

        {/*
          Only after a turn has finished. Offering a choice while Saoirse is still mid-sentence
          invites a tap that lands in the middle of the answer it is replying to.
        */}
        {followUps.length > 0 && !streaming && (
          <SuggestionList
            suggestions={followUps}
            className="pt-1 pl-10"
            disabled={streaming}
            onSelect={(suggestion) => {
              setFollowUps([])
              void send(suggestion.label)
            }}
          />
        )}

        {failedDraft !== null && (
          <Alert>
            <TriangleAlertIcon />
            <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="min-w-0 flex-1">
                I couldn&rsquo;t get that through just now. Try again?
              </span>
              <Button variant="outline" size="sm" onClick={retry}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {problem !== null && failedDraft === null && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}

        {!isBackendConfigured && (
          <Alert>
            <TriangleAlertIcon />
            <AlertDescription>
              Not connected to a backend. Missing: {missingEnvVars.join(', ')}.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {footer !== undefined && caseId !== null && entries.length > 0 && (
        <div className="px-4 pb-2">{footer(caseId)}</div>
      )}

      {/*
        Nothing under the composer.
        
        "Saoirse is an AI assistant." sat there taking a line and a margin on the one screen where
        space is scarcest, and the header says it already. `--safe-bottom` is the home indicator
        when there is one and zero when the keyboard covers it, which is where the rest of the
        dead space was going.
      */}
      <div
        className={cn(
          'bg-background/95 supports-[backdrop-filter]:bg-background/80 shrink-0 border-t px-4 pt-2.5 pb-[max(0.625rem,var(--safe-bottom))] backdrop-blur',
          composerClassName,
        )}
      >
        <Composer
          hint={zeroState}
          disabled={!ready || streaming}
          onSend={sendFromComposer}
          onFocusChange={setComposerFocused}
          {...(joining ? { placeholder: 'Connecting…' } : {})}
        />
      </div>
    </div>
  )
}
