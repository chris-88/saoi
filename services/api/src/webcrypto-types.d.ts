/* eslint-disable @typescript-eslint/consistent-type-imports */
/**
 * `_shared/push/webpush.ts` is written against the DOM names for Web Crypto and fetch, which the
 * Deno functions have and this service's `lib` (ES2023 plus @types/node) does not. Node 24 has
 * the runtime for all of them; these aliases are only the type names.
 */
type BufferSource = ArrayBufferView | ArrayBuffer
type CryptoKey = import('node:crypto').webcrypto.CryptoKey
type CryptoKeyPair = import('node:crypto').webcrypto.CryptoKeyPair
type BodyInit = Uint8Array | string
