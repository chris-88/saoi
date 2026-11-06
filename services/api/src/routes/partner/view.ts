import type { PartnerTask, PartnerView } from '@shared/contracts/partner.ts'
import { factCatalogue } from '@shared/domain/facts.ts'
import { journeyFor } from '@shared/domain/journeys/index.ts'
import { stateLabel } from '@shared/domain/state-machine.ts'
import { applicationName, evaluateFor } from '@shared/db/applications.ts'
import type { LoadedCase } from '@shared/db/loaded-case.ts'

/** Prettifies a catalogue enum value for a human: `employed_full_time` → `Employed full time`. */
function prettify(value: string): string {
  const spaced = value.replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Every partner requirement, grouped so one answer covers every application that needs it.
 * The grouping key is the fact itself, which is exactly why answering once is enough.
 *
 * Satisfied requirements are included and marked done rather than dropped, so the partner can
 * see what they have already finished instead of watching rows disappear.
 */
export function buildTasks(loaded: LoadedCase, partnerId: string): readonly PartnerTask[] {
  const byKey = new Map<string, PartnerTask>()

  for (const application of loaded.applications) {
    // The name the primary chose it by, so a task applies to "SuperSaver" and not to one of
    // three things called "Savings account".
    const name = applicationName(application)
    const evaluation = evaluateFor(loaded, application)

    const items = [
      ...evaluation.outstanding
        .filter((item) => item.blocking && item.waitingOn === 'partner')
        .map((item) => ({ requirement: item.requirement, done: false })),
      ...evaluation.satisfied
        .filter((item) => item.requirement.subject === 'partner')
        .map((item) => ({ requirement: item.requirement, done: true })),
    ]

    for (const entry of items) {
      const requirement = entry.requirement
      const key = requirement.kind === 'fact' ? `fact:${requirement.fact}` : `req:${requirement.id}`

      const existing = byKey.get(key)
      if (existing) {
        byKey.set(key, {
          ...existing,
          appliesTo: existing.appliesTo.includes(name)
            ? existing.appliesTo
            : [...existing.appliesTo, name],
          done: existing.done || entry.done,
        })
        continue
      }

      // Enum facts become a chooser. Asking a person to type `employed_full_time` is how a
      // form ends up rejecting perfectly reasonable answers.
      const schema =
        requirement.kind === 'fact'
          ? (factCatalogue[requirement.fact].schema as {
              _def?: { type?: string; entries?: Record<string, string> }
            })
          : undefined

      const enumValues =
        schema?._def?.type === 'enum' ? Object.values(schema._def.entries ?? {}) : []

      const inputKind = ((): PartnerTask['inputKind'] => {
        if (requirement.kind !== 'fact') return 'none'
        if (enumValues.length > 0) return 'select'
        if (schema?._def?.type === 'boolean') return 'boolean'
        if (schema?._def?.type === 'number') return 'number'
        if (requirement.fact.includes('dateOf') || requirement.fact.includes('startDate')) {
          return 'date'
        }
        return 'text'
      })()

      byKey.set(key, {
        id: key,
        kind:
          requirement.kind === 'fact'
            ? 'fact'
            : requirement.kind === 'document'
              ? 'document'
              : 'declaration',
        // Said to the partner directly, so the primary's phrasing ("your partner's…") is wrong.
        label: requirement.label
          .replace(/^Your partner['’]s /i, 'Your ')
          .replace(/^Does your partner /i, 'Do you '),
        inputKind,
        ...(enumValues.length > 0
          ? { options: enumValues.map((value) => ({ value, label: prettify(value) })) }
          : {}),
        appliesTo: [name],
        done: entry.done,
      })
    }
  }

  // A fact the partner has given is done even if the journey still wants it confirmed.
  for (const fact of loaded.facts) {
    if (String(fact.subject) !== partnerId || fact.supersededBy !== null) continue
    const existing = byKey.get(`fact:${fact.key}`)
    if (existing) byKey.set(`fact:${fact.key}`, { ...existing, done: true })
  }

  // Outstanding first: the partner should open this and see what is left, not scroll past
  // what they have finished.
  return [...byKey.values()].sort((a, b) => Number(a.done) - Number(b.done))
}

/**
 * The partner's whole screen. Names and states only: never the primary's facts, and never
 * their conversation (§33).
 */
export function buildView(
  loaded: LoadedCase,
  partner: { participantId: string; displayName: string | null },
): PartnerView {
  const primary = loaded.participants.find((participant) => participant.role === 'primary')
  return {
    partnerName: partner.displayName,
    invitedBy: primary?.displayName ?? null,
    applications: loaded.applications
      .filter((application) => journeyFor(application.product).supportsPartner)
      .map((application) => ({
        displayName: applicationName(application),
        stateLabel: stateLabel(application.state),
        waitingOnYou: evaluateFor(loaded, application).waitingOn === 'partner',
      })),
    tasks: [...buildTasks(loaded, partner.participantId)],
  }
}
