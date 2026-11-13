import { ApiError } from '../errors.ts'
import type { SaoirseTurnRequest } from '@shared/contracts/saoirse-turn.ts'
import type { GateAllowed } from './gate.ts'
import { computeStage } from './stage.ts'
import { caseHasEvent } from './lookups.ts'
import { journeyFor } from '@shared/domain/journeys/index.ts'
import { type NameFor } from '@shared/db/applications.ts'
import { SIGN_IN_PROMPT_EVENT, worthSigningInFor } from '@shared/llm/sign-in-prompt.ts'
import { describeArrangement } from '@shared/domain/savings/situation.ts'
import { savingsOptionsFrom } from '@shared/tenants/demo/savings-options.ts'
import { suitableCurrentAccount } from '@shared/tenants/demo/current-accounts.ts'
import { toneBucket } from '@shared/llm/persona.ts'
import { demoProducts, productInfo } from '@shared/tenants/demo/products.ts'
import { knowledgeProduct } from '@shared/tenants/demo/kb-prompt.ts'
import { loadMortgageRates, loadProductCatalogue } from '@shared/db/catalogue.ts'
import { loadMarket } from '@shared/db/market.ts'
import { withMarketData } from '@shared/tenants/demo/market.ts'
import { loadCase, mustWrite, type Db, writeEvent } from '@shared/db/case-repository.ts'
import { buildCaseDigest } from '@shared/db/digest.ts'
import { needContextFor, needsFor, revivableNeeds } from '@shared/db/needs.ts'
import {
  describePlan,
  dueCheckins,
  loadPlans,
  raiseDueCheckins,
  reconcilePlans,
} from '@shared/db/plans.ts'
import { suggestionsFor } from '@shared/domain/quotes/suitability.ts'
import { isProduct, type Product } from '@shared/domain/journey.ts'
import { describeProspect, wouldInvolve } from '@shared/domain/prospect.ts'
import { describeGoals, goalContextFor } from '@shared/db/goals.ts'
import {
  arrivedWith,
  type ClaimedPlan,
  loadClaimedPlans,
  savedPlanDigestLines,
} from '@shared/db/saved-plans.ts'
import { loadCaseAlerts, loadOpenReminders } from '@shared/db/alerts.ts'
import { shortDate } from '@shared/domain/market/alerts.ts'
import { loadHoldings } from '@shared/db/holdings.ts'
import { holdingLine, planProgress } from '@shared/domain/market/holdings.ts'
import {
  describeEvent,
  isNarratable,
  PLAN_EDITED_EVENT,
  PRODUCT_CHOICE_REMOVED_EVENT,
  PRODUCT_CHOSEN_EVENT,
} from '@shared/domain/narration.ts'
import { participantFor, type LoadedCase, type LoadedMessage } from '@shared/db/loaded-case.ts'

/** The case and the catalogue Saoirse speaks from this turn. */
export async function loadTurnContext(admin: Db, caseId: string) {
  /*
   * The catalogue and the rate table Saoirse speaks from this turn (§51): the rows a presenter has
   * loaded and edited in the console, or the published files until there are any. Read with
   * the case, because every turn that gets past the gate needs both.
   */
  const [loaded, catalogue, rateTable, market] = await Promise.all([
    loadCase(admin, caseId),
    loadProductCatalogue(admin),
    loadMortgageRates(admin),
    loadMarket(admin),
  ])
  if (!loaded) throw new ApiError('not_found', 'That case does not exist.')
  /*
   * Market data over the catalogue: every rate, limit and bonus condition for a product the
   * refresh covers comes from `market_products` (or the committed snapshot), never from the
   * catalogue's own pricing. The prompt, the cards and the savings engine all read it from here.
   */
  const kb = { ...catalogue, products: withMarketData(catalogue.products, market.products) }
  const savingsOptions = savingsOptionsFrom(kb.products)

  /*
   * What to call an application whose row carries no name: one created before names were
   * stored (`applicationName`). The catalogue is in hand on every turn, so a SuperSaver from
   * last week is still SuperSaver on a card rather than "Savings account".
   */
  const nameFor: NameFor = (product, catalogueId) =>
    (catalogueId === null ? undefined : knowledgeProduct(catalogueId, kb.products)?.name) ??
    journeyFor(product).displayName

  const tone = toneBucket(loaded.persona)

  return { loaded, kb, rateTable, savingsOptions, nameFor, tone }
}

export type TurnContext = Awaited<ReturnType<typeof loadTurnContext>>

/**
 * Everything the model is told this turn, worked out from the case: plans caught up, goals,
 * suitability, the stage, the digest and the conversation so far. Writes only the events the
 * edge function wrote at this point (plan milestones, check-ins, goals identified, the watch).
 */
