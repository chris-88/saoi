import { describe, expect, it } from 'vitest'
import {
  asApplicationId,
  asFactId,
  asParticipantId,
  factCatalogue,
  isFactKey,
  type ApplicationId,
  type Fact,
  type FactKey,
  type FactSubject,
} from '../facts.ts'
import { PRODUCTS, type Product, type Requirement } from '../journey.ts'
import { evaluateJourney, type RequirementContext } from '../requirements.ts'
import { questionsAvoided, reuseByFactKey } from '../metrics.ts'
import { ALL_JOURNEYS, journeyFor, journeys } from './index.ts'

const PRIMARY = asParticipantId('primary')
const PARTNER = asParticipantId('partner')
const MORTGAGE_APP = asApplicationId('app-mortgage')

let n = 0
function fact(
  key: FactKey,
  subject: FactSubject,
  value: unknown,
  capturedFor: ApplicationId | null = MORTGAGE_APP,
): Fact {
  n += 1
  return {
    id: asFactId(`f-${n}`),
    key,
    subject,
    value,
    source: 'customer_stated',
    verified: false,
    capturedFor,
    supersededBy: null,
    capturedAt: '2026-09-30T10:00:00.000Z',
  }
}

/** Everything the mortgage conversation established about the §5 customer. */
function factsFromTheMortgageConversation(): Fact[] {
  return [
    fact('identity.fullName', PRIMARY, 'Aoife Ní Bhriain'),
    fact('identity.dateOfBirth', PRIMARY, '1992-04-17'),
    fact('identity.address', PRIMARY, '14 Sample Terrace, Dublin 8'),
    fact('identity.yearsAtAddress', PRIMARY, 3),
    fact('identity.nationality', PRIMARY, 'Irish'),
    fact('identity.maritalStatus', PRIMARY, 'married'),
    fact('identity.ppsn', PRIMARY, '1234567AB'),
    fact('identity.email', PRIMARY, 'aoife@example.com'),
    fact('identity.mobile', PRIMARY, '+353871234567'),
    fact('household.buyingWith', 'household', 'partner'),
    fact('household.dependantCount', 'household', 1),
    fact('employment.status', PRIMARY, 'employed_full_time'),
    fact('employment.employerName', PRIMARY, 'Sample Software Ltd'),
    fact('employment.occupation', PRIMARY, 'Product designer'),
    fact('employment.startDate', PRIMARY, '2021-09-01'),
    fact('income.annualBasic', PRIMARY, 92_000),
    fact('liabilities.monthlyLoanRepayments', PRIMARY, 0),
    fact('liabilities.creditCardBalance', PRIMARY, 450),
    fact('expenditure.monthlyOther', 'household', 900),
    fact('expenditure.monthlyRent', 'household', 1_850),
    fact('expenditure.monthlyChildcare', 'household', 1_100),
  ]
}

function context(overrides: Partial<RequirementContext> = {}): RequirementContext {
  return {
    applicationId: asApplicationId('app-other'),
    participants: { primary: PRIMARY, partner: null },
    facts: [],
    confirmations: [],
    documents: [],
    ...overrides,
  }
}

const allRequirements = (product: Product): readonly Requirement[] => {
  const journey = journeyFor(product)
  return [...journey.requirements, ...journey.branches.flatMap((b) => b.requirements)]
}

describe('journey definitions', () => {
  it('defines one journey per supported product (§7)', () => {
    expect(Object.keys(journeys).sort()).toEqual([...PRODUCTS].sort())
  })

  it('references only fact keys that exist in the catalogue', () => {
    // A runtime sweep, not a type check: it catches a key removed from the catalogue while a
    // journey still names it. `isFactKey` is applied to a widened string deliberately, since
    // the static type already claims the key is valid.
    const unknown: string[] = []
    for (const journey of ALL_JOURNEYS) {
      for (const requirement of allRequirements(journey.product)) {
        if (requirement.kind !== 'fact') continue
        const key: string = requirement.fact
        if (!isFactKey(key)) unknown.push(`${journey.product}/${requirement.id}: ${key}`)
      }
    }
    expect(unknown).toEqual([])
  })

  it('is still marked draft, because the recordings have not been translated yet (§8)', () => {
    for (const journey of ALL_JOURNEYS) {
      expect(journey.status, journey.product).toBe('draft')
      expect(journey.source, journey.product).toBeNull()
    }
  })

  it('only asks the partner for things on journeys that support a partner', () => {
    for (const journey of ALL_JOURNEYS) {
      const partnerRequirements = allRequirements(journey.product).filter(
        (r) => r.subject === 'partner',
      )
      if (partnerRequirements.length > 0) {
        expect(journey.supportsPartner, journey.product).toBe(true)
      }
    }
  })

  it('marks every declaration and consent as fresh, so none is ever reused (§11)', () => {
    for (const journey of ALL_JOURNEYS) {
      for (const requirement of allRequirements(journey.product)) {
        if (requirement.kind === 'declaration' || requirement.kind === 'confirmation') {
          expect(requirement.fresh, `${journey.product}/${requirement.id}`).toBe(true)
        }
      }
    }
  })
})

