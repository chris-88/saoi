import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { formDefinitionSchema } from './definition.ts'
import { buildSubmission } from './submission.ts'

const snapshot = JSON.parse(
  readFileSync('supabase/functions/_shared/tenants/demo/forms/form-1833.json', 'utf8'),
) as { definition: unknown; version: string }
const definition = formDefinitionSchema.parse(snapshot.definition)

const PAGE = 'https://forms.demo-bank.example/personal-banking/supersaver/'
const build = (answers: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  buildSubmission({ definition, answers, pageLocation: PAGE, ...extra })

/**
 * The packet, checked against the one captured from the real journey.
 *
 * The observed SuperSaver submission is 64 ordered entries with repeated keys, dotted
 * sub-inputs, hidden defaults and two runtime values. These assert the shapes that are
 * actually in it, because a builder that produces something merely plausible is worth nothing:
 * the claim being made is that this is what the existing journey would send.
 */
describe('buildSubmission()', () => {
  it('reads the real definition', () => {
    expect(definition.title).toBe('SuperSaver - R2.0.1')
    expect(definition.fields.length).toBe(499)
  })

  it('carries hidden defaults exactly as the captured packet does', () => {
    const keys = new Map(build({}).entries.map((e) => [e.key, e.value]))
    // Observed: input_494 "SuperSaver Application ", input_335 "GWS".
    expect(keys.get('input_494')).toBe('SuperSaver Application ')
    expect(keys.get('input_335')).toBe('GWS')
  })

  it('repeats the key for a compound field, as FormData allows', () => {
    const phone = build({ '1189': ['0871234567', 'IE'] }).entries.filter(
      (e) => e.key === 'input_1189[]',
    )
    expect(phone.map((e) => e.value)).toEqual(['0871234567', 'IE'])
  })

  it('submits a checkbox under its sub-input id', () => {
    // 1182 is the PPS confirmation and only appears once a number has been given, so the
    // number has to be there for the confirmation to be part of the journey at all.
    const consent = build({
      '778': '1234567T',
      '1182': ['I confirm I have checked my PPS number'],
    })
    const entry = consent.entries.find((e) => e.key === 'input_1182.1')
    expect(entry?.value).toBe('I confirm I have checked my PPS number')
    expect(entry?.source).toBe('consent')
  })

  it('leaves out a question that does not apply to this customer', () => {
    // 1147 is shown only when 335 is not "onlinebanking"; 1210 depends on 335 being it.
    const keys = (answers: Record<string, unknown>) =>
      new Set(build(answers).entries.map((e) => e.key))
    expect(keys({ '335': 'onlinebanking' }).has('input_1147')).toBe(false)
  })

  it('appends the two runtime values last, in the observed order', () => {
    const entries = build({ '218': 'Sole account' }).entries
    const last = entries.slice(-2).map((e) => e.key)
    expect(last).toEqual(['demo_nonce_form_field_1833', 'page_location'])
    expect(entries.at(-1)?.value).toBe(PAGE)
  })

  it('shows an empty nonce rather than inventing one', () => {
    const nonce = build({}).entries.find((e) => e.key === 'demo_nonce_form_field_1833')
    expect(nonce?.value).toBe('')
    expect(nonce?.sensitive).toBe(true)
  })

  it('records the target without ever being able to call it', () => {
    const packet = build({})
    expect(packet.target).toBe('https://forms.demo-bank.example/api/forms/1833')
    expect(packet.method).toBe('POST')
    expect(packet.encoding).toBe('multipart/form-data')
  })

  it('builds from partial answers, so a half-finished application still maps', () => {
    const partial = build({ '1174': 'Tony', '1175': 'Stark' })
    const keys = new Map(partial.entries.map((e) => [e.key, e.value]))
    expect(keys.get('input_1174')).toBe('Tony')
    expect(keys.get('input_1175')).toBe('Stark')
    // Nothing invented for what has not been asked yet.
    expect(keys.has('input_778')).toBe(false)
  })

  it('distinguishes what was reused from what was asked', () => {
    const packet = build({ '1174': 'Tony', '1175': 'Stark' }, { reused: new Set(['1174']) })
    const byKey = new Map(packet.entries.map((e) => [e.key, e.source]))
    expect(byKey.get('input_1174')).toBe('reused')
    expect(byKey.get('input_1175')).toBe('answer')
  })

  it('marks the values an inspector must mask', () => {
    const packet = build({ '778': '1234567T', '1174': 'Tony' })
    const byKey = new Map(packet.entries.map((e) => [e.key, e.sensitive]))
    expect(byKey.get('input_778')).toBe(true)
    expect(byKey.get('input_1174')).toBe(false)
  })

  it('carries the platform’s own downstream mapping through untouched', () => {
    const packet = build({ '1174': 'Tony' })
    const entry = packet.entries.find((e) => e.key === 'input_1174')
    expect(entry?.toscana).toBeTruthy()
  })
})

describe('controls that are more than one entry', () => {
  const durationForm = formDefinitionSchema.parse({
    id: '1940',
    title: 'test',
    fields: [
      {
        id: '443',
        type: 'years_and_months_field',
        label: 'Time at current address',
        inputs: [
          { id: '443.1', label: 'Years' },
          { id: '443.2', label: 'Months' },
          { id: '443.3', label: 'Total months' },
        ],
      },
    ],
  })

  it('expands a duration into years, months and the total', () => {
    const packet = buildSubmission({
      definition: durationForm,
      answers: { 443: { years: 5, months: 7 } },
      pageLocation: 'https://example.test',
    })

    const entries = packet.entries.filter((e) => e.key.startsWith('input_443'))
    expect(entries.map((e) => [e.key, e.value])).toEqual([
      ['input_443.1', '5'],
      ['input_443.2', '7'],
      // Arithmetic, not a question: nobody is asked for their total in months.
      ['input_443.3', '67'],
    ])
  })

  it('carries a calculation as parameters and result, like the captured submission', () => {
    const quoteForm = formDefinitionSchema.parse({
      id: '1940',
      title: 'test',
      fields: [{ id: '238', type: 'ndi_calculator', label: 'Full Quote Calculation' }],
    })

    const packet = buildSubmission({
      definition: quoteForm,
      answers: {},
      pageLocation: 'https://example.test',
      ndi: [
        {
          fieldId: '238',
          control: 'ndi_calculator',
          label: 'Full Quote Calculation',
          fidelity: 'source_faithful',
          parameters: { loanAmount: 20000, term: 24 },
          result: 903.63,
          note: '',
        },
      ],
    })

    const entries = packet.entries.filter((e) => e.key.startsWith('input_238'))
    expect(entries.map((e) => e.key)).toEqual(['input_238.parameters', 'input_238.result'])
    expect(JSON.parse(entries[0]?.value ?? '{}')).toEqual({ loanAmount: 20000, term: 24 })
    expect(entries[1]?.value).toContain('903.63')
    // Nobody was asked for either of them.
    expect(entries.every((e) => e.source === 'derived')).toBe(true)
  })

  it('sends an eligibility verdict as one entry', () => {
    const eligibilityForm = formDefinitionSchema.parse({
      id: '1940',
      title: 'test',
      fields: [{ id: '239', type: 'ndi_eligibility', label: 'Eligibility' }],
    })

    const packet = buildSubmission({
      definition: eligibilityForm,
      answers: {},
      pageLocation: 'https://example.test',
      ndi: [
        {
          fieldId: '239',
          control: 'ndi_eligibility',
          label: 'Eligibility',
          fidelity: 'fixture',
          parameters: {},
          result: 'eligible',
          note: '',
        },
      ],
    })

    expect(packet.entries.filter((e) => e.key === 'input_239').map((e) => e.value)).toEqual([
      'eligible',
    ])
  })
})

/**
 * The document half of the packet, which is a reference and never bytes.
 *
 * The captured submission carries nothing for the upload field itself. The file went somewhere
 * else before the form was submitted, and what travels with the form is a manifest naming it,
 * plus the preview control reporting that there is something to preview.
 */
describe('documents', () => {
  const uploadForm = formDefinitionSchema.parse({
    id: '1940',
    title: 'test',
    fields: [
      { id: '151', type: 'fileupload', label: 'PPS number document', toscana: 'PPSN_Document' },
      { id: '436', type: 'file_preview', label: 'File Preview', fileFields: ['input_151'] },
    ],
  })

  const attached = {
    151: {
      fileName: 'payslip.pdf',
      storagePath: 'case-1/form-1940-151-abc.pdf',
      sizeBytes: 90_000,
      mimeType: 'application/pdf',
    },
  }

  it('sends a manifest rather than a value on the upload field', () => {
    const packet = buildSubmission({
      definition: uploadForm,
      answers: attached,
      pageLocation: 'https://example.test',
    })

    expect(packet.entries.map((e) => e.key)).not.toContain('input_151')

    const manifest = packet.entries.find((e) => e.key === 'gform_uploaded_files')
    expect(manifest).toBeDefined()

    const parsed = JSON.parse(manifest?.value ?? '{}') as Record<
      string,
      { uploaded_filename: string }[]
    >
    expect(parsed['input_151']?.[0]?.uploaded_filename).toBe('payslip.pdf')
  })

  /**
   * The one thing in this feature that must never be invented. The real upload service issues
   * these; a plausible-looking signature from us would be a forged credential, whatever the
   * file behind it is.
   */
  it('leaves the production signatures empty', () => {
    const packet = buildSubmission({
      definition: uploadForm,
      answers: attached,
      pageLocation: 'https://example.test',
    })

    const manifest = JSON.parse(
      packet.entries.find((e) => e.key === 'gform_uploaded_files')?.value ?? '{}',
    ) as Record<string, Record<string, unknown>[]>

    expect(manifest['input_151']?.[0]?.['x-file-hash']).toBeNull()
    expect(manifest['input_151']?.[0]?.['x-signed-file-hash']).toBeNull()
  })

  it('previews only once there is something to preview', () => {
    const empty = buildSubmission({
      definition: uploadForm,
      answers: {},
      pageLocation: 'https://example.test',
    })
    expect(empty.entries.map((e) => e.key)).not.toContain('input_436')
    expect(empty.entries.map((e) => e.key)).not.toContain('gform_uploaded_files')

    const full = buildSubmission({
      definition: uploadForm,
      answers: attached,
      pageLocation: 'https://example.test',
    })
    expect(full.entries.find((e) => e.key === 'input_436')?.value).toBe('previewing')
  })
})
