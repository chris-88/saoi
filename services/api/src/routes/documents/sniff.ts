/**
 * What a file actually is, from its first bytes. The client's declared type is a claim; this
 * is the check. The allowlist is PDF and the photo formats a phone produces.
 */
export type DocumentKind = { readonly mime: string; readonly extension: string }

const PDF: DocumentKind = { mime: 'application/pdf', extension: 'pdf' }
const PNG: DocumentKind = { mime: 'image/png', extension: 'png' }
const JPEG: DocumentKind = { mime: 'image/jpeg', extension: 'jpg' }
const HEIC: DocumentKind = { mime: 'image/heic', extension: 'heic' }

export const ALLOWED_MIME = new Set([PDF.mime, PNG.mime, JPEG.mime, HEIC.mime])

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte)

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to))

/** The kind of document these bytes are, or null when they are none we accept. */
export function sniffDocument(bytes: Uint8Array): DocumentKind | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return PDF
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return JPEG
  if (ascii(bytes, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(bytes, 8, 12))) return HEIC
  return null
}
