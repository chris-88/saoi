import type { SaoirseTurnRequest } from '@shared/contracts/saoirse-turn.ts'
import type { GateBlocked, TurnGate } from './gate.ts'
import { awaitsCustomer } from '@shared/contracts/cards.ts'
import type { Card } from '@shared/contracts/cards.ts'
import { DATA_NOTICE_EVENT, dataNoticeCard } from '@shared/llm/data-notice.ts'
import { describeReused, type ReuseEvent } from '@shared/domain/reuse.ts'
import {
  ACCOUNT_OPENED_CARD,
  openedAccounts,
  welcomeCardFor,
  welcomedAccounts,
} from '@shared/db/welcome.ts'
import { asksSomething } from '@shared/domain/conversation/turn-shape.ts'
import { isRepeatedMessage } from '@shared/domain/conversation/repeat.ts'
import { syncFormApplications } from '@shared/db/form-applications.ts'
import { type TurnUsage } from '@shared/domain/cost.ts'
import { saveMessage, touchLastSeen, type Db, writeEvent } from '@shared/db/case-repository.ts'
import { type buildCaseDigest } from '@shared/db/digest.ts'
import { type LoadedCase } from '@shared/db/loaded-case.ts'

export type PendingCards = {
  readonly pendingNotice: Card | undefined
  readonly pendingReuse: Card | undefined
  readonly pendingWelcome: Card | undefined
}

/**
 * What is written before the gate's verdict is acted on: the customer's message (or the tap,
 * recorded as what it was), the data notice owed to anybody who has typed, the card for what a
 * tap reused, and the welcome for an account that has opened.
 */
