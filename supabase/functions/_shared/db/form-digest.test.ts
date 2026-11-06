import { describe, expect, it } from 'vitest'
import { goalCatalogue } from '../domain/goals/catalogue.ts'
import { needCatalogue } from '../domain/needs/catalogue.ts'
import { asApplicationId, asParticipantId } from '../domain/facts.ts'
import type { Application } from '../domain/state-machine.ts'
import { slidersFor } from '../llm/persona.ts'
import { formSnapshot } from '../tenants/demo/forms/snapshots.ts'
import { formDigests, formDigestSection, type FormDigest } from './form-digest.ts'
import type { LoadedCase } from './loaded-case.ts'

/**
 * Against the live SuperSaver definition, not a fixture.
 *
 * The digest and the recorder share one key: the definition's own field id. For two days the
 * digest listed labels and the recorder wanted ids, and every answer a customer gave to the
 * bank's form was refused. These tests pin the id onto the line the model copies from, so a
 * change to either side fails here before it fails in a conversation.
 */

const PRIMARY = asParticipantId('11111111-1111-4111-8111-111111111111')

const savings: Application = {
  id: asApplicationId('33333333-3333-4333-8333-000000000001'),
  product: 'savings',
  state: 'in_progress',
  resumeTo: null,
}

function loaded(overrides: Partial<LoadedCase> = {}): LoadedCase {
  return {
    caseId: '44444444-4444-4444-8444-444444444444',
    kind: 'presenter',
    authLevel: 'authenticated',
    customerName: 'Aoife',
    lastSeenAt: null,
    participants: [{ id: PRIMARY, role: 'primary', displayName: 'Aoife' }],
    overrides: [],
    goals: goalCatalogue,
    needs: needCatalogue,
    facts: [],
    applications: [savings],
    confirmations: [],
    documents: [],
    requests: [],
    productInterests: [],
    formApplications: [{ id: 'fa-1', formId: '1833', answers: {} }],
    linkedAccounts: [],
    transfers: [],
    messages: [],
    eventsSinceLastSeen: [],
    persona: slidersFor('default'),
    killSwitch: false,
    ...overrides,
  }
}

const questionLines = (section: string): string[] =>
  section.split('\n').filter((line) => line.startsWith('- '))

describe('every question carries the id the recorder keys on', () => {
  it('lists each outstanding question as "- [id N] label"', () => {
    const digests = formDigests(loaded())
    const section = formDigestSection(digests)

    const lines = questionLines(section)
    expect(lines).toHaveLength(5)
    for (const line of lines) expect(line).toMatch(/^- \[id \d{1,4}\] \S/)
  })

  it('uses the definition’s own field ids, which is what record_form_answers matches on', () => {
    const definition = formSnapshot('1833')?.definition
    const known = new Set(definition?.fields.map((field) => field.id) ?? [])

    const [digest] = formDigests(loaded())
    expect(digest?.questions.length).toBeGreaterThan(0)
    for (const question of digest?.questions ?? []) expect(known.has(question.fieldId)).toBe(true)
  })

  it('renders the first questions of the real SuperSaver form exactly', () => {
    const section = formDigestSection(formDigests(loaded()))

    expect(section).toContain('- [id 1147] Do you use online banking? One of: Yes, No.')
    expect(section).toContain(
      '- [id 218] What type of account would you like to apply for? One of: Sole account, Joint account.',
    )
    expect(section).toContain(
      '- [id 461] Do you have a personal current account with Demo Bank? One of: Yes, No.',
    )
  })

  it('reaches the title once the contact details are held, as on a live case', () => {
    // Mobile and email prefill from facts on a real case, which is what brought "Title" into
    // the five the model was shown, and then lost, in case aed80555.
    const section = formDigestSection(
      formDigests(
        loaded({
          formApplications: [
            {
              id: 'fa-1',
              formId: '1833',
              answers: { 1189: '0871234567', 1155: 'aoife@example.ie' },
            },
          ],
        }),
      ),
    )

    expect(section).toContain('- [id 380] Title. One of: Mr, Mrs, Ms, Dr, Rev, Prof.')
  })

  it('says when a choice list has been cut, so a country off the list is still offered', () => {
    const section = formDigestSection(
      formDigests(
        loaded({
          formApplications: [
            {
              id: 'fa-1',
              formId: '1833',
              answers: {
                1147: 'No',
                218: 'Sole account',
                1189: '0871234567',
                1155: 'aoife@example.ie',
                461: 'Yes',
                380: 'Ms',
                1174: 'Aoife',
                1175: 'Byrne',
                5: '1990-01-01',
              },
            },
          ],
        }),
      ),
    )

    expect(section).toMatch(
      /^- \[id 478\] Country of residence\. One of: Ireland, .+ or \d+ others\.$/m,
    )
  })
})

describe('the instruction tells the model how to record what it hears', () => {
  it('names the tool and the id in brackets', () => {
    const section = formDigestSection(formDigests(loaded()))

    expect(section).toMatch(/record_form_answers/)
    expect(section).toMatch(/id in brackets/)
  })

  it('keeps the declaration and document notes beside the id', () => {
    const digest: FormDigest = {
      formId: '1833',
      formName: 'SuperSaver - R2.0.1',
      remaining: 2,
      answered: 0,
      questions: [
        {
          fieldId: '1070',
          label: 'I confirm the above.',
          choices: [],
          choiceCount: 0,
          kind: 'consent',
        },
        {
          fieldId: '151',
          label: 'Proof of address',
          choices: [],
          choiceCount: 0,
          kind: 'document',
        },
      ],
    }

    const lines = questionLines(formDigestSection([digest]))
    expect(lines[0]).toBe(
      '- [id 1070] I confirm the above. This is a declaration: it needs an explicit tap, never an answer in chat.',
    )
    expect(lines[1]).toBe('- [id 151] Proof of address. This is a document to upload.')
  })

  it('says nothing when no application has a form behind it', () => {
    expect(formDigestSection(formDigests(loaded({ applications: [], formApplications: [] })))).toBe(
      '',
    )
  })
})
