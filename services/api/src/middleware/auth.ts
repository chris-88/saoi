import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../context.ts'
import { ApiError } from '../errors.ts'

/** Who is calling. Handlers see this and nothing else about the token. */
export type AuthUser = {
  readonly id: string
  /** Supabase's `is_anonymous` claim: true until the visitor signs in with an email code. */
  readonly isAnonymous: boolean
}

export type TokenVerifier = (token: string) => Promise<AuthUser | null>

export type VerifierConfig = {
  readonly secret?: string | undefined
  readonly jwksUrl: string
  readonly issuer?: string | undefined
}

/**
 * Verifies a Supabase access token.
 *
 * Symmetric (HS*) tokens are checked against `SUPABASE_JWT_SECRET`; anything else against the
 * project's JWKS. The audience must be `authenticated`: the anon key is itself a valid JWT
 * signed by the same secret, and it must not pass for a user.
 */
export function createTokenVerifier(config: VerifierConfig): TokenVerifier {
  const secret = config.secret === undefined ? null : new TextEncoder().encode(config.secret)
  let jwks: JWTVerifyGetKey | null = null

  return async (token) => {
    try {
      const { alg } = decodeProtectedHeader(token)
      const key =
        alg !== undefined && alg.startsWith('HS')
          ? secret
          : (jwks ??= createRemoteJWKSet(new URL(config.jwksUrl)))
      if (key === null) return null

      const { payload } = await jwtVerify(token, key as never, {
        audience: 'authenticated',
        ...(config.issuer === undefined ? {} : { issuer: config.issuer }),
      })
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null
      return { id: payload.sub, isAnonymous: payload['is_anonymous'] === true }
    } catch {
      return null
    }
  }
}

/** 401 unless the request carries a valid `Authorization: Bearer` token. */
export function requireAuth(verify: TokenVerifier) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header('Authorization') ?? ''
    const match = /^Bearer\s+(\S+)$/i.exec(header)
    const user = match?.[1] === undefined ? null : await verify(match[1])
    if (user === null) {
      throw new ApiError('unauthorised', 'Sign in first.')
    }
    c.set('user', user)
    await next()
  })
}
