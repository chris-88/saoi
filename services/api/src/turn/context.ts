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
import { participantFor, type LoadedCase } from '@shared/db/loaded-case.ts'

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

  const digest = buildCaseDigest(loaded, {
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
  const offeringSignIn =
    !(await caseHasEvent(admin, turn.caseId, SIGN_IN_PROMPT_EVENT)) && worthSigningInFor(loaded)

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

  const history = loaded.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'customer' ? ('user' as const) : ('assistant' as const),
      content: message.content,
    }))

  if (isCustomerTurn) {
    history.push({
      role: 'user',
      content: offeringSignIn
        ? `${customerMessage}\n\n(${SIGN_IN_INSTRUCTION.trim()})`
        : customerMessage,
    })
  }

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

  if (turn.trigger === 'return') {
    // §36 — the customer did not ask anything; they came back. Lead with what changed.
    history.push({
      role: 'user',
      content:
        '(The customer has just come back after being away. Open by naming each thing under ' +
        '"Changed since they were last here" — say what actually happened, in your own words, ' +
        'not that something "moved on". Then call show_status and ask what they want to deal ' +
        'with first. This is the one turn where a short list is right.)',
    })
  }

  if (history.length === 0) {
    history.push({
      role: 'user',
      content: '(The customer has just arrived. Open the conversation.)',
    })
  }

  return {
    primary,
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
