import type { LoadedCase } from './loaded-case.ts'
import type { CaseDigest } from '../llm/prompt.ts'
import { factCatalogue, isFactKey } from '../domain/facts.ts'
import { journeyFor } from '../domain/journeys/index.ts'
import { stateLabel } from '../domain/state-machine.ts'
import { applicationName, evaluateFor } from './applications.ts'

/**
 * What Saoirse is allowed to know while it is talking to the partner (§33, Invariant 7).
 *
 * Built by selection, never by subtraction. It starts from nothing and adds only what belongs
 * to this participant, so a field added to the case later cannot leak by being forgotten
 * about here. Taking the primary's digest and removing the private parts is the obvious
 * alternative and it is one missed property away from telling somebody what their partner
 * earns.
 *
 * What a partner may see:
 *
 *   - facts whose subject is them, and household facts, which are theirs by definition
 *   - the names and states of applications their journey actually involves them in
 *   - what is outstanding *from them*
 *
 * Everything else is absent and stays absent: the primary's facts, the primary's conversation,
 * product interests, declined products, advisories, plans, goals, needs, check-ins. Some of
 * those would be harmless. They are left out anyway, because the rule that survives a year of
 * changes is "nothing unless it is theirs" rather than a list of exceptions somebody has to
 * remember to extend.
 */
export function buildPartnerDigest(
  loaded: LoadedCase,
  partnerId: string,
  options: { readonly partnerName?: string | null } = {},
): CaseDigest {
  const theirs = loaded.facts.filter((fact) => {
    if (fact.supersededBy !== null) return false
    if (!isFactKey(fact.key)) return false
    // Special-category values are never in a digest for anybody (Invariant 6).
    if (factCatalogue[fact.key].sensitivity === 'special') return false
    // Decided by subject, not by who typed it: the household's facts belong to both.
    return fact.subject === partnerId || fact.subject === 'household'
  })

  const involved = loaded.applications.filter(
    (application) => journeyFor(application.product).supportsPartner,
  )

  return {
    customerName: options.partnerName ?? null,
    // Never signed in as a bank customer. They arrived on an invite link.
    authLevel: 'anonymous',
    facts: theirs.map((fact) => ({
      label: isFactKey(fact.key) ? factCatalogue[fact.key].label : fact.key,
      value: String(fact.value),
      source: fact.source,
      verified: fact.verified,
    })),
    applications: involved.map((application) => {
      const evaluation = evaluateFor(loaded, application)

      return {
        product: application.product,
        displayName: applicationName(application),
        state: application.state,
        stateLabel: stateLabel(application.state),
        // Only what is wanted from them. What the primary still owes is the primary's business.
        outstanding: evaluation.outstanding
          .filter((item) => item.blocking && item.waitingOn === 'partner')
          .map((item) => item.requirement.label),
        waitingOn: evaluation.waitingOn === 'partner' ? ('partner' as const) : null,
      }
    }),
    declinedProducts: [],
    advisories: [],
    partner: null,
    eventsSinceLastSeen: [],
  }
}
