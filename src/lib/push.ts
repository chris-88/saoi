import { callCaseActionApi } from '@/lib/saoiApi'

/**
 * Asking a browser to accept notifications, and telling the server where to send them.
 *
 * Three things have to be true before this can work, and they fail quietly and differently:
 * the browser must support the Push API, a service worker must be registered, and the person
 * must say yes. Each is reported separately rather than collapsed into false, because "this
 * phone cannot" and "they said no" need different things said to them.
 *
 * On iOS there is a fourth: Safari only offers push to a site that has been added to the Home
 * Screen. In a tab the API is simply absent, which is why `unsupported` carries a reason.
 */

export type SubscribeResult =
  | { readonly state: 'subscribed' }
  | { readonly state: 'denied' }
  | { readonly state: 'unsupported'; readonly reason: string }
  | { readonly state: 'failed'; readonly reason: string }

/** Already allowed, already refused, or never asked. Lets the UI avoid asking twice. */
export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported'
  return Notification.permission
}

/** The VAPID public key, as the Push API wants it: raw bytes, not base64url. */
function decodeKey(base64url: string): Uint8Array {
  const padded = base64url.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export async function subscribeToPush(caseId: string): Promise<SubscribeResult> {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (key === undefined || key.length === 0) {
    return { state: 'unsupported', reason: 'Notifications are not configured for this build.' }
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return {
      state: 'unsupported',
      // The common case by a distance, and worth saying plainly rather than "not supported".
      reason: 'On iPhone, add Saoirse to your Home Screen first. Safari only allows this there.',
    }
  }

  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return { state: 'denied' }

    const registration = await navigator.serviceWorker.ready
    /*
     * Reuse whatever the browser already has. Subscribing again returns the same endpoint, but
     * only if the key matches — calling `subscribe` with a different key throws rather than
     * replacing, which is the error somebody meets after rotating VAPID keys.
     */
    const existing = await registration.pushManager.getSubscription()
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(key) as BufferSource,
      }))

    const json = subscription.toJSON()
    const p256dh = json.keys?.['p256dh']
    const auth = json.keys?.['auth']
    if (p256dh === undefined || auth === undefined) {
      return { state: 'failed', reason: 'The browser gave a subscription with no keys.' }
    }

    const request = {
      action: 'subscribe_push',
      caseId,
      endpoint: subscription.endpoint,
      p256dh,
      auth,
    } as const
    await callCaseActionApi(request)

    return { state: 'subscribed' }
  } catch (error) {
    return {
      state: 'failed',
      reason: error instanceof Error ? error.message : 'Could not set notifications up.',
    }
  }
}
