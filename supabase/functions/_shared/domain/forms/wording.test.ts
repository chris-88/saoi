import { describe, expect, it } from 'vitest'
import { declarationWording } from './wording.ts'

describe('declarationWording', () => {
  it('uses the label when it is the sentence', () => {
    expect(
      declarationWording({
        label: 'I confirm that I have read and understood the above',
        choices: [],
      }),
    ).toBe('I confirm that I have read and understood the above')
  })

  it('uses the single choice when the label is a stub', () => {
    expect(
      declarationWording({
        label: 'DGS',
        choices: [
          {
            text: 'I confirm that I have read and understood the Deposit Guarantee Scheme.',
            value: 'Yes',
          },
        ],
      }),
    ).toBe('I confirm that I have read and understood the Deposit Guarantee Scheme.')
  })

  it('uses the single choice when the label is empty', () => {
    expect(
      declarationWording({
        label: '',
        choices: [{ text: 'I confirm the thing', value: 'I confirm the thing' }],
      }),
    ).toBe('I confirm the thing')
  })

  it('never picks from several choices', () => {
    expect(
      declarationWording({
        label: 'Pick',
        choices: [
          { text: 'A long first option', value: 'a' },
          { text: 'B', value: 'b' },
        ],
      }),
    ).toBe('Pick')
  })
})
