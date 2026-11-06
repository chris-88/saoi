import type { Collaborator } from '@contracts/admin.ts'

/**
 * The collaborator list as a file (§44).
 *
 * Built on the client from what is loaded, so what you see is what you get and nothing on
 * the server has to know about spreadsheets.
 */
export const COLLABORATOR_COLUMNS = [
  'kind',
  'name',
  'email',
  'organisation',
  'role',
  'interest',
  'source',
  'createdAt',
] as const satisfies readonly (keyof Collaborator)[]

/**
 * One cell, safe for a spreadsheet.
 *
 * Quoted when it needs to be, and a leading `=`, `+`, `-` or `@` gets a quote in front of
 * it: these fields are typed by strangers on a public page, and a spreadsheet that opens
 * the file will otherwise run whatever a cell starting with `=` says.
 */
export function csvCell(value: string | null): string {
  if (value === null) return ''
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded
}

export function collaboratorsToCsv(items: readonly Collaborator[]): string {
  const lines = [
    COLLABORATOR_COLUMNS.join(','),
    ...items.map((person) =>
      COLLABORATOR_COLUMNS.map((column) => csvCell(person[column])).join(','),
    ),
  ]
  return `${lines.join('\r\n')}\r\n`
}
