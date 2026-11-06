import { useCallback, useRef, useState } from 'react'
import type { Card } from '@contracts/cards.ts'
import { withdraw } from '@contracts/stream.ts'
import { streamSaoirseTurn } from '@/saoirse/saoirseTurnClient'
import { settledState, type CaseState } from '@/saoirse/cardState'

export type TurnEntry =
  | {
      readonly kind: 'message'
      readonly id: string
      readonly author: 'assistant' | 'customer'
      readonly text: string
      /**
       * The persisted row, once there is one (§44).
       *
       * A reply streams under a local id and is only a message the server knows about when
       * `done` names it. Feedback on a reply is kept against that id, so the thumbs appear
       * when it arrives and not before: there is nothing to rate until the turn is over.
       */
      readonly messageId?: string
    }
  | {
      readonly kind: 'card'
      readonly id: string
      readonly card: Card
      /**
       * What became of it, when the conversation is loaded back.
       *
       * Absent on a card that has just streamed: nothing has happened to it yet, and the whole
       * point of it arriving is that the customer can act on it.
       */
      readonly settled?: { readonly label: string }
    }

/**
 * Drives one conversation.
 *
 * Deliberately local state rather than TanStack Query: a turn is a stream of deltas, not a
 * fetched resource. Persisted history is loaded separately and this holds only what is
 * happening now.
 */
export function useConversation(caseId: string | null) {
  const [entries, setEntries] = useState<readonly TurnEntry[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const counter = useRef(0)

  /**
   * The same flag, synchronously.
   *
   * `streaming` is React state, so it is still false for every handler that runs before the
   * next render. Two taps on a card inside one tick therefore both passed the guard, and the
   * customer got four "noted, I'll leave that" messages and five near-identical replies to a
   * single decision. A ref flips immediately, so the second tap has something true to read.
   */
  const inFlight = useRef(false)

  const nextId = () => {
    counter.current += 1
    return `entry-${String(counter.current)}`
  }

  const send = useCallback(
    async (
      message: string,
      trigger: 'message' | 'opening' | 'return' | 'action' = 'message',
      note?: string,
    ) => {
      if (!caseId || inFlight.current) return

      inFlight.current = true
      setError(null)
      setStreaming(true)

      // Only a typed message gets a bubble. A tap is not something the customer said, and
      // rendering it as one put words in their mouth in the record a person reads later.
      if (trigger === 'message' && message.length > 0) {
        // Shown immediately: the customer should never wonder whether it sent.
        setEntries((current) => [
          ...current,
          { kind: 'message', id: nextId(), author: 'customer', text: message },
        ])
      }

      const replyId = nextId()
      let reply = ''

      /*
       * Cards that arrive before Saoirse has said anything wait for the reply.
       *
       * The server holds the model's own cards until the text is done, so that Saoirse explains and
       * then offers. The data notice is emitted by the function before the model speaks, so it
       * landed above the reply: customer, dashed box, then Saoirse. Holding it here until the first
       * token puts the reply first, as the server's own rule intends.
       */
      let held: Card[] = []
      const release = () => {
        if (held.length === 0) return
        const releasing = held
        held = []
        setEntries((current) => [
          ...current,
          ...releasing.map((card): TurnEntry => ({ kind: 'card', id: nextId(), card })),
        ])
      }

      try {
        await streamSaoirseTurn(
          // `opening` and `return` carry no text; `action` carries what the tap did, which
          // the server stores as a system note rather than as something they said.
          {
            caseId,
            trigger,
            ...(trigger === 'message' || trigger === 'action' ? { message } : {}),
            ...(note === undefined ? {} : { note }),
          },
          (event) => {
            switch (event.type) {
              case 'text_delta': {
                const firstToken = reply.length === 0
                reply += event.text
                setEntries((current) => {
                  const existing = current.find((entry) => entry.id === replyId)
                  if (!existing) {
                    return [
                      ...current,
                      { kind: 'message', id: replyId, author: 'assistant', text: reply },
                    ]
                  }
                  return current.map((entry) =>
                    entry.id === replyId && entry.kind === 'message'
                      ? { ...entry, text: reply }
                      : entry,
                  )
                })
                if (firstToken) release()
                break
              }

              case 'retract': {
                /*
                 * Saoirse was introducing something the server then refused to show, so the words
                 * come back off the screen before the rewrite arrives. If nothing is left the
                 * bubble goes too: an empty one reads as a reply, and with no reply on screen
                 * the surface shows Saoirse thinking again, which is the truth of it.
                 */
                reply = withdraw(reply, event.length)
                const remaining = reply
                setEntries((current) =>
                  remaining.length === 0
                    ? current.filter((entry) => entry.id !== replyId)
                    : current.map((entry) =>
                        entry.id === replyId && entry.kind === 'message'
                          ? { ...entry, text: remaining }
                          : entry,
                      ),
                )
                break
              }

              case 'card':
                if (reply.length === 0) {
                  held.push(event.card)
                  break
                }
                setEntries((current) => [
                  ...current,
                  { kind: 'card', id: nextId(), card: event.card },
                ])
                break

              case 'error':
                setError(event.error.message)
                break

              case 'done': {
                // The reply is now a row. Nothing else about the entry changes, so the bubble
                // keeps its key and only the thumbs under it appear.
                const messageId = event.messageId
                setEntries((current) =>
                  current.map((entry) =>
                    entry.id === replyId && entry.kind === 'message'
                      ? { ...entry, messageId }
                      : entry,
                  ),
                )
                break
              }

              case 'status':
                break
            }
          },
        )
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Something went wrong.')
      } finally {
        // A turn with cards and no words still shows its cards.
        release()
        inFlight.current = false
        setStreaming(false)
      }
    },
    [caseId],
  )

  /** Clears the transcript, for when the case it belonged to no longer exists. */
  const reset = useCallback(() => {
    setEntries([])
    setError(null)
  }, [])

  /** Replaces the transcript with what is persisted, before any new turn is taken. */
  const loadFrom = useCallback((persisted: readonly TurnEntry[]) => {
    setEntries(persisted)
  }, [])

  /**
   * Re-reads what became of every card on screen, without replacing the entries.
   *
   * Replacing them would give each card a fresh key, and a card with a fresh key is a card
   * that unmounts and remounts rather than cross-fading into its outcome. Mapping in place
   * keeps the keys, so the sign-in card settles where it stands.
   */
  const resettle = useCallback((state: CaseState) => {
    setEntries((current) =>
      current.map((entry) => {
        if (entry.kind !== 'card') return entry
        const settled = settledState(entry.card, state)
        return settled === undefined ? entry : { ...entry, settled }
      }),
    )
  }, [])

  return { entries, streaming, error, send, loadFrom, resettle, reset }
}
