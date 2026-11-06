/**
 * Secrets and settings the admin stores need from outside the database. All optional at boot
 * (the rest of the service runs without them); a store that needs one and finds it unset
 * throws `new ApiError('upstream_unavailable', '<what> is not configured.')`.
 */
export type AdminExternals = {
  readonly anthropicApiKey?: string
  readonly saoiModel: string
  readonly gateModel: string
  /** Origin the notification link is built on, e.g. `https://app.saoi.ie`. */
  readonly appBaseUrl: string
  readonly vapid?: {
    readonly privateD: string
    readonly publicKey: string
    readonly subject: string
  }
}
