import type { Card } from '../contracts/cards.ts'

/**
 * The data-protection notice, as a card.
 *
 * Fixed copy, built here, shown by the server the first time a fact is written for a case. Not
 * a tool, so the model cannot summon it, skip it, paraphrase it or argue with somebody about
 * it, which is the whole reason it is not a tool.
 *
 * Timing is the point. At the start of a conversation it is a wall of text before anybody has
 * said anything, which the opening screen deliberately avoids; at the end it is too late. The
 * moment Saoirse first writes something down is when it becomes true and when it is worth reading.
 */
export const DATA_NOTICE_EVENT = 'data_notice_shown'

export function dataNoticeCard(noticeHref: string): Card {
  return {
    type: 'data_notice',
    title: "I'm keeping notes as we talk",
    points: [
      'What you tell me is stored, so I do not have to ask you twice. That is the part being demonstrated.',
      'This is a prototype, not a banking service, and nothing here reaches a bank.',
      'Please leave out anything you would mind being kept, a real PPS number, real account details.',
    ],
    noticeHref,
  }
}