describe('protection keeps health information behind explicit consent (§7.5, Invariant 6)', () => {
  const healthKeys = [
    'protection.health.smoker',
    'protection.health.heightCm',
    'protection.health.weightKg',
    'protection.health.conditions',
  ] satisfies FactKey[]

  it('asks no health question before consent is given', () => {
    const evaluation = evaluateJourney(journeyFor('protection'), context())
    const asked = evaluation.outstanding.filter(
      (item) =>
        item.requirement.kind === 'fact' &&
        (healthKeys as string[]).includes(item.requirement.fact),
    )

    expect(asked).toEqual([])
    expect(evaluation.outstanding.some((i) => i.requirement.id === 'health-consent')).toBe(true)
  })

  it('asks the health questions once consent is given', () => {
    const evaluation = evaluateJourney(
      journeyFor('protection'),
      context({ confirmations: ['health-consent'] }),
    )

    expect(evaluation.outstanding.map((i) => i.requirement.id)).toContain('smoker')
    expect(evaluation.outstanding.map((i) => i.requirement.id)).toContain('conditions')
  })

  it("keeps the partner behind their own consent, not the primary customer's", () => {
    const evaluation = evaluateJourney(
      journeyFor('protection'),
      context({
        participants: { primary: PRIMARY, partner: PARTNER },
        facts: [fact('household.buyingWith', 'household', 'partner')],
        confirmations: ['health-consent'],
      }),
    )

    const ids = evaluation.outstanding.map((i) => i.requirement.id)
    expect(ids).toContain('partner-health-consent')
    expect(ids).not.toContain('partner-smoker')
  })

  it('marks every health fact special, never reusable and not extractable by the model', () => {
    for (const key of healthKeys) {
      const definition = factCatalogue[key]
      expect(definition.sensitivity, key).toBe('special')
      expect(definition.reuse, key).toBe('never')
      expect(definition.extractable, key).toBe(false)
    }
  })
})

describe('the joint account needs a second applicant (§7.2)', () => {
  it('waits on the partner before one has joined', () => {
    const evaluation = evaluateJourney(journeyFor('joint_account'), context())
    const awaiting = evaluation.outstanding.filter((i) => i.reason === 'awaiting_partner')

    expect(awaiting.length).toBeGreaterThan(0)
  })
})

/**
 * §67 — "Saoirse collected information once and reused it across multiple existing journeys."
 * This is the test that statement rests on.
 */
