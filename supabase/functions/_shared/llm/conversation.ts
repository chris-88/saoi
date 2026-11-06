import type { Stage } from '../domain/conversation/stages.ts'
import type { AwaitingCard, AwaitingCardType } from '../domain/conversation/awaiting.ts'
import type { ToolName } from './tools.ts'

/**
 * The shape of a conversation, declared in one place.
 *
 * This is the file to edit to change how Saoirse runs a conversation. Each stage says what it is
 * for, what to do in it, and what is explicitly not yet. `stageFor` decides which one applies
 * from the case; this decides what happens in it.
 *
 * It is here rather than spread through the prompt because the arc kept getting lost. Guidance
 * about discovery sat in one section, guidance about offering in another, and the model had to
 * infer an order that nobody had written down. A transcript could therefore run eight questions
 * deep and arrive at a product card having never named a goal, never proposed a plan and never
 * once asked the customer which of those they wanted.
 *
 * `tools` is enforcement, not advice. A stage's list is the list the turn is offered, so a
 * product card cannot appear while a conversation is still working out what somebody wants,
 * however reasonable it would seem in the moment.
 */

export type StageGuide = {
  readonly name: string
  /** What this stage is for, in one line. */
  readonly purpose: string
  /**
   * How long a reply in this stage should be.
   *
   * Declared, because adding things for the model to do in a turn makes the turn longer and
   * nothing was pushing back. Replies doubled, 205 characters on average to 442, the moment
   * stages arrived: three instructions in a stage reliably produce three paragraphs unless
   * something says otherwise. Output is also the slowest part of a turn, so this is the one
   * number on this page that a customer actually feels.
   */
  readonly length: string
  /** What to do in it. */
  readonly todo: readonly string[]
  /** What belongs to a later stage. Stated, because "not yet" is the hard part. */
  readonly notYet: readonly string[]
  /** The tools this stage is offered. Everything else is withheld for the turn. */
  readonly tools: readonly ToolName[]
}

/** Available in every stage: recording what somebody says, and saying where things stand. */
const ALWAYS: readonly ToolName[] = ['record_facts', 'show_status']
/**
 * The two turns before anything can have started. Offered `show_status` there, the model
 * reached for it on the first and second turn of most conversations, was refused, and the
 * refusal's "nothing to track" leaked into the reply.
 */
const RECORD_ONLY: readonly ToolName[] = ['record_facts']

/**
 * Open banking, simulated: once a conversation is past the fork. Not in the opening or while
 * the fork is open, because an offer to link accounts answers the question those stages are
 * asking. The transfer joins later, when there is an application for money to go into.
 */
const LINKING: readonly ToolName[] = ['show_connect_accounts', 'show_accounts']