export async function recordCustomerTurn(
  admin: Db,
  args: {
    readonly turn: SaoirseTurnRequest
    readonly participantId: string
    readonly customerMessage: string
    readonly isCustomerTurn: boolean
    readonly gate: TurnGate
    readonly loaded: LoadedCase
    readonly appBaseUrl: string
  },
): Promise<PendingCards> {
  const { turn, participantId, customerMessage, isCustomerTurn, gate, loaded, appBaseUrl } = args

  /**
   * The notice about what is kept, owed to anybody who has typed into the box.
   *
   * This used to fire on the first fact `record_facts` accepted, on the reasoning that a fact
   * is the moment something starts being true. It is not: the message itself is stored, in
   * full, before the gate has even decided whether the model may see it. Half of the cases
   * that reached a customer never showed the notice — somebody who asked a question without
   * stating anything recordable had their words written down and was told nothing, and so did
   * everybody whose turn failed before it could record a fact.
   *
   * Tied to the write that actually happens first, so there is no conversation where the
   * notice is owed and not given. Still once per case, still decided here rather than by the
   * model: a disclosure the model could choose to skip is not a disclosure.
   */
  let pendingNotice: Card | undefined
  if (isCustomerTurn) {
    await saveMessage(admin, {
      caseId: turn.caseId,
      participantId: participantId,
      role: 'customer',
      content: customerMessage,
      gateCategory: gate.category,
    })

    /*
     * The same message again, within ten minutes, is the customer saying the last answer did
     * not land. Twice in one live case, and the transcript showed two ordinary turns. Written
     * as an event so the stall is visible in the console. Nothing else about the turn changes.
     *
     * `loaded` was read before the save above, so its last customer message is the previous
     * one, not the one just written.
     */
    const previousCustomerMessage = [...loaded.messages]
      .reverse()
      .find((message) => message.role === 'customer')
    if (
      previousCustomerMessage !== undefined &&
      isRepeatedMessage(customerMessage, previousCustomerMessage, Date.now())
    ) {
      await writeEvent(admin, {
        caseId: turn.caseId,
        type: 'customer_repeated',
        actor: 'customer',
        payload: { said: customerMessage.trim().slice(0, 120) },
      })
    }

    const alreadyShown = await admin
      .from('events')
      .select('id')
      .eq('case_id', turn.caseId)
      .eq('type', DATA_NOTICE_EVENT)
      .limit(1)
      .maybeSingle()

    if (!alreadyShown.data) {
      await writeEvent(admin, {
        caseId: turn.caseId,
        type: DATA_NOTICE_EVENT,
        actor: 'system',
        payload: {},
      })
      pendingNotice = dataNoticeCard(`${appBaseUrl}#/privacy`)
    }
  }

  /**
   * What the tap saved them, as a card (§53).
   *
   * Starting applications writes a `context_reused` event for every requirement satisfied by a
   * fact that was already held. Until now the only trace on the customer's screen was a
   * sentence the model was told and usually paraphrased away; the count lived in the admin
   * console. This reads the rows the tap just wrote and puts them on screen before the model
   * speaks, with the live value of each fact and where it came from. The model writes none of
   * it (Invariant 2).
   *
   * Bounded by the last thing Saoirse said, so a tap shows what that tap reused and not the history
   * of the case. A sign-in is an action turn too, and the one row it produces, the email the
   * account supplied, is the first thing a signed-in customer is not asked for.
   */
  let pendingReuse: Card | undefined
  if (turn.trigger === 'action') {
    const lastSaoirse = [...loaded.messages]
      .reverse()
      .find((message) => message.role === 'assistant')
    let query = admin
      .from('events')
      .select('payload')
      .eq('case_id', turn.caseId)
      .eq('type', 'context_reused')
      .order('created_at', { ascending: true })
    if (lastSaoirse !== undefined) query = query.gt('created_at', lastSaoirse.createdAt)

    const rows = ((await query).data ?? []) as { payload: Record<string, unknown> }[]
    const events = rows.flatMap((row): ReuseEvent[] => {
      const name = row.payload['applicationName']
      if (typeof name !== 'string') return []
      const key = row.payload['key']
      const source = row.payload['source']
      return [
        {
          key: typeof key === 'string' ? key : null,
          source: typeof source === 'string' ? source : null,
          applicationName: name,
        },
      ]
    })
    const items = describeReused(events, loaded.facts)

    if (items.length > 0) {
      const started = [...new Set(events.map((event) => event.applicationName))]
      pendingReuse = {
        type: 'reuse',
        title: `${String(items.length)} ${items.length === 1 ? 'thing' : 'things'} you never had to type`,
        started,
        items: items.map((item) => ({
          key: item.key,
          label: item.label,
          value: item.value,
          source: item.source,
          provenance: item.provenance,
          usedFor: [...item.usedFor],
        })),
      }
    }
  }

  /**
   * The account is open: the news before anything else (§6 Stage 13, §41).
   *
   * Owed to every opened account that has not been welcomed, on whatever turn comes next. Which
   * ones have been is read from the transcript by application id rather than counted in the
   * loaded messages: those are the last two dozen, sized for the model, and a welcome counted
   * only there would come back each time it scrolled out of them. Asked for only when there is
   * an opened account, so every other case pays nothing for the read. Built from the case, not
   * by the model (Invariant 2).
   */
  let pendingWelcome: Card | undefined
  if (openedAccounts(loaded).length > 0) {
    const welcomed = await admin
      .from('messages')
      .select('cards')
      .eq('case_id', turn.caseId)
      .contains('cards', JSON.stringify([{ type: ACCOUNT_OPENED_CARD }]))
    /*
     * A JSON string, not an array: supabase-js serialises an array for `cs` as a Postgres
     * array literal, which a jsonb column refuses, and the refused read came back as "nobody
     * has been welcomed" on every turn of a live case. Six welcomes in a row.
     */
    if (welcomed.error !== null) {
      console.error(`welcomed accounts could not be read: ${welcomed.error.message}`)
    }
    pendingWelcome = welcomeCardFor(loaded, welcomedAccounts(welcomed.data ?? []))
  }

  /**
   * A tap is recorded as what it was.
   *
   * It used to be saved as a customer message, so "Started Savings account, Joint current
   * account, Mortgage. 7 things carried over from what we already knew." appeared in the
   * transcript as something the customer had typed. They had not — they had ticked two boxes.
   * The transcript is the record a person reads before phoning them, and putting words in
   * somebody's mouth there is not a cosmetic problem.
   *
   * `system` is already filtered out of the chat and out of the history Saoirse sees on later
   * turns, which is right: what the tap actually did is in the case, and the digest reports it
   * from there (Invariant 2).
   */
  if (turn.trigger === 'action' && customerMessage.length > 0) {
    await saveMessage(admin, {
      caseId: turn.caseId,
      participantId: participantId,
      role: 'system',
      content: customerMessage,
      gateCategory: 'banking',
    })
  }

  return { pendingNotice, pendingReuse, pendingWelcome }
}

