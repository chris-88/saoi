import { describe, expect, it } from 'vitest'
import { collaboratorsToCsv, csvCell } from './csv'
import type { Collaborator } from '@contracts/admin.ts'

const person: Collaborator = {
  id: '11111111-2222-4333-8444-555555555555',
  kind: 'collaborate',
  name: 'Ada Byrne',
  email: 'ada@example.ie',
  organisation: 'Byrne, Byrne & Co',
  role: null,
  interest: 'A team that has done this\nbefore, and a bank that "might".',
  source: 'qr',
  createdAt: '2026-10-22T09:30:00.000Z',
}

describe('the collaborator export', () => {
  it('quotes what needs quoting and leaves the rest alone', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell(null)).toBe('')
    expect(csvCell('a, b')).toBe('"a, b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
  })

  it('defuses a cell a spreadsheet would run', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+1 555')).toBe(`'+1 555`)
    expect(csvCell('@handle')).toBe(`'@handle`)
    expect(csvCell('-not a formula')).toBe(`'-not a formula`)
  })

  it('writes a header and one row per person', () => {
    const csv = collaboratorsToCsv([person])
    const [header, ...rows] = csv.split('\r\n')
    expect(header).toBe('kind,name,email,organisation,role,interest,source,createdAt')
    expect(rows.join('\r\n')).toBe(
      'collaborate,Ada Byrne,ada@example.ie,"Byrne, Byrne & Co",,"A team that has done this\nbefore, and a bank that ""might"".",qr,2026-10-22T09:30:00.000Z\r\n',
    )
  })
})