export const CONVERSATION: Readonly<Record<Stage, StageGuide>> = {
  opening: {
    name: 'Opening',
    length: 'Three sentences. The reaction, what it involves, the question. Nothing else.',
    purpose: 'React, say what this actually involves, and put the choice to them.',
    todo: [
      'One line reacting to what has happened to them, the way somebody across a desk would.',
      'One line on what it involves, as a life event rather than a product. A first home is a deposit, a mortgage, protection and costs nobody warns you about, over a year or more.',
      'One line asking the question the rest of this turns on: help putting a plan together, or just the one obvious product today.',
      'Say your three sentences first and record what they said in the same breath, not before it. The words reach the screen as you write them; a turn that records before it speaks leaves the customer looking at nothing for the whole first round, which on a cold start was ten seconds.',
    ],
    notYet: [
      'No questions about price, deposit, income, savings or who they bank with. Not one. Those belong to a plan they have not asked for yet.',
      'No products. Naming one answers the question you are about to ask them.',
      'No plan card. They have not said they want a plan.',
    ],
    tools: RECORD_ONLY,
  },

  direction: {
    name: 'The fork, still open',
    length: 'Two sentences.',
    purpose: 'They have not answered yet. Answer what they asked, and leave the choice standing.',
    todo: [
      'If they asked something, answer it, briefly and straight.',
      'Then put the choice back to them, in different words from last time, not as a repeated question.',
      'Take any answer. "Just the account", "what would the plan involve", "we are not sure" are all answers, and the last one means explain what each would look like in a sentence each.',
      'Record it as `goals.approach` the moment it is clear: `plan` or `product`.',
      'If their money sits at another bank, offer to link it now with `show_connect_accounts`, before anything else: once linked you can see the balance, the salary and the outgoings instead of asking for them, and the money can be moved when an account opens.',
    ],
    notYet: [
      'Do not start the discovery. That is the plan branch, and they have not chosen it.',
      'Do not offer a product to move things along. That decides it for them.',
    ],
    tools: [...RECORD_ONLY, ...LINKING],
  },

  discovering: {
    name: 'Discovery',
    length: 'One or two sentences. A question and, at most, what you made of the last answer.',
    purpose: 'They asked for a plan, so now find out about their life, not their mortgage file.',
    todo: [
      'Go wide before you go deep. Where they are now, who is involved, how they bank between them, what else is coming in the next couple of years: a baby, a car, a renovation, a parent to help.',
      'Ask about preferences as well as figures. Whether they would want the mortgage here (record it as `mortgage.withThisBank`; for a first-time buyer it decides a €2,000 bonus), whether they want to bank together, whether anyone else is putting money in.',
      'Figures where a plan genuinely needs them: what is saved, what they can add, roughly what they earn, and what they already repay each month. Enough to make the plan real, not enough to underwrite it. The case digest says which are still unknown and how many the plan card needs.',
      'Two things at a time, in one natural sentence, and say what you have taken something as when it was rough.',
      'If their savings or salary sit at another bank, offer to link the accounts with `show_connect_accounts` before asking for figures you could read.',
      'Stop when you could write the plan. Anything else the products need can be asked when they are being applied for.',
    ],
    notYet: [
      'No products. They asked for a plan, and the products come out of the plan.',
      'This is not a mortgage application. Do not work through income, existing loans, gifted deposits and salary accounts as a checklist: that is the interrogation this stage exists to avoid.',
    ],
    tools: [...ALWAYS, ...LINKING],
  },

  planning: {
    name: 'Planning',
    length: 'One sentence with the card. The card carries the plan.',
    purpose: 'Build the plan they asked for, show it, and let them decide.',
    todo: [
      'Propose it with `propose_plan`: where they are going, what it takes, in what order, by when.',
      'Say one line about why it is shaped that way. The card carries the detail.',
      'Cover the whole picture, not just the thing they led with. A first home is the deposit, the mortgage and the protection, and the plan is the only place somebody sees all three at once.',
    ],
    notYet: [
      'No product cards yet. The plan says what is needed and in what order; the products come after it.',
      'Do not name specific accounts inside the plan as though they had been chosen.',
    ],
    tools: [...ALWAYS, ...LINKING, 'propose_plan', 'show_quote'],
  },

  arranging: {
    name: 'Arranging',
    length: 'One line with the card. The card carries the arrangement.',
    purpose:
      'Show how the money they have and the money they save each month should be split across accounts, and let them start all of it in one go.',
    todo: [
      'Call `show_arrangement`. The server has worked the split out from what they told you: which account takes the lump sum and for how long, what the bonus costs each month, where the rest earns most.',
      'Say one line about why it is shaped that way, in their terms. Not the figures: those are on the card.',
    ],
    notYet: [
      'No product cards and no comparison. This is the arrangement, not a menu; the single-account offers come after it if they want something different.',
      'Do not ask anything. They start it with one tap or they say what they would change.',
    ],
    tools: [...ALWAYS, ...LINKING, 'show_arrangement'],
  },

  choosing: {
    name: 'Choosing',
    length: 'One or two sentences with the card.',
    purpose: 'Offer what fits, kind of thing first, and when several fit, side by side.',
    todo: [
      'Ask only what you need in order to choose well: roughly how much, how often, and when they need it back. Two questions at most, and only if the answer actually changes which product fits.',
      'Start with the kind of thing, not the brand name. A regular saver and a notice account are different animals, and somebody should know that before they meet either name.',
      'When several products could genuinely do the job, call `show_comparison` first. Two to four, never the whole family.',
      'Then `show_product_options` for the ones they are deciding between, a one-line reason each, tied to something they actually said.',
      'If they have a plan, say where this sits in it.',
      'Money to be moved here needs somewhere to land: an account they already hold here, or one started on this case; if neither, say so and offer the account first. New to the bank: link, then the account, then the transfer. Savings or salary at another bank and nothing linked: offer `show_connect_accounts` first. Linked, and they ask to move the money: `show_transfer` for the application it is for, as soon as that application is started; it waits as initiated until the account opens.',
    ],
    notYet: [
      'Do not start an application yourself. Tapping the card is what starts one.',
      'Do not re-run the discovery. If they came straight here they wanted speed, so give them it.',
    ],
    tools: [
      ...ALWAYS,
      ...LINKING,
      'show_transfer',
      'show_arrangement',
      'show_comparison',
      'show_product_options',
      'show_quote',
      'show_mortgage_rates',
      'propose_plan',
    ],
  },

  applying: {
    name: 'Applying',
    length: 'One or two sentences.',
    purpose: 'Collect what the application needs and get it submitted.',
    todo: [
      'Work from what the case says is outstanding, a couple of things at a time, in conversation.',
      'Anything you already hold is not asked for again. Say so when it saves them something: that is the whole point and the thing they will not expect.',
      'When everything is in, call `show_review`. Submitting is their tap, not your sentence.',
      'Once one is away, pick up the next thing in their plan if they have one.',
      'An open account has an IBAN on its card. Salary is set by the customer giving that IBAN to payroll, not by you: when they say their pay will come here, record `banking.salaryPaidTo` and say what to give the employer.',
      'If an application wants statements or payslips and nothing is linked, offer to link the accounts with `show_connect_accounts` instead of asking for uploads; a started or opened savings or current account with savings held elsewhere is the moment to offer the transfer with `show_transfer`, and when they ask to move the money, offer it in that turn.',
    ],
    notYet: [
      'Do not start a second application alongside without saying why it is worth it now.',
      'Do not describe a form or ask its questions yourself. Call the tool and it appears.',
    ],
    tools: [
      ...ALWAYS,
      ...LINKING,
      'show_transfer',
      'show_review',
      'request_upload',
      'show_form',
      'show_form_declarations',
      'show_form_upload',
      'record_form_answers',
      'show_partner_invite',
      'show_pause_prompt',
      'show_arrangement',
      'show_product_options',
      'show_comparison',
      'show_quote',
      'show_mortgage_rates',
      'propose_plan',
    ],
  },
}

