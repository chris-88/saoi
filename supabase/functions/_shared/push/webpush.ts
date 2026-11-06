/**
 * Web Push, by hand (RFC 8291 for the payload, RFC 8292 for the authorisation).
 *
 * No library. Every primitive this needs — ECDH on P-256, HKDF-SHA256, AES-128-GCM, ES256 —
 * is in WebCrypto, which Deno has natively, where a push library is written against Node's
 * crypto and brings a shim layer to run here at all. Fewer moving parts in the place where a
 * subtle mistake is silent.
 *
 * It is exact work, so it is written to be tested: `encryptPayload` takes the salt and the
 * ephemeral key rather than generating them, which is what lets RFC 8291's own worked example
 * run through it and prove the output byte for byte.
 */

const utf8 = new TextEncoder()

export const b64urlDecode = (value: string): Uint8Array => {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export const b64urlEncode = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')

const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** HKDF in one step, which is all this needs: extract with `salt`, expand with `info`. */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

/** An uncompressed P-256 point (0x04 ‖ X ‖ Y) as a WebCrypto public key. */
const importPublic = (raw: Uint8Array): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  )

export type Subscription = {
  readonly endpoint: string
  /** The browser's public key, base64url. */
  readonly p256dh: string
  /** The browser's auth secret, base64url. */
  readonly auth: string
}

/**
 * The encrypted body, in the `aes128gcm` content encoding.
 *
 * `salt` and `ephemeral` are arguments rather than generated inside, purely so the RFC's
 * worked example can be reproduced. `sendPush` generates both.
 */
export async function encryptPayload(
  subscription: Pick<Subscription, 'p256dh' | 'auth'>,
  plaintext: Uint8Array,
  salt: Uint8Array,
  ephemeral: CryptoKeyPair,
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(subscription.p256dh)
  const authSecret = b64urlDecode(subscription.auth)

  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))

  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: await importPublic(uaPublic) },
      ephemeral.privateKey,
      256,
    ),
  )

  /*
   * The key-derivation info string carries both public keys, which is what binds the ciphertext
   * to this exact pair of parties. Getting the order wrong (it is the browser's, then ours)
   * produces a body the browser cannot open and no error anywhere to say why.
   */
  const ikm = await hkdf(
    authSecret,
    shared,
    concat(utf8.encode('WebPush: info\0'), uaPublic, asPublic),
    32,
  )

  const cek = await hkdf(salt, ikm, utf8.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8.encode('Content-Encoding: nonce\0'), 12)

  const key = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, [
    'encrypt',
  ])
  // 0x02 is the padding delimiter for the last — here, only — record.
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      key,
      concat(plaintext, Uint8Array.of(2)) as BufferSource,
    ),
  )

  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length

  return concat(header, asPublic, sealed)
}

export type VapidKey = {
  /** The private scalar `d`, base64url, as a JWK carries it. */
  readonly privateD: string
  /** The public point, base64url, uncompressed. */
  readonly publicKey: string
  /** `mailto:` or an https URL the push service can complain to. */
  readonly subject: string
}

/** The `Authorization: vapid` header value: who is sending, signed (RFC 8292). */
export async function vapidHeader(endpoint: string, key: VapidKey): Promise<string> {
  const audience = new URL(endpoint).origin
  const header = b64urlEncode(utf8.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64urlEncode(
    utf8.encode(
      JSON.stringify({
        aud: audience,
        // Twelve hours. The spec caps it at 24 and push services reject anything beyond.
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: key.subject,
      }),
    ),
  )

  const raw = b64urlDecode(key.publicKey)
  const signingKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: key.privateD,
      x: b64urlEncode(raw.slice(1, 33)),
      y: b64urlEncode(raw.slice(33, 65)),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )

  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      signingKey,
      utf8.encode(`${header}.${claims}`),
    ),
  )

  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${key.publicKey}`
}

export type PushResult = {
  readonly ok: boolean
  readonly status: number
  /** True when the push service says this subscription is gone for good. */
  readonly gone: boolean
}

/** Encrypt, sign and deliver. A 404 or 410 means the subscription should be forgotten. */
export async function sendPush(
  subscription: Subscription,
  payload: unknown,
  key: VapidKey,
): Promise<PushResult> {
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const body = await encryptPayload(
    subscription,
    utf8.encode(JSON.stringify(payload)),
    salt,
    ephemeral,
  )

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(subscription.endpoint, key),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body: body as BodyInit,
  })

  return {
    ok: response.ok,
    status: response.status,
    gone: response.status === 404 || response.status === 410,
  }
}
