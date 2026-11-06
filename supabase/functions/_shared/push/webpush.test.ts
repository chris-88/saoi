import { describe, expect, it } from 'vitest'
import { b64urlDecode, b64urlEncode, encryptPayload, vapidHeader } from './webpush.ts'

/*
 * A round trip, not a copied test vector.
 *
 * The first version of this test asserted RFC 8291's published ciphertext, typed from memory,
 * and it was wrong — 49 sealed bytes for a 41-byte plaintext, which cannot happen once the
 * padding delimiter and the GCM tag are counted. The implementation was correct and the test
 * said otherwise. A constant nobody verified is worse than no test, because it is believed.
 *
 * So this decrypts instead. The receiver side is derived independently from the sender's, and
 * every value that could be wrong — the info strings, the order of the two public keys in
 * them, the nonce, the delimiter — has to be wrong in the same way twice for the plaintext to
 * come back. Proof that it works against a real browser is the Playwright run, which is the
 * only test that can be certain.
 */
const utf8 = new TextEncoder()

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ])
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
      key,
      length * 8,
    ),
  )
}

/** What a browser does with the body it is handed. */
async function decryptAsBrowser(
  body: Uint8Array,
  uaKeys: CryptoKeyPair,
  authSecret: Uint8Array,
): Promise<string> {
  const salt = body.slice(0, 16)
  const asPublic = body.slice(21, 21 + body[20]!)
  const sealed = body.slice(21 + body[20]!)

  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', uaKeys.publicKey))
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'ECDH',
        public: await crypto.subtle.importKey(
          'raw',
          asPublic as BufferSource,
          { name: 'ECDH', namedCurve: 'P-256' },
          true,
          [],
        ),
      },
      uaKeys.privateKey,
      256,
    ),
  )

  const ikm = await hkdf(
    authSecret,
    shared,
    concat(utf8.encode('WebPush: info\0'), uaPublic, asPublic),
    32,
  )
  const cek = await hkdf(salt, ikm, utf8.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8.encode('Content-Encoding: nonce\0'), 12)

  const opened = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['decrypt']),
      sealed,
    ),
  )

  // Drop the padding delimiter the sender appended.
  return new TextDecoder().decode(opened.slice(0, -1))
}

const freshBrowser = async () => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])
  const authSecret = crypto.getRandomValues(new Uint8Array(16))
  return {
    keys,
    authSecret,
    subscription: {
      p256dh: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))),
      auth: b64urlEncode(authSecret),
    },
  }
}

const senderKeys = () =>
  crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])

describe('encryptPayload', () => {
  it('produces something the receiving browser can open', async () => {
    const browser = await freshBrowser()
    const message = 'When I grow up, I want to be a watermelon'

    const body = await encryptPayload(
      browser.subscription,
      utf8.encode(message),
      crypto.getRandomValues(new Uint8Array(16)),
      await senderKeys(),
    )

    expect(await decryptAsBrowser(body, browser.keys, browser.authSecret)).toBe(message)
  })

  it('cannot be opened by a different browser', async () => {
    const intended = await freshBrowser()
    const other = await freshBrowser()

    const body = await encryptPayload(
      intended.subscription,
      utf8.encode('private'),
      crypto.getRandomValues(new Uint8Array(16)),
      await senderKeys(),
    )

    await expect(decryptAsBrowser(body, other.keys, other.authSecret)).rejects.toThrow()
  })

  it('writes the header the aes128gcm encoding requires', async () => {
    const browser = await freshBrowser()
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const body = await encryptPayload(
      browser.subscription,
      utf8.encode('x'),
      salt,
      await senderKeys(),
    )

    expect(body.slice(0, 16)).toEqual(salt)
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096)
    expect(body[20]).toBe(65)
    // Plaintext, the 0x02 delimiter, and the GCM tag.
    expect(body.length).toBe(86 + 1 + 1 + 16)
  })
})

describe('vapidHeader', () => {
  const key = {
    // A throwaway pair, generated once for these assertions. Nothing is signed that matters.
    privateD: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    publicKey:
      'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    subject: 'mailto:saoi@example.com',
  }

  it('addresses the token to the push service, not the subscription', async () => {
    const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc123', key)
    const claims = JSON.parse(
      new TextDecoder().decode(b64urlDecode(header.split('t=')[1]?.split('.')[1] ?? '')),
    ) as { aud: string; sub: string; exp: number }

    // The audience is the origin. Sending the whole endpoint leaks which subscription it is.
    expect(claims.aud).toBe('https://fcm.googleapis.com')
    expect(claims.sub).toBe('mailto:saoi@example.com')
  })

  it('expires, and within the day the spec allows', async () => {
    const header = await vapidHeader('https://example.com/push/1', key)
    const claims = JSON.parse(
      new TextDecoder().decode(b64urlDecode(header.split('t=')[1]?.split('.')[1] ?? '')),
    ) as { exp: number }
    const hours = (claims.exp - Date.now() / 1000) / 3600

    expect(hours).toBeGreaterThan(0)
    expect(hours).toBeLessThan(24)
  })

  it('carries the public key the push service checks the signature with', async () => {
    const header = await vapidHeader('https://example.com/push/1', key)
    expect(header).toContain(`k=${key.publicKey}`)
  })
})
