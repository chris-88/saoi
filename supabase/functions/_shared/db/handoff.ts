import { factCatalogue } from '../domain/facts.ts'
import { journeyFor } from '../domain/journeys/index.ts'
import { stateLabel } from '../domain/state-machine.ts'
import { describeProjection } from '../domain/plans/engine.ts'
import { worthRaising, heldForLater } from '../domain/goals/engine.ts'
import { evaluateFor } from './applications.ts'
import type { GoalCandidate, GoalContext } from '../domain/goals/types.ts'
import type { NeedCandidate } from '../domain/needs/types.ts'
import type { LoadedCase } from './loaded-case.ts'
import type { LoadedPlan } from './plans.ts'

/**
 * The note a person reads before picking up the phone.
 *
 * Built from the case, never written by the model. A brief somebody is about to act on — move
 * an application, make a commitment, correct a figure — is the last place to put invented prose,
 * and everything worth telling them is already recorded: what the customer said they wanted,
 * what they agreed to, what they turned down, where each application has got to and what is
 * still outstanding. Composing it is arranging facts, not summarising them (Invariant 2).
 *
 * The ordering is the handover: who and what they want first, what has been agreed next, then
 * what is in flight, and the cautions last so they are the thing still in mind when the call
 * starts.
 */

export type HandoffSection = {
  readonly heading: string
  readonly lines: readonly string[]
  /** Something the person must not get wrong, rendered to stand out. */
  readonly caution?: boolean
}

export type HandoffNote = {
  readonly who: string
  /** How much of a conversation there has been, so the reader knows what to expect. */
  readonly turns: number
  readonly lastSeen: string | null
  readonly sections: readonly HandoffSection[]
}

const euro = (amount: number): string => `€${Math.round(amount).toLocaleString('en-IE')}`

const PROVENANCE: Record<string, string> = {
  customer_stated: 'they told us',
  partner_stated: 'their partner told us',
  bank_held: 'on file',
  document_extracted: 'from a document',
  document_verified: 'verified document',
  system_derived: 'worked out',
}