/** A blocked turn never reaches the model (Invariant 4): the block is recorded, the canned reply saved. */
export async function persistBlocked(
  admin: Db,
  args: {
    readonly turn: SaoirseTurnRequest
    readonly customerMessage: string
    readonly gate: GateBlocked
    readonly pendingNotice: Card | undefined
    readonly usage: TurnUsage
  },
): Promise<string> {
  const { turn, customerMessage, gate, pendingNotice, usage } = args

  await writeEvent(admin, {
    caseId: turn.caseId,
    type: 'request_blocked',
    actor: 'system',
    payload: {
      category: gate.category,
      reason: gate.reason,
      injectionFlagged: gate.injectionFlagged,
      /**
       * What was actually asked, capped.
       *
       * §39 wants enforcement observable, and a log of categories and timestamps does not
       * show that: "off topic at 14:06" proves nothing, "count to 10,000 — off topic" proves
       * the thing. The request never reaches the model either way (Invariant 4); this is the
       * record of what was turned away, which is the opposite of answering it.
       */
      request: customerMessage.slice(0, 200),
      /**
       * Present only when the classifier is why this was blocked.
       *
       * A gate that fails closed looks identical from the outside whatever went wrong behind
       * it, which is correct for the customer and useless for whoever has to fix it. This is
       * the one place the difference is recorded.
       */
      ...(gate.classifierFailure ? { classifierFailure: gate.classifierFailure } : {}),
    },
  })

  if (gate.classifierFailure) {
    // Also to the function log, because a gate that is down is an incident, not a data point
    // waiting to be queried.
    console.error(
      `gate classifier ${gate.classifierFailure.kind}: ${gate.classifierFailure.detail}`,
    )
  }
  /*
   * A blocked turn still owes the notice.
   *
   * The request never reaches the model, but it is stored in full — it has to be, because
   * §39 wants the block auditable and the payload carries the first 200 characters of what
   * was asked. Somebody who only ever asks out-of-scope questions is recorded exactly like
   * anybody else, and used to be the one person guaranteed never to be told.
   */
  return saveMessage(admin, {
    caseId: turn.caseId,
    participantId: null,
    role: 'assistant',
    content: gate.response,
    usage,
    ...(pendingNotice === undefined ? {} : { cards: [pendingNotice] }),
  })
}

/**
 * The reply, once it has streamed: the observations about how it went (a card promised and not
 * shown, a question beside a card), the message itself, what the model called and was refused,
 * the form applications brought up to date, and the case marked as seen.
 */
