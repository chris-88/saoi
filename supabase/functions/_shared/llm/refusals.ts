import type { DomainCategoryId } from '../tenants/demo/domain-config.ts'

/**
 * §26, off-domain responses.
 *
 * Short, and they never contain the prohibited answer. The pattern the specification
 * explicitly rules out is answering the question and appending a banking disclaimer
 * afterwards, so none of these acknowledge the content of the request at all.
 *
 * These are canned strings, not model output: a blocked turn never reaches the model
 * (Invariant 4), so there is nothing to generate the reply with.
 */

/** Persona collapses to one of three buckets for refusal wording (§17, §26). */
export const TONE_BUCKETS = ['formal', 'neutral', 'playful'] as const
export type ToneBucket = (typeof TONE_BUCKETS)[number]

/** Reasons a turn can be refused that are not a domain category. */
export type RefusalReason =
  | DomainCategoryId
  | 'empty'
  | 'too_long'
  | 'classifier_unavailable'
  /**
   * The API allowance is gone, as opposed to something having gone wrong.
   *
   * Separate from `classifier_unavailable` because the advice is the opposite. A timeout or a
   * bad response is worth retrying and usually works second time; a spend limit is not, and
   * "try that again?" sends somebody round a loop that cannot end. A real customer sat in front
   * of this and tried again, because that is what it told them to do.
   */
  | 'allowance_reached'
  | 'demo_paused'

type RefusalSet = Readonly<Record<ToneBucket, string>>

const REFUSALS: Readonly<Record<RefusalReason, RefusalSet>> = {
  general_knowledge: {
    formal:
      'That falls outside what I can assist with. I can help with your Demo Bank accounts, products and applications.',
    neutral:
      'That one is outside my remit. I can help with your Demo Bank accounts, products and applications though.',
    playful: 'Wildly outside my job description. Banking, on the other hand, I can do.',
  },
  competitor: {
    formal:
      'I am not able to comment on other providers. I can explain Demo Bank products and how they relate to your circumstances.',
    neutral:
      'I cannot really comment on other banks. I can walk you through our own options and how they fit what you are trying to do.',
    playful:
      'I am not going to review the competition. I can tell you about ours, though, and what would actually suit you.',
  },
  off_topic: {
    formal: 'That is outside the scope of what I can assist with. I can help with your banking.',
    neutral: 'Not something I can help with. Banking I can do.',
    playful: 'Tempting, but no. Banking is where I earn my keep.',
  },
  abusive: {
    formal: 'I am happy to continue if there is something about your banking I can help with.',
    neutral:
      'I will leave that there. If there is something about your banking I can help with, I am listening.',
    playful: 'Noted. If there is an actual banking question in there, I am all ears.',
  },
  prompt_injection: {
    formal:
      'I am Demo Bank’s banking assistant and that is the role I will be staying in. I can help with your accounts, products and applications.',
    neutral:
      'I am going to stay as I am. I can help with your accounts, products and applications.',
    playful: 'Good try. Still a banking assistant. What can I help you with?',
  },
  unsupported: {
    formal:
      'That is not something this service can do. I can help with your products, applications and what they require.',
    neutral:
      'I cannot do that one here. I can help with your products, applications and what they need.',
    playful: 'Outside what I can actually do. Products and applications, though, I am all over.',
  },
  // Reached the gate but is not a classification outcome.
  empty: {
    formal: 'I did not receive anything. Please tell me what you would like help with.',
    neutral: 'I did not catch that. What would you like help with?',
    playful: 'Nothing came through. What are you after?',
  },
  too_long: {
    formal: 'That message is longer than I can process. Please send a shorter version.',
    neutral: 'That is a bit long for me. Could you send a shorter version?',
    playful: 'That is a lot in one go. Give me the short version?',
  },
  classifier_unavailable: {
    formal: 'I was unable to process that request. Please try again.',
    neutral: 'Something went wrong on my side. Try that again?',
    playful: 'That one tripped me up. Try again?',
  },
  allowance_reached: {
    formal:
      'Saoirse is unavailable. This prototype has reached the usage limit set for it, so trying ' +
      'again will not help.',
    neutral:
      'Saoirse is out of action for now. The prototype has reached the usage limit set for it, so ' +
      'trying again will not help, I am afraid.',
    playful:
      'I am out of credit, genuinely. Trying again will not fix it, which is the annoying part.',
  },
  demo_paused: {
    formal: 'This demonstration is currently paused.',
    neutral: 'The demo is paused at the moment.',
    playful: 'We are on a break. The demo is paused.',
  },
  // Categories that reach the model never produce a refusal, but the record is exhaustive
  // so adding a category forces a decision here.
  banking: {
    formal: 'I can help with that.',
    neutral: 'I can help with that.',
    playful: 'I can help with that.',
  },
  ambiguous: {
    formal: 'Could you tell me a little more about what you need?',
    neutral: 'Can you tell me a bit more about what you need?',
    playful: 'Say a bit more and I will see what I can do.',
  },
}

export function refusalFor(reason: RefusalReason, tone: ToneBucket = 'neutral'): string {
  return REFUSALS[reason][tone]
}

/** Every refusal string, for the guardrail evals and the admin domain view. */
export function allRefusals(): readonly string[] {
  return Object.values(REFUSALS).flatMap((set) => Object.values(set))
}