describe('cross-journey reuse', () => {
  const facts = factsFromTheMortgageConversation()

  it('asks the credit card nothing the customer has not already told us (§7.3)', () => {
    const evaluation = evaluateJourney(
      journeyFor('credit_card'),
      context({ applicationId: asApplicationId('app-card'), facts }),
    )

    // Nothing is unknown: every outstanding item is either a value to confirm or a fresh
    // declaration that must be made per application.
    expect(evaluation.outstanding.filter((i) => i.reason === 'missing')).toEqual([])
    expect(evaluation.outstanding.map((i) => i.reason)).toContain('needs_confirmation')
    expect(evaluation.outstanding.map((i) => i.requirement.id)).toContain('credit-declaration')
  })

  it('reuses everything but the declaration once the customer confirms the known values', () => {
    const cardApp = asApplicationId('app-card')
    const journey = journeyFor('credit_card')

    const toConfirm = evaluateJourney(journey, context({ applicationId: cardApp, facts }))
      .outstanding.filter((i) => i.reason === 'needs_confirmation')
      .map((i) => i.requirement.id)

    const evaluation = evaluateJourney(
      journey,
      context({ applicationId: cardApp, facts, confirmations: toConfirm }),
    )

    expect(evaluation.outstanding.map((i) => i.requirement.id)).toEqual(['credit-declaration'])
    expect(evaluation.satisfied.every((item) => item.reused)).toBe(true)
  })

  it('still asks the personal loan for the amount and purpose, which are always fresh (§7.4)', () => {
    const evaluation = evaluateJourney(
      journeyFor('personal_loan'),
      context({ applicationId: asApplicationId('app-loan'), facts }),
    )
    const missing = evaluation.outstanding
      .filter((i) => i.reason === 'missing')
      .map((i) => i.requirement.id)

    expect(missing).toContain('amount')
    expect(missing).toContain('purpose')
  })

  it('counts the questions avoided across every concurrent application (§53)', () => {
    const applications = (['credit_card', 'personal_loan', 'protection'] as const).map(
      (product, index) => {
        const applicationId = asApplicationId(`app-${index}`)
        const journey = journeyFor(product)
        const base = context({ applicationId, facts })
        const toConfirm = evaluateJourney(journey, base)
          .outstanding.filter((i) => i.reason === 'needs_confirmation')
          .map((i) => i.requirement.id)

        return {
          applicationId,
          evaluation: evaluateJourney(journey, { ...base, confirmations: toConfirm }),
        }
      },
    )

    // Every one of these was answered once, in the mortgage conversation.
    expect(questionsAvoided(applications)).toBeGreaterThanOrEqual(20)

    const breakdown = reuseByFactKey(applications)
    const name = breakdown.find((entry) => entry.key === 'identity.fullName')
    expect(name?.timesReused).toBe(3)
  })

  it('never lets the primary satisfy a partner requirement on the mortgage', () => {
    const evaluation = evaluateJourney(
      journeyFor('mortgage'),
      context({
        applicationId: MORTGAGE_APP,
        participants: { primary: PRIMARY, partner: PARTNER },
        facts,
      }),
    )
    const partnerIncome = evaluation.outstanding.find(
      (i) => i.requirement.id === 'partner-income-basic',
    )

    expect(partnerIncome).toBeDefined()
    expect(partnerIncome?.waitingOn).toBe('partner')
  })
})

/**
 * Case eb37e9b5: a switcher was asked for rent, deposit and whether he was a first-time buyer,
 * and never for his lender. The buyer type now picks the middle of the journey.
 */
describe('the mortgage journey for a switcher', () => {
  const switcherFacts = [
    fact('mortgage.customerType', 'household', 'switcher'),
    fact('housing.currentTenure', 'household', 'owner_occupier'),
    fact('household.buyingWith', 'household', 'alone'),
  ]

  const labels = (facts: Fact[]) =>
    evaluateJourney(
      journeyFor('mortgage'),
      context({ applicationId: MORTGAGE_APP, facts }),
    ).outstanding.map((item) => item.requirement.id)

  it('asks about the current deal and the property, never about a deposit or rent', () => {
    const outstanding = labels(switcherFacts)
    for (const id of [
      'current-lender',
      'balance',
      'current-rate',
      'current-rate-ends',
      'property-value',
      'doc-mortgage-statements',
    ]) {
      expect(outstanding, id).toContain(id)
    }
    for (const id of [
      'first-time-buyer',
      'deposit',
      'rent',
      'purchase-price',
      'property-county',
      'current-tenure',
    ]) {
      expect(outstanding, id).not.toContain(id)
    }
  })

  it('treats an unknown buyer type as a purchase, as every conversation did before', () => {
    const outstanding = labels([])
    expect(outstanding).toContain('first-time-buyer')
    expect(outstanding).toContain('deposit')
    expect(outstanding).not.toContain('current-lender')
  })

  it('still assesses a second applicant on a joint switch', () => {
    const outstanding = labels([
      ...switcherFacts.filter((f) => f.key !== 'household.buyingWith'),
      fact('household.buyingWith', 'household', 'partner'),
    ])
    expect(outstanding).toContain('partner-income-basic')
  })
})