export async function persistReply(
  admin: Db,
  args: {
    readonly turn: SaoirseTurnRequest
    readonly text: string
    readonly shown: readonly unknown[]
    readonly digest: ReturnType<typeof buildCaseDigest>
    readonly called: readonly string[]
    readonly rejections: readonly { name: string; error: string }[]
    readonly usage: TurnUsage
  },
): Promise<string> {
  const { turn, text, shown, digest, called, rejections, usage } = args

  /*
   * A reply that sends the customer to a card nobody drew.
   *
   * Saoirse once told somebody "tap the card to start it" without ever calling the tool, and
   * then retracted it two paragraphs later. Nothing failed, so nothing was recorded and
   * the only trace was a screenshot. This cannot be fixed after the fact — the words are
   * already sent — but it can stop being invisible.
   *
   * Deliberately narrow. Only phrases that point at something on screen right now, so an
   * ordinary mention of a card in passing does not trip it.
   *
   * Narrow is not the same as right. The first real instance of this in front of a
   * customer read "so here they are" and then, when they said they saw nothing, "sorry
   * about that, they didn't come through. Here they are." Both were a promise of
   * something on screen, neither said "card", and the detector built for this watched
   * both go past. Saoirse does not use the word card when it is being natural, which is
   * most of the time.
   */
  const promisedACard =
    // "above" refers to a card already on screen, which is not a promise of a new one.
    /\btap (the|that) (card|option)|\bcard below\b/i.test(text) ||
    /\bhere (they|it|those) (are|is)\b|\bhere are (the|your|those|three|some|a few)\b/i.test(text)
  if (shown.length === 0 && promisedACard) {
    await writeEvent(admin, {
      caseId: turn.caseId,
      type: 'card_promised_not_shown',
      actor: 'model',
      payload: { said: text.slice(0, 200) },
    })
  }

  /*
   * A card waiting for a tap, and a question competing with it.
   *
   * Saoirse put two savings accounts on screen and asked, underneath them, what the customer
   * paid in rent and whether they banked jointly. Three things asked at once: the reply
   * could answer the text or answer the card, and whichever it did the rest was left
   * hanging. It happened on three of the last four turns of that conversation.
   *
   * The rule is stated in the stage guides and in the tool descriptions, which is where
   * it can actually prevent anything. This is the half that notices, so a turn that
   * breaks it leaves a row rather than only a screenshot.
   */
  const waiting = shown.flatMap((card) => {
    const type =
      typeof card === 'object' && card !== null ? (card as { type?: unknown }).type : undefined
    return typeof type === 'string' && awaitsCustomer(type) ? [type] : []
  })

  if (waiting.length > 0 && asksSomething(text)) {
    await writeEvent(admin, {
      caseId: turn.caseId,
      type: 'question_with_card',
      actor: 'model',
      payload: { cards: waiting, said: text.slice(-200) },
    })
  }

  /*
   * The same thing one turn later: a card from an earlier reply still untapped, and this
   * reply asks something new instead of pointing at it. The digest told the model the
   * card was waiting, so a question here is the rule being broken with the facts in hand.
   */
  if (digest.awaiting !== undefined && waiting.length === 0 && asksSomething(text)) {
    await writeEvent(admin, {
      caseId: turn.caseId,
      type: 'question_while_card_awaits',
      actor: 'model',
      payload: {
        card: digest.awaiting.type,
        turnsAgo: digest.awaiting.turnsAgo,
        said: text.slice(-200),
      },
    })
  }

  const messageId = await saveMessage(admin, {
    caseId: turn.caseId,
    participantId: null,
    role: 'assistant',
    content: text,
    cards: shown,
    usage,
  })

  /*
   * What the server refused, so a turn that went nowhere can be explained afterwards.
   *
   * The model sees these as tool errors and can correct itself, which is the point. But
   * when it cannot — when the same call is refused three times and the turn ends with
   * nothing said — this is the only record of why.
   */
  if (called.length > 0 || rejections.length > 0) {
    await writeEvent(admin, {
      caseId: turn.caseId,
      type: 'turn_tools',
      actor: 'model',
      payload: { called, refused: rejections.length },
    })
  }

  for (const rejection of rejections) {
    await writeEvent(admin, {
      caseId: turn.caseId,
      type: 'tool_rejected',
      actor: 'model',
      payload: { tool: rejection.name, error: rejection.error.slice(0, 300) },
    })
  }

  /*
   * The digital form applications, brought up to date with whatever was collected.
   *
   * Caught rather than thrown: the reply has already streamed, and a turn that ends in
   * an error because a console view could not be refreshed would be a worse failure than
   * the one it is reporting. The event row is how it gets noticed.
   */
  try {
    const synced = await syncFormApplications(admin, turn.caseId)
    if (synced.forms.length > 0) {
      await writeEvent(admin, {
        caseId: turn.caseId,
        type: 'form_application_updated',
        actor: 'system',
        payload: { forms: synced.forms, answered: synced.answered, reused: synced.reused },
      })
    }
  } catch (error) {
    await writeEvent(admin, {
      caseId: turn.caseId,
      type: 'form_sync_failed',
      actor: 'system',
      payload: {
        error: (error instanceof Error ? error.message : 'unknown').slice(0, 300),
      },
    })
  }

  // Everything up to now has been seen, so the next return summarises only what is
  // genuinely new (§36).
  await touchLastSeen(admin, turn.caseId)

  return messageId
}