export function buildHandoffNote(input: {
  readonly loaded: LoadedCase
  readonly goals: readonly GoalCandidate[]
  readonly goalContext: GoalContext | null
  readonly needs: readonly NeedCandidate[]
  readonly plans: readonly LoadedPlan[]
}): HandoffNote {
  const { loaded, goals, needs, plans } = input
  const sections: HandoffSection[] = []

  // ---- What they are trying to do ----------------------------------------
  const leading = worthRaising(goals, 3)
  const objective = loaded.facts.find(
    (fact) => String(fact.key) === 'goals.primaryObjective' && fact.supersededBy === null,
  )

  const intent: string[] = []
  if (typeof objective?.value === 'string') intent.push(`In their words: "${objective.value}"`)

  for (const candidate of leading) {
    intent.push(
      `${candidate.goal.name} — ${candidate.tier === 'primary' ? 'what they came in about' : 'likely alongside'}` +
        ` (${candidate.confidence.toFixed(2)}, from ${candidate.evidence.map((item) => item.describe).join('; ')})`,
    )
  }

  if (intent.length === 0) intent.push('Nothing established yet. Ask what brought them in.')
  sections.push({ heading: 'What they are trying to do', lines: intent })

  // ---- Where they stand ---------------------------------------------------
  const position = loaded.facts
    .filter((fact) => fact.supersededBy === null)
    .filter((fact) => String(fact.key) !== 'goals.primaryObjective')
    .map((fact) => {
      const entry = factCatalogue[fact.key]
      const label = entry?.label ?? String(fact.key)
      const value =
        typeof fact.value === 'number'
          ? String(fact.key).match(/amount|balance|income|price|target|rent|repayment|cover/i)
            ? euro(fact.value)
            : String(fact.value)
          : typeof fact.value === 'boolean'
            ? fact.value
              ? 'yes'
              : 'no'
            : String(fact.value)

      return `${label}: ${value} (${PROVENANCE[fact.source] ?? fact.source})`
    })

  sections.push({
    heading: 'Where they stand',
    lines: position.length > 0 ? position : ['Nothing recorded yet.'],
  })

  // ---- What has been agreed ----------------------------------------------
  const agreed: string[] = []
  for (const { plan, progress } of plans) {
    if (plan.status === 'abandoned' || plan.status === 'archived') continue

    const projection = describeProjection(progress)
    agreed.push(
      `${plan.title} — ${plan.status}${plan.targetAmount === null ? '' : `, target ${euro(plan.targetAmount)}`}`,
    )
    if (projection !== null) agreed.push(`  ${projection}`)

    const done = plan.milestones.filter((milestone) => milestone.state === 'achieved')
    if (done.length > 0) {
      agreed.push(`  Done: ${done.map((milestone) => milestone.label).join('; ')}`)
    }
    if (progress.nextMilestone !== null) agreed.push(`  Next: ${progress.nextMilestone.label}`)
    if (progress.nextCheckin !== null) {
      agreed.push(
        `  Agreed check-in: ${progress.nextCheckin.purpose}` +
          (progress.nextCheckin.dueAt === null
            ? ` (when ${progress.nextCheckin.triggerEvent ?? 'something changes'})`
            : ` (${progress.nextCheckin.dueAt.slice(0, 10)})`),
      )
      for (const item of progress.nextCheckin.agenda) agreed.push(`    · ${item}`)
    }
  }

  if (agreed.length > 0) sections.push({ heading: 'What they have agreed to', lines: agreed })

  // ---- Applications -------------------------------------------------------
  const inFlight = loaded.applications.map((application) => {
    const journey = journeyFor(application.product)
    const { outstanding, waitingOn } = evaluateFor(loaded, application)
    const waiting =
      outstanding.length === 0
        ? 'nothing outstanding'
        : `${String(outstanding.length)} outstanding` +
          (waitingOn === null ? '' : `, with ${waitingOn}`) +
          `: ${outstanding
            .slice(0, 4)
            .map((item) => item.requirement.label)
            .join(', ')}`

    return `${journey.displayName} — ${stateLabel(application.state)} (${waiting})`
  })

  sections.push({
    heading: 'Applications',
    lines: inFlight.length > 0 ? inFlight : ['None started.'],
  })

  // ---- Needs --------------------------------------------------------------
  const established = needs
    .filter((candidate) => candidate.confidence > 0 && candidate.state !== 'latent')
    .sort((a, b) => b.confidence - a.confidence)
    .map(
      (candidate) =>
        `${candidate.need.name} — ${candidate.state.replaceAll('_', ' ')} (${candidate.confidence.toFixed(2)})` +
        (candidate.reason === null ? '' : `: ${candidate.reason}`),
    )

  if (established.length > 0) {
    sections.push({ heading: 'Needs identified', lines: established })
  }

  // ---- Cautions -----------------------------------------------------------
  const careful: string[] = []

  const declined = loaded.productInterests.filter((interest) => interest.status === 'declined')
  for (const interest of declined) {
    careful.push(
      `${journeyFor(interest.product).displayName}: they said no. Do not raise it again.`,
    )
  }

  for (const held of heldForLater(goals)) {
    careful.push(
      `${held.goal.name}: parked — ${held.reason}. Worth raising again when ${held.revisitWhen ?? 'things change'}.`,
    )
  }

  for (const candidate of needs.filter((item) => item.state === 'suppressed')) {
    careful.push(
      `${candidate.need.name}: deliberately not raised — ${candidate.reason ?? 'protected'}.`,
    )
  }

  if (loaded.authLevel !== 'authenticated') {
    careful.push('Not signed in. Nothing here has been checked against the bank record.')
  }

  careful.push('Everything in this case is synthetic. It is a prototype, not a customer.')
  sections.push({ heading: 'Before you call', lines: careful, caution: true })

  return {
    who: loaded.customerName ?? `Unnamed · ${loaded.caseId.slice(0, 8)}`,
    turns: loaded.messages.filter((message) => message.role === 'customer').length,
    lastSeen: loaded.lastSeenAt,
    sections,
  }
}

/** The same note as plain text, for pasting into whatever the adviser actually uses. */
export function handoffAsText(note: HandoffNote): string {
  const lines = [
    `Handover note — ${note.who}`,
    note.lastSeen === null ? '' : `Last spoke: ${note.lastSeen.slice(0, 16).replace('T', ' ')}`,
    '',
  ]

  for (const section of note.sections) {
    lines.push(section.heading.toUpperCase(), ...section.lines.map((line) => `  ${line}`), '')
  }

  return lines
    .filter((line, index) => line !== '' || index === 0 || lines[index - 1] !== '')
    .join('\n')
}