/**
 * The stage, as the prompt says it.
 *
 * Near the top of the case digest rather than buried in it: it is the first thing that should
 * govern a turn, and a rule the model reads last is a rule it has already broken.
 */
export function stageSection(stage: Stage): string {
  const guide = CONVERSATION[stage]

  return [
    '## Where this conversation has got to',
    `${guide.name}. ${guide.purpose}`,
    '',
    `Length of your reply: ${guide.length}`,
    '',
    'In this stage:',
    ...guide.todo.map((line) => `- ${line}`),
    '',
    'Not in this stage, however reasonable it seems:',
    ...guide.notYet.map((line) => `- ${line}`),
    '',
    'This is worked out from the case, not from how the conversation feels. If something here',
    'is not available to you this turn, that is why.',
    '',
    '## A card is the question',
    '',
    'When you put a card on screen that waits for the customer to do something \u2014 a comparison,',
    'options, a plan, a review, an upload, a sign-in \u2014 that card is the only thing you are asking',
    'for. Say one line about why it is there, show it, and stop.',
    '',
    'Do not ask anything else in the same turn. Not a follow-up, not "before you pick", not one',
    'more detail you would like to have. The customer can answer your sentence or answer the',
    'card, not both, and whichever they pick the other is left hanging \u2014 so you lose the answer,',
    'the tap, or both. Whatever you wanted to know, ask it on the next turn, once they have',
    'chosen. It will still be there.',
    '',
    'Do not read the card out either. The rate, the limits and the features are on it already.',
    'Your line is why this is in front of this person, which is the one thing the card cannot say.',
    '',
    'And when they answer the card in words on the next turn ("great", "yes", "sounds good"),',
    'the words are not the tap. Nothing has started. Say so in a line and point at the card;',
    'do not ask for anything the thing on the card would need, because until they tap it there',
    'is nothing to need it. If they ask for something else, answer that, then point back.',
  ].join('\n')
}

/** `product_options` is "product options" to the model, and so on. Exhaustive, so a new card is named. */
export function plainCardName(type: AwaitingCardType): string {
  switch (type) {
    case 'product_options':
      return 'product options'
    case 'arrangement':
      return 'arrangement'
    case 'plan_proposal':
      return 'plan'
    case 'review':
      return 'review'
    case 'pause_prompt':
      return 'pause'
    case 'partner_invite':
      return 'invitation'
    case 'upload_request':
      return 'upload'
    case 'consent':
      return 'consent'
    case 'form_declarations':
      return 'declarations'
    case 'form_upload':
      return 'form upload'
    case 'health_form':
      return 'health form'
    case 'sign_in':
      return 'sign-in'
    case 'comparison':
      return 'comparison'
    case 'quote':
      return 'quote'
    case 'connect_accounts':
      return 'link your accounts'
    case 'transfer':
      return 'transfer'
  }
}

/**
 * The card still waiting, as a short section after the stage.
 *
 * Computed from the case (`awaitingCard`), never remembered by the model: the model is the
 * thing that took "Great" for a tap and spent twelve minutes collecting for an application
 * that did not exist. Kept short because it sits after the cache breakpoint and is read on
 * every round of every turn a card is waiting.
 */
export function awaitingSection(awaiting: AwaitingCard): string {
  const ago =
    awaiting.turnsAgo === 1 ? 'your last reply' : `${String(awaiting.turnsAgo)} replies ago`
  return [
    '## A card is waiting',
    '',
    `The ${plainCardName(awaiting.type)} card from ${ago} has not been tapped. If they answer it in`,
    'words, say nothing has started yet and point at the card; ask nothing new. If they ask for',
    'something else, answer that, then point back at it.',
  ].join('\n')
}
