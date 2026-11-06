/**
 * What the numbers on the analytics screen add up to (§9, the insights panel).
 *
 * Deterministic rules over counts, in the same spirit as `advisories.ts`: no model, no judgement,
 * nothing that cannot be checked against the figures beside it. An insight here is a restatement
 * of what is already on screen — "five goals discovered, none became an application" — not an
 * inference about why.
 *
 * That restriction is the point. A panel that speculates is a panel somebody has to fact-check,
 * and a console whose headline claim is that the engine is deterministic cannot have one corner
 * of it guessing.
 */

export type InsightTone = 'good' | 'watch' | 'neutral'

export type Insight = {
  readonly id: string
  readonly tone: InsightTone
  readonly text: string
}

export type InsightInput = {
  readonly conversations: number
  readonly goals: number
  readonly applications: number
  readonly blocked: number
  /** Conversations by outcome, as the analytics response carries them. */
  readonly outcomes: readonly { readonly outcome: string; readonly count: number }[]
  /** Discovered goals, most frequent first. */
  readonly topGoals: readonly { readonly name: string; readonly count: number }[]
  readonly funnel: readonly { readonly stage: string; readonly count: number }[]
}

const percent = (part: number, whole: number): number => Math.round((part / whole) * 100)

/**
 * Up to four, most useful first.
 *
 * Capped because a list of nine observations is a wall nobody reads, and ordered so the one
 * worth acting on is not below the one that is merely true.
 */
export function insightsFor(input: InsightInput): readonly Insight[] {
  const found: Insight[] = []

  // Nothing to say about nothing. An empty window gets an empty panel, not a reassurance.
  if (input.conversations === 0) return []

  const outcome = (id: string): number =>
    input.outcomes.find((entry) => entry.outcome === id)?.count ?? 0

  const stage = (id: string): number => input.funnel.find((entry) => entry.stage === id)?.count ?? 0

  if (input.blocked > 0) {
    found.push({
      id: 'blocked',
      tone: 'watch',
      text: `${String(input.blocked)} ${input.blocked === 1 ? 'request was' : 'requests were'} turned away at the gate. None of them reached a model.`,
    })
  }

  const reached = outcome('explored') + outcome('planned') + outcome('applied')
  if (reached > 0) {
    found.push({
      id: 'discovery',
      tone: 'good',
      text: `Saoirse established what ${percent(reached, input.conversations)}% of people were after, rather than waiting to be told which product they wanted.`,
    })
  }

  // The gap the whole product exists to close: understood, and then nothing happened.
  if (input.goals > 0 && input.applications === 0) {
    found.push({
      id: 'no_applications',
      tone: 'watch',
      text: `${String(input.goals)} ${input.goals === 1 ? 'goal was' : 'goals were'} discovered and nothing was applied for. Discovery is working; conversion is not being tested.`,
    })
  }

  const started = stage('started')
  const submitted = stage('submitted')
  if (started > 0 && submitted > 0 && submitted < started) {
    found.push({
      id: 'funnel_drop',
      tone: 'watch',
      text: `${String(started - submitted)} of ${String(started)} applications have not been submitted yet.`,
    })
  }

  const breadth = input.goals / input.conversations
  if (breadth >= 2) {
    found.push({
      id: 'breadth',
      tone: 'good',
      text: `An average of ${breadth.toFixed(1)} goals a conversation — people are arriving with one thing in mind and leaving with a wider picture.`,
    })
  }

  const top = input.topGoals[0]
  if (top !== undefined && input.goals > 0 && top.count > 1) {
    found.push({
      id: 'top_goal',
      tone: 'neutral',
      text: `“${top.name}” came up most often, in ${String(top.count)} conversations.`,
    })
  }

  return found.slice(0, 4)
}