export async function buildGeneration(
  admin: Db,
  args: {
    readonly turn: SaoirseTurnRequest
    readonly loaded: LoadedCase
    readonly gate: GateAllowed
    readonly kb: TurnContext['kb']
    readonly savingsOptions: TurnContext['savingsOptions']
    readonly customerMessage: string
    readonly isCustomerTurn: boolean
  },
) {
  const { turn, loaded, gate, kb, savingsOptions, customerMessage, isCustomerTurn } = args

  const primary = participantFor(loaded, 'primary')
  // Catch the plan up with what has actually happened before anything is said about it.
  const achievedMilestones = await reconcilePlans(admin, turn.caseId, loaded)
  for (const { milestone } of achievedMilestones) {
    await writeEvent(admin, {
      caseId: turn.caseId,
      type: 'plan_milestone_reached',
      actor: 'system',
      payload: { label: milestone.label },
    })
  }

  /**
   * A check-in waiting on an event becomes due when the event has actually happened. The
   * milestones just reconciled above are what makes that evaluable here rather than on a
   * schedule nothing is watching.
   */
  const firedEvents = [
    ...loaded.eventsSinceLastSeen.map((event) => event.type),
    /*
     * Only money actually arriving. This used to fire on any achieved milestone, so defining a
     * deposit target raised the check-in meant for reaching one — a customer €3,500 short had a
     * "mortgage readiness review" come due the moment their plan was created.
     */
    ...(achievedMilestones.some((entry) => entry.reachedTarget) ? ['savings_target_reached'] : []),
  ]

  const raised = await raiseDueCheckins(admin, turn.caseId, loaded, firedEvents)
  for (const { checkin } of raised) {
    await writeEvent(admin, {
      caseId: turn.caseId,
      type: 'checkin_due',
      actor: 'system',
      payload: { purpose: checkin.purpose },
    })
  }

  const loadedPlans = await loadPlans(admin, turn.caseId, loaded)
  const keptPlans = loadedPlans
    .filter((entry) => entry.plan.status === 'active')
    .map((entry) => ({ title: entry.plan.title, lines: [...describePlan(entry)] }))

  const revivable = await revivableNeeds(admin, turn.caseId, loaded)
  const revived = revivable
    .map((item) => {
      const need = loaded.needs.find((candidate) => candidate.id === item.needId)
      return need === undefined ? null : { name: need.name, reason: item.reason }
    })
    .filter((item): item is { name: string; reason: string } => item !== null)

  // Whichever check-in is due now, with the agenda written when it was agreed.
  const dueNow = dueCheckins(loadedPlans, loaded, firedEvents)[0] ?? null

  /**
   * Where the customer is trying to get to, which is not the same as what they are applying for.
   *
   * Built after the plans load, because a goal that already has a plan is settled rather than a
   * candidate to raise again.
   */
  const goalContext = goalContextFor(loaded, loadedPlans, {
    sensitiveDisclosure: gate.suppressHumour,
  })
  const goals = describeGoals(goalContext, loaded.goals)

  /*
   * §9 — "top discovered goals" needs an event, and discovery is not a moment anything else
   * records. A goal reaching a tier worth raising is the closest thing to one: it is when Saoirse
   * first has grounds to bring it up, which is what the panel is actually asking about.
   *
   * Written once per goal per case. Tiering is recomputed every turn from the facts, so a goal
   * that stays established would otherwise write an event on every message and the chart would
   * measure how talkative somebody was.
   */
  const identifiedBefore = await admin
    .from('events')
    .select('payload')
    .eq('case_id', turn.caseId)
    .eq('type', 'goal_identified')

  /*
   * A failed read means writing nothing, not writing everything. Defaulting to an empty set
   * would make every turn look like the first one and double-count every goal on the chart,
   * which is a worse outcome than a gap — a missing event is visibly missing.
   */
  const alreadyIdentified =
    identifiedBefore.error === null
      ? new Set(
          (identifiedBefore.data as { payload: { goal?: string } }[])
            .map((row) => row.payload.goal)
            .filter((goal): goal is string => goal !== undefined),
        )
      : null

  for (const candidate of alreadyIdentified === null ? [] : goals.candidates) {
    if (candidate.tier === 'latent' || candidate.tier === 'deferred') continue
    if (alreadyIdentified?.has(candidate.goal.id) === true) continue

    await writeEvent(admin, {
      caseId: turn.caseId,
      type: 'goal_identified',
      actor: 'system',
      payload: {
        goal: candidate.goal.id,
        tier: candidate.tier,
        confidence: Number(candidate.confidence.toFixed(2)),
        // What actually raised it, so "why is this on the chart" has an answer.
        because: candidate.evidence[0]?.describe ?? null,
      },
    })
  }

  /**
   * Whether what they are looking at is what suits them.
   *
   * Evaluated against whatever borrowing is actually in play — an application they have started,
   * or the product they have been quoted. Silent until they have said both what they want and
   * how soon they mean to repay it, because guessing a recommendation from an amount alone is
   * how cross-selling works.
   */
  const borrowing = loaded.applications.find((application) =>
    ['personal_loan', 'credit_card'].includes(application.product),
  )?.product

  /**
   * An application if there is one, otherwise whatever they have described wanting.
   *
   * Looking only at started applications meant the rules never ran during the conversation that
   * decides which product to start — which is the one conversation they are for. Somebody who
   * has said an amount and a date is considering borrowing whether or not anything exists yet,
   * and a loan is what people ask for by default.
   */
  const considering: Product | null =
    borrowing ??
    (goalContext !== null && goalContext.facts.has('borrowing.requestedAmount', 'household')
      ? 'personal_loan'
      : null)

  /**
   * Which current account, decided from facts rather than by the model (§51, Invariant 3).
   *
   * Five accounts in the pack, one with a fee, and the model offered that one to everybody.
   * Worked out once a turn from the facts held and the catalogue the turn holds, and put in the
   * digest only while the everyday banking need is live or an account is already being opened:
   * a line about current accounts in a mortgage conversation is noise charged every round. The
   * `show_product_options` handler holds the card to the same pick.
   */
  const currentAccountPick =
    goalContext === null ? null : suitableCurrentAccount(goalContext.facts, new Date(), kb.products)
  const everydayBankingLive =
    loaded.applications.some((application) => application.product === 'current_account') ||
    needsFor(loaded, { sensitiveDisclosure: gate.suppressHumour }).some(
      (candidate) =>
        candidate.need.id === 'everyday_banking' &&
        (candidate.state === 'ready_to_surface' || candidate.state === 'clarify'),
    )
  const currentAccountLines =
    currentAccountPick === null || !everydayBankingLive
      ? []
      : [
          `Current account: offer the ${currentAccountPick.name} (${currentAccountPick.catalogueId}) ` +
            `and no other current account. ${currentAccountPick.because}` +
            (currentAccountPick.insteadOf.length === 0
              ? ''
              : ` Do not offer ${currentAccountPick.insteadOf.join(', ')}.`),
        ]

  const suitability = [
    ...(considering === null || goalContext === null
      ? []
      : suggestionsFor(considering, {
          facts: goalContext.facts,
          variants: {
            personal_loan: demoProducts.personal_loan.variants,
            credit_card: demoProducts.credit_card.variants,
            savings: demoProducts.savings.variants,
          },
        }).map((suggestion) => `${productInfo(suggestion.to).name}: ${suggestion.because}`)),
    ...currentAccountLines,
  ]

  /*
   * What applying for the quoted product would involve.
   *
   * Only for something they have been shown figures for and have not applied for — once an
   * application exists the digest already describes it properly, and two accounts of the same
   * product would let the model pick the wrong one. Computed from the real journey so that
   * "what would I need?" has an answer that is not improvised (§51, Invariant 3).
   */
  /*
   * Quoted or offered, whichever happened last.
   *
   * Only quoting was too narrow: a customer shown the product options card and asked "what
   * documents do I need?" got "I don't have a fixed document list", because the list is only
   * assembled for something they have been given figures for. Both events mean the same thing
   * here — this product is the one on the table.
   */
  const quoted = await admin
    .from('events')
    .select('payload')
    .eq('case_id', turn.caseId)
    .in('type', ['product_quoted', 'product_offered'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const quotedProduct = (quoted.data?.payload as { product?: string } | undefined)?.product
  const primaryParticipant = participantFor(loaded, 'primary')

  const prospect =
    quotedProduct === undefined ||
    primaryParticipant === null ||
    !isProduct(quotedProduct) ||
    loaded.applications.some((application) => application.product === quotedProduct)
      ? []
      : describeProspect(
          wouldInvolve(quotedProduct, {
            facts: loaded.facts,
            primary: primaryParticipant,
            partner: participantFor(loaded, 'partner'),
          }),
          productInfo(quotedProduct).name,
        )

  const { stage, arrangement } = computeStage({ loaded, goals, keptPlans, savingsOptions })

  /*
   * A plan they made in their own AI and opened here. In the digest on every turn, not only
   * the first: it is the reason the conversation exists, and "what was step two again?" is a
   * question for next week too.
   */
  const claimedPlans = await loadClaimedPlans(admin, turn.caseId)
  const broughtPlans = claimedPlans.map((claimed, index) => ({
    title: claimed.plan.title,
    // The claim's first message (the card and the question) is in the transcript: say so. The
    // newest plan carries the choices (the choice route keeps them on it).
    lines: savedPlanDigestLines(
      claimed,
      arrivedWith(claimed, loaded.messages),
      index === claimedPlans.length - 1,
    ),
  }))

  /*
   * Plan alerts not yet seen and the dates they gave. Saoirse states the alerts first ("Since you
   * were here: …") in their own factual wording; they are marked seen once the reply is saved.
   * Unreadable alerts never stop a turn.
   */
  const [unseenAlerts, reminders] = await Promise.all([
    loadCaseAlerts(admin, turn.caseId, { unseenOnly: true, limit: 10 }).catch(() => []),
    loadOpenReminders(admin, turn.caseId).catch(() => []),
  ])
  const alerts =
    unseenAlerts.length === 0 && reminders.length === 0
      ? undefined
      : {
          unseen: [...unseenAlerts].reverse().map((alert) => `${alert.title}: ${alert.body}`),
          reminders: reminders.map((reminder) => `${reminder.label}, ${shortDate(reminder.dueOn)}`),
        }

  /*
   * What they hold, entered by hand or seeded from the plan, and where that leaves the plan, so
   * a return visit opens with where things stand. Facts to state, never to praise. Unreadable
   * holdings never stop a turn.
   */
  const heldNow = await loadHoldings(admin, turn.caseId).catch(() => [])
  const latestPlan = claimedPlans.at(-1)
  const progress =
    latestPlan === undefined
      ? null
      : planProgress(
          latestPlan.plan,
          heldNow,
          new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' }),
        )
  const holdings =
    heldNow.length === 0 && progress === null
      ? undefined
      : {
          lines: heldNow.map((holding) => `[${holding.id}] ${holdingLine(holding)}`),
          progress: progress?.line ?? null,
        }

  /*
   * The products cards already shown (`show_products`), newest last: the arrangement and how
   * long ago, so a follow-up ("by access instead") calls the tool again. The rows' figures are
   * not repeated; only what each figure counts is, below.
   */
  const productsShown = productsShownLines(loaded.messages)
  /*
   * What each row's money figure counts on the most recent cards, from the `products_shown`
   * events (2026-11-12: asked in the next turn whether bunq's €581 would be realised, Saoirse
   * had only the card's arrangement and said it would not). Unreadable, it is left out.
   */
  const [shownEvents, lookedUpEvents, comparedEvents] = await Promise.all([
    admin
      .from('events')
      .select('payload')
      .eq('case_id', turn.caseId)
      .eq('type', 'products_shown')
      .order('created_at', { ascending: false })
      .limit(PRODUCTS_BASIS_EVENTS),
    /*
     * What `lookup_products` was asked in earlier turns (2026-11-13), so a follow-up ("and the
     * AIB one?") knows what was found. The ids, never the figures: those are looked up again.
     */
    admin
      .from('events')
      .select('payload')
      .eq('case_id', turn.caseId)
      .eq('type', 'products_looked_up')
      .order('created_at', { ascending: false })
      .limit(PRODUCTS_LOOKED_UP_EVENTS),
    /*
     * What `compare_products` set side by side (2026-11-13), so a follow-up ("and if I need the
     * money sooner?") compares the same products again. Ids and names, never the figures.
     */
    admin
      .from('events')
      .select('payload')
      .eq('case_id', turn.caseId)
      .eq('type', 'products_compared')
      .order('created_at', { ascending: false })
      .limit(PRODUCTS_COMPARED_EVENTS),
  ])
  const productsBasis = shownEvents.error === null ? productsBasisLines(shownEvents.data ?? []) : []
  const productsLookedUp =
    lookedUpEvents.error === null ? productsLookedUpLines(lookedUpEvents.data ?? []) : []
  /*
   * The must-knows of the products on a card they have since asked about by name (2026-11-13,
   * progressive disclosure): the ids `lookup_products` found, the facts the newest card carried.
   */
  const productsMustKnow =
    shownEvents.error === null && lookedUpEvents.error === null
      ? productsMustKnowLines(shownEvents.data ?? [], lookedUpEvents.data ?? [])
      : []

  const productsCompared =
    comparedEvents.error === null ? productsComparedLines(comparedEvents.data ?? []) : []
  /*
   * The products selected on the cards, sent with this message (2026-11-13): current for this
   * turn only, so the digest lists them and the message carries them as an aside.
   */
  const selected = isCustomerTurn ? selectionLines(turn.selection) : []

  const digest = buildCaseDigest(loaded, {
    ...(alerts === undefined ? {} : { alerts }),
    ...(holdings === undefined ? {} : { holdings }),
    ...(productsShown.length === 0 ? {} : { productsShown }),
    ...(productsBasis.length === 0 ? {} : { productsBasis }),
    ...(productsLookedUp.length === 0 ? {} : { productsLookedUp }),
    ...(productsMustKnow.length === 0 ? {} : { productsMustKnow }),
    ...(productsCompared.length === 0 ? {} : { productsCompared }),
    ...(selected.length === 0 ? {} : { productsSelected: selected }),
    sensitiveDisclosure: gate.suppressHumour,
    stage,
    acting: turn.trigger === 'action',
    plans: keptPlans,
    ...(goals.lines.length === 0 ? {} : { goals: [...goals.lines] }),
    ...(suitability.length === 0 ? {} : { suitability }),
    ...(prospect.length === 0 ? {} : { prospect: [...prospect] }),
    ...(arrangement === null || arrangement.needs.length > 0
      ? {}
      : { arrangement: describeArrangement(arrangement) }),
    ...(arrangement === null || arrangement.needs.length === 0
      ? {}
      : { arrangementNeeds: arrangement.needs.map((need) => need.why) }),
    ...(revived.length === 0 ? {} : { revived }),
    ...(broughtPlans.length === 0 ? {} : { broughtPlans }),
    ...(dueNow === null
      ? {}
      : {
          checkin: {
            purpose: dueNow.checkin.purpose,
            plan: dueNow.plan.title,
            agenda: [...dueNow.checkin.agenda],
          },
        }),
  })
  const needContext = needContextFor(loaded, { sensitiveDisclosure: gate.suppressHumour })

  /**
   * Record what the bank has committed to watching for.
   *
   * Only once the customer has actually opened the savings account: telling someone you will
   * watch for something is a promise, and a promise attaches to the thing they chose to do,
   * not to Saoirse having mentioned a plan (Invariant 1).
   */
  const planWatch = digest.plan?.watchDetail ?? null
  if (planWatch !== null && loaded.applications.some((a) => a.product === 'savings')) {
    const open = await admin
      .from('plan_watches')
      .select('id')
      .eq('case_id', turn.caseId)
      .is('met_at', null)
      .limit(1)

    if (((open.data ?? []) as unknown[]).length === 0) {
      mustWrite(
        await admin.from('plan_watches').insert({
          case_id: turn.caseId,
          kind: planWatch.kind,
          target: planWatch.kind === 'savings_target' ? planWatch.target : null,
          on_date: planWatch.kind === 'date' ? planWatch.on : null,
          describe: planWatch.describe,
        }),
        'the plan watch',
      )
    }
  }

  /*
   * Whether the offer to sign in is about to appear under this reply.
   *
   * Decided before the model speaks, not after, because it changes what the reply should say.
   * Saoirse was starting three applications and asking for a name and date of birth in the same
   * breath, with the sign-in card arriving underneath — asking somebody to type what signing
   * in is about to supply, in the wrong order.
   */
  /*
   * A plan brought from their own AI is worth keeping too: signing in is how it reaches the
   * installed app and another device. Not on the turn that opens it, which is about the plan.
   */
  const openedPlan =
    turn.trigger === 'return' &&
    loaded.eventsSinceLastSeen.some((event) => event.type === 'plan_claimed')
  const afterPlanEdit =
    !openedPlan && returnsAfterPlanEdit(turn.trigger, loaded.eventsSinceLastSeen)
  /*
   * Not on the first questions about it either (2026-11-10): asked to talk the options through,
   * the reply is the answer, not an offer to sign in. Once they have said a few things.
   */
  const customerTurns = loaded.messages.filter((message) => message.role === 'customer').length
  const signInForPlan =
    broughtPlans.length > 0 &&
    loaded.authLevel !== 'authenticated' &&
    !openedPlan &&
    customerTurns >= 3

  const offeringSignIn =
    !(await caseHasEvent(admin, turn.caseId, SIGN_IN_PROMPT_EVENT)) &&
    (worthSigningInFor(loaded) || signInForPlan)

  /**
   * What the reply has to do when the offer is about to appear beneath it.
   *
   * Applied to every kind of turn, not only a tap. The first version only reached `action`
   * turns, so when the offer landed on an ordinary message the card appeared under "what's
   * your home address, and how long have you lived there?" — a question with nothing to do
   * with it, from a Saoirse that did not know it was coming.
   */
  const SIGN_IN_INSTRUCTION =
    ' An offer to sign in is on screen directly under your reply, and your reply is what has ' +
    'to lead into it. Put it to them in your own words: there is now something here worth ' +
    'keeping, and signing in means they can stop and pick it up later or on another device. ' +
    'Ask whether they would like to, and end there. Do not ask for their name, date of ' +
    'birth, address or anything else personal in this turn: the offer is the whole point of ' +
    'the turn and a question beside it splits their attention. Do not promise that signing in ' +
    'fills anything in for them, because it does not. It keeps what they have and lets them ' +
    'come back to it. Do not describe the card or name the button.'

  const { history } = conversationSoFar({
    messages: loaded.messages,
    claimedPlans,
    customerMessage: isCustomerTurn ? customerMessage : null,
    signIn: offeringSignIn ? SIGN_IN_INSTRUCTION.trim() : null,
    selection: selectionAside(selected),
  })

  if (turn.trigger === 'action') {
    // Told as an event, not quoted as speech, so Saoirse does not answer a question nobody asked.
    history.push({
      role: 'user',
      content:
        `(The customer did this in the app: ${customerMessage} They did not type anything, so ` +
        'do not reply as though they had and do not thank them for a message. ' +
        `${turn.note ?? 'Say what it means for them and what you need next.'} Keep it brief.` +
        (offeringSignIn ? SIGN_IN_INSTRUCTION : '') +
        ')',
    })
  }

  /*
   * They have just opened a plan made in their own AI. The card is already on screen; the turn
   * says what it is and what comes next, from the digest's own lines, and stops.
   */
  if (openedPlan) {
    history.push({
      role: 'user',
      content:
        '(The customer has just opened, in this app, the comparison they saved in their own AI ' +
        'assistant. In the app you have already said hello and shown what Saoi keeps, and they ' +
        'accepted, so do not greet them, introduce yourself or mention the notice again. The ' +
        'card is on screen above your reply with their figures and the first three options. ' +
        'Say exactly "Here it is. Where would you like to start?" and nothing else: no ' +
        'judgement of the comparison ("solid", "good", "strong"), no summary. ' +
        'quick replies under your line offer talking the options through, changing a figure, ' +
        'or how it was worked out. It is a comparison, not advice: never pick a product, lender ' +
        'or option for them. No figures in this line.)',
    })
  } else if (turn.trigger === 'return') {
    // §36 — the customer did not ask anything; they came back. Lead with what changed.
    history.push({
      role: 'user',
      content: returnInstruction(loaded.eventsSinceLastSeen, {
        market: claimedPlans.length > 0 || heldNow.length > 0,
      }),
    })
  }

  if (history.length === 0) {
    history.push({
      role: 'user',
      content: '(The customer has just arrived. Open the conversation.)',
    })
  }

  return {
    /** The unseen alerts this turn's digest states; marked seen when the reply is saved. */
    alertIds: unseenAlerts.map((alert) => alert.id),
    primary,
    signInForPlan,
    /** The case holds the customer's figures for the market: `show_products` is offered. */
    hasFigures: claimedPlans.length > 0 || heldNow.length > 0,
    /** The return turn after a plan edit: text only, no tool offered (`offeredTools`). */
    afterPlanEdit,
    goals,
    goalContext,
    digest,
    stage,
    arrangement,
    currentAccountPick,
    needContext,
    history,
  }
}

export type Generation = Awaited<ReturnType<typeof buildGeneration>>

/** How many `products_compared` events the digest lists, newest first. */
export const PRODUCTS_COMPARED_EVENTS = 2

/** A lead from the app, as data: no brackets, quotes or line breaks, and short. */
const asData = (text: string): string =>
  text
    .replace(/[\p{Cc}[\]()“”"<>{}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)

/**
 * The products selected on the cards with this message, in the order selected, one line each:
 * "bunq Savings Account [bunq:savings.bunq_savings]". The lead is the app's, read as data; the
 * id is held to `PRODUCT_ROW_ID_PATTERN` by the request schema. Pure.
 */
export function selectionLines(selection: SaoirseTurnRequest['selection']): string[] {
  return (selection ?? []).flatMap((item) => {
    const lead = asData(item.lead)
    return [lead.length === 0 ? `[${item.rowId}]` : `${lead} [${item.rowId}]`]
  })
}

/**
 * The aside a message with a selection carries (2026-11-13): what is selected, that "these"
 * means them, and that comparing them is `compare_products` with these ids in this order. Null
 * with nothing selected. Pure.
 */
export function selectionAside(lines: readonly string[]): string | null {
  if (lines.length === 0) return null
  const one = lines.length === 1
  return (
    `They have selected ${one ? 'one product' : `${String(lines.length)} products`} on the cards, ` +
    `in this order: ${lines.join('; ')}. "These", "them", "the two" or "this one" in their ` +
    `message means ${one ? 'it' : 'these'}.` +
    (one
      ? ' A comparison needs two or three: asked to compare, say so in a line.'
      : ' Asked to compare them, or for help choosing between them, call compare_products with ' +
        'these ids, in this order.')
  )
}

/**
 * What `compare_products` set side by side in earlier turns, newest first, one line each:
 * "bunq Savings Account against Bank of Ireland SuperSaver Account [bunq:savings.bunq_savings,
 * boi:savings.supersaver]". No figures. Pure.
 */
export function productsComparedLines(events: readonly { readonly payload: unknown }[]): string[] {
  return events.flatMap(({ payload }) => {
    if (typeof payload !== 'object' || payload === null) return []
    const { rowIds, leads } = payload as { rowIds?: unknown; leads?: unknown }
    if (!Array.isArray(rowIds)) return []
    const ids = (rowIds as unknown[]).filter((id): id is string => typeof id === 'string')
    if (ids.length === 0) return []
    const names = Array.isArray(leads)
      ? (leads as unknown[]).filter((lead): lead is string => typeof lead === 'string')
      : []
    return [
      `${names.length === ids.length ? names.join(' against ') : 'Products'} [${ids.join(', ')}]`,
    ]
  })
}

/** How many `products_shown` events are read for the figure basis, newest first. */
export const PRODUCTS_BASIS_EVENTS = 10

/** How many `products_looked_up` events the digest lists, newest first. */
export const PRODUCTS_LOOKED_UP_EVENTS = 4

/**
 * What `lookup_products` was asked in earlier turns, newest first, one line each: the query and
 * what it found by name and id ("“AIB 24 month fixed”: AIB Personal Fixed Term Deposit
 * [aib:deposit.ladder_personal_fixed_term_deposit]"), or that it found nothing. No figures. Pure.
 */
export function productsLookedUpLines(events: readonly { readonly payload: unknown }[]): string[] {
  return events.flatMap(({ payload }) => {
    if (typeof payload !== 'object' || payload === null) return []
    const { query, ids, names } = payload as { query?: unknown; ids?: unknown; names?: unknown }
    if (typeof query !== 'string' || !Array.isArray(ids)) return []
    const found = (ids as unknown[]).flatMap((id, index) => {
      if (typeof id !== 'string') return []
      const name = Array.isArray(names) ? (names as unknown[])[index] : undefined
      return [typeof name === 'string' ? `${name} [${id}]` : `[${id}]`]
    })
    return [`“${query}”: ${found.length === 0 ? 'nothing found' : found.join('; ')}`]
  })
}

/**
 * The must-knows of the products the customer has asked about by name, one line a product,
 * newest card first: the ids `products_looked_up` found, matched to the rows' `mustKnow` that
 * `products_shown` recorded (2026-11-13). A product on no card, or with nothing to know, has no
 * line. Pure.
 */
export function productsMustKnowLines(
  shown: readonly { readonly payload: unknown }[],
  lookedUp: readonly { readonly payload: unknown }[],
): string[] {
  const asked = new Set(
    lookedUp.flatMap(({ payload }) => {
      if (typeof payload !== 'object' || payload === null) return []
      const { ids } = payload as { ids?: unknown }
      return Array.isArray(ids) ? (ids as unknown[]).filter((id) => typeof id === 'string') : []
    }),
  )
  const lines = new Map<string, string>()
  for (const { payload } of shown) {
    if (typeof payload !== 'object' || payload === null) continue
    const { mustKnow } = payload as { mustKnow?: unknown }
    if (!Array.isArray(mustKnow)) continue
    for (const row of mustKnow as unknown[]) {
      if (typeof row !== 'object' || row === null) continue
      const { id, lead, facts } = row as { id?: unknown; lead?: unknown; facts?: unknown }
      if (typeof id !== 'string' || typeof lead !== 'string' || !Array.isArray(facts)) continue
      if (!asked.has(id) || lines.has(id)) continue
      const said = (facts as unknown[]).filter((fact) => typeof fact === 'string')
      if (said.length > 0) lines.set(id, `${lead} [${id}]: ${said.join('; ')}`)
    }
  }
  return [...lines.values()]
}

/**
 * The most recent cards whose rows' figure basis goes in the digest: one per arrangement and
 * focus (a card on the monthly saving is another card from one on the sum held).
 */
export const PRODUCTS_BASIS_CARDS = 2

/**
 * What each row's money figure counts on the most recent products cards, one line a row, read
 * from `products_shown` payloads (newest first): the newest card of each arrangement and focus,
 * at most `PRODUCTS_BASIS_CARDS` of them, so the digest stays short; a card on the monthly saving
 * says so ("fits_date, monthly saving"). Rows recorded without a lead or a line are left out.
 * Pure.
 */
export function productsBasisLines(events: readonly { readonly payload: unknown }[]): string[] {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const { payload } of events) {
    if (seen.size >= PRODUCTS_BASIS_CARDS) break
    if (typeof payload !== 'object' || payload === null) continue
    const { arrangement, figureBasis, focus } = payload as {
      arrangement?: unknown
      figureBasis?: unknown
      focus?: unknown
    }
    if (typeof arrangement !== 'string') continue
    const card = focus === 'monthly' ? `${arrangement}, monthly saving` : arrangement
    if (seen.has(card) || !Array.isArray(figureBasis)) continue
    seen.add(card)
    for (const row of figureBasis as unknown[]) {
      if (typeof row !== 'object' || row === null) continue
      const { lead, value, line } = row as { lead?: unknown; value?: unknown; line?: unknown }
      if (typeof lead !== 'string' || typeof line !== 'string') continue
      lines.push(`${lead}${typeof value === 'string' ? `, ${value}` : ''} (${card}): ${line}`)
    }
  }
  return lines
}

/**
 * The products cards shown so far, newest last, at most three: "Your account against the market
 * (held_vs_market; in groups: Yours, The market), your last reply". Pure.
 */
export function productsShownLines(messages: readonly LoadedMessage[]): string[] {
  const replies = messages.filter((message) => message.role === 'assistant')
  return replies
    .flatMap((message, index) =>
      (message.productsShown ?? []).map((shown) => {
        const ago = replies.length - index
        const groups =
          shown.groups === undefined || shown.groups.length === 0
            ? ''
            : `; in groups: ${shown.groups.join(', ')}`
        return `${shown.title} (${shown.kind}${groups}), ${ago === 1 ? 'your last reply' : `${String(ago)} replies ago`}`
      }),
    )
    .slice(-3)
}

/**
 * The first reply after a claim (2026-11-12, "3. Arrival"): the customer has seen the plan card
 * and Saoirse's first line, the question, and this is their reply. Answer it; no second
 * welcome, no card again, no second question.
 */
export const ARRIVAL_ANSWER_INSTRUCTION =
  'This is their reply to your first line, the question under the plan card. When it answers ' +
  'it, say what the answer changes in their figures, working out with the tools anything that ' +
  'needs working out; when it asks something else, answer that. Do not welcome them, introduce ' +
  'yourself, show or describe the plan card again or repeat your first line, and do not ask ' +
  'another question in this reply. It is a comparison, not advice: never pick a product, ' +
  'lender or option for them.'

/** What the customer did to the plan in the app: a figure edited, a product chosen or removed. */
const PLAN_CHANGES: ReadonlySet<string> = new Set([
  PLAN_EDITED_EVENT,
  PRODUCT_CHOSEN_EVENT,
  PRODUCT_CHOICE_REMOVED_EVENT,
])
const CHOICE_EVENTS: ReadonlySet<string> = new Set([
  PRODUCT_CHOSEN_EVENT,
  PRODUCT_CHOICE_REMOVED_EVENT,
])

/**
 * The return turn that follows a change to the plan in the app (2026-11-12, "6. The saving
 * months"; a product chosen or removed on a card, 2026-11-13): the customer typed nothing, and
 * the reply is text only. After the live run of PR #74, where it called `show_products` unasked
 * and put a card under its reply, the turn is offered no tool at all; products are shown when
 * their own next message asks for them.
 */
export function returnsAfterPlanEdit(
  trigger: string,
  events: readonly { readonly type: string }[],
): boolean {
  return trigger === 'return' && events.some((event) => PLAN_CHANGES.has(event.type))
}

/**
 * The return after a product was chosen or taken off the plan on a card (2026-11-13): one line
 * of fact in their name, then the next open part's deciding question, or, with every part
 * chosen, what the plan now does, once, and nothing asked. Text only. The question and the line
 * were worked out by the choice route from the stored plan (`next`, `allChosenLine`).
 */
export function choiceReturnInstruction(
  latest: { readonly type: string; readonly payload: Record<string, unknown> },
  others: boolean,
): string {
  const said = describeEvent(latest)
  const next = latest.payload['next']
  const question =
    typeof next === 'object' &&
    next !== null &&
    typeof (next as Record<string, unknown>)['question'] === 'string'
      ? String((next as Record<string, unknown>)['question'])
      : null
  const allChosen =
    typeof latest.payload['allChosenLine'] === 'string' ? latest.payload['allChosenLine'] : null
  const close =
    allChosen !== null
      ? `Then say once, in a sentence or two of your own, what the plan now does: "${allChosen}" ` +
        'Ask nothing after it.'
      : question !== null
        ? 'Then ask the next open part’s question, in these words or close to them, and ' +
          `nothing else: "${question}" It names no product: do not name one in it.`
        : 'Ask nothing after it.'
  return (
    '(The customer has just ' +
    (latest.type === PRODUCT_CHOSEN_EVENT ? 'chosen a product on a card' : 'taken a choice off') +
    ' for their plan, in the app, and come back to the conversation. ' +
    (said === null ? '' : `What they did: "${said}" `) +
    'Do not greet them or welcome them back, and do not call show_status. Say what they did in ' +
    'one line, as a fact in their name ("The €32,000 is down for the bunq Savings Account."). ' +
    'Never call the choice good, right, sensible or better than another, never say you chose ' +
    'it, and never pick anything for them. ' +
    (others ? 'Then name the other things under "Changed since they were last here". ' : '') +
    close +
    ' This reply is text only: do not call show_products or any other tool that shows a card.)'
  )
}

/**
 * What a return turn is told to do (§36). Ordinarily: name each thing under "Changed since they
 * were last here", then the status card. Right after a plan edit in the profile (2026-11-12,
 * "6. The saving months") the app has already shown the edit's `reading` as Saoirse's line, so
 * the turn builds on it: no greeting, not the same words again, no status card; what the change
 * means for the options they compare, which now fit and which no longer do, as facts in their
 * figures, never "better" and never a pick. Text only: no `show_products` and no other card,
 * as the customer asked for none (the turn is offered no tool either). It ends on nothing, like
 * every other return in a market conversation (2026-11-13), where a plan edit always is.
 */
export function returnInstruction(
  events: readonly { readonly type: string; readonly payload: Record<string, unknown> }[],
  options: {
    /**
     * A market conversation (2026-11-13): no `show_status` (it is not offered) and no question
     * put back to them; what changed, and nothing after it.
     */
    readonly market?: boolean
  } = {},
): string {
  const changes = events.filter((event) => PLAN_CHANGES.has(event.type))
  const lastChange = changes.at(-1)
  if (lastChange !== undefined && CHOICE_EVENTS.has(lastChange.type)) {
    return choiceReturnInstruction(
      lastChange,
      events.some((event) => !CHOICE_EVENTS.has(event.type) && isNarratable(event.type)),
    )
  }
  const edits = events.filter((event) => event.type === PLAN_EDITED_EVENT)
  const latest = edits.at(-1)
  if (latest === undefined && options.market === true) {
    return (
      '(The customer has just come back after being away. Open by naming each thing under ' +
      '"Changed since they were last here", in your own words and as facts. Ask nothing ' +
      'after it.)'
    )
  }
  if (latest === undefined) {
    return (
      '(The customer has just come back after being away. Open by naming each thing under ' +
      '"Changed since they were last here" — say what actually happened, in your own words, ' +
      'not that something "moved on". Then call show_status and ask what they want to deal ' +
      'with first. This is the one turn where a short list is right.)'
    )
  }
  const reading = typeof latest.payload['reading'] === 'string' ? latest.payload['reading'] : null
  const others = events.some(
    (event) => event.type !== PLAN_EDITED_EVENT && isNarratable(event.type),
  )
  return (
    '(The customer has just changed their plan in the app and come back to the conversation. ' +
    (reading === null ? '' : `The app has already shown them this line as yours: "${reading}" `) +
    'Do not greet them or welcome them back, do not say that line again in the same words, ' +
    'and do not call show_status. Build on it from "Changed since they were last here" and ' +
    'the plan lines in the digest, which are already the rebuilt plan: in a sentence or two, ' +
    'what the change means for the options they compare, in their order, which now fit and ' +
    'which no longer do, with their figures. Facts only: never call the change or an option ' +
    'better or worse, and never pick one for them. This reply is text only: do not call ' +
    'show_products or any other tool that shows a card, as they have not asked to see ' +
    'products; when their own next message asks for them, show them then. ' +
    (others ? 'Then name the other things under "Changed since they were last here". ' : '') +
    'End there: ask nothing after it, not even what they would like to look at next.)'
  )
}

/** How a conversation opened from a saved plan began, for the model, before Saoirse's first line. */
export const ARRIVAL_OPENED_NOTE =
  '(The customer opened, in this app, the comparison they saved in their own AI assistant. ' +
  'The plan card, with their figures, was on screen before your first line.)'

/**
 * The conversation as the model reads it: what was said, then this turn's message with any
 * asides for it. Pure, so the arrival's handling is tested without a database.
 *
 * A conversation opened from a saved plan starts with Saoirse's own message, written by the
 * claim (the card and the question), so the model is first told how it began and the history
 * starts on the customer's side. When the last thing said is that message, the customer's
 * message is their reply to the question (`answeringArrival`), and it carries the instruction
 * that keeps the turn to answering it.
 */
export function conversationSoFar(input: {
  readonly messages: readonly LoadedMessage[]
  readonly claimedPlans: readonly ClaimedPlan[]
  /** This turn's message, when the customer typed one; null for a tap or a return. */
  readonly customerMessage: string | null
  /** The sign-in aside, when the offer is about to appear under the reply. */
  readonly signIn: string | null
  /** The selection aside (`selectionAside`), when products are selected with this message. */
  readonly selection?: string | null
}): { history: { role: 'user' | 'assistant'; content: string }[]; answeringArrival: boolean } {
  const spoken = input.messages.filter((message) => message.role !== 'system')
  const history = spoken.map((message) => ({
    role: message.role === 'customer' ? ('user' as const) : ('assistant' as const),
    content: message.content,
  }))

  const first = spoken[0]
  if (
    first !== undefined &&
    first.role === 'assistant' &&
    input.claimedPlans.some((claimed) => arrivedWith(claimed, [first]))
  ) {
    history.unshift({ role: 'user', content: ARRIVAL_OPENED_NOTE })
  }

  const last = spoken.at(-1)
  const answeringArrival =
    input.customerMessage !== null &&
    last !== undefined &&
    input.claimedPlans.some((claimed) => arrivedWith(claimed, [last]))

  if (input.customerMessage !== null) {
    const asides = [
      ...(answeringArrival ? [ARRIVAL_ANSWER_INSTRUCTION] : []),
      ...(input.signIn === null ? [] : [input.signIn]),
      ...(input.selection === undefined || input.selection === null ? [] : [input.selection]),
    ]
    history.push({
      role: 'user',
      content:
        asides.length === 0
          ? input.customerMessage
          : `${input.customerMessage}\n\n(${asides.join(' ')})`,
    })
  }

  return { history, answeringArrival }
}
