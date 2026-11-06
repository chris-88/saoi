import { createHash, randomUUID } from 'node:crypto'
import { mustWrite, writeEvent } from '@shared/db/case-repository.ts'
import { sendPush } from '@shared/push/webpush.ts'
import { ApiError } from '../../errors.ts'
import type { Db } from '../client.ts'
import type { AdminExternals } from './externals.ts'

export type PushSender = typeof sendPush

export interface AdminPushStore {
  /** §35, §42: a notification to every browser the case has subscribed. */
  sendNotification(input: {
    caseId: string
    title?: string | undefined
    body?: string | undefined
  }): Promise<{ message: string; url: string; subscriptions: number; delivered: number }>
}

export function supabaseAdminPushStore(
  db: Db,
  externals: AdminExternals,
  send: PushSender = sendPush,
): AdminPushStore {
  return {
    async sendNotification({ caseId, title: askedTitle, body }) {
      const vapid = externals.vapid
      if (vapid === undefined) {
        throw new ApiError('upstream_unavailable', 'Push is not configured.')
      }

      // §58: the link carries an opaque single-use code, never anything about the case.
      const code = randomUUID().replaceAll('-', '')
      const hash = createHash('sha256').update(code).digest('hex')

      const participant = await db
        .from('participants')
        .select('id')
        .eq('case_id', caseId)
        .eq('role', 'primary')
        .maybeSingle()

      mustWrite(
        await db.from('tokens').insert({
          case_id: caseId,
          kind: 'notification',
          token_hash: hash,
          participant_id: participant.data?.id ?? null,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
        'the link',
      )

      const url = `${externals.appBaseUrl}/#/?n=${code}`

      // §35: the default says nothing about the application; a presenter may override it.
      const title = askedTitle ?? 'Saoirse'
      const message =
        body ??
        'Saoirse has an update about something you’re working on with us. Open Saoirse to pick it up.'

      const subscriptions = await db
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .eq('case_id', caseId)
        .is('expired_at', null)

      const targets = subscriptions.data ?? []

      let delivered = 0
      for (const target of targets) {
        const result = await send(
          { endpoint: target.endpoint, p256dh: target.p256dh, auth: target.auth },
          { title, body: message, url },
          vapid,
        )

        if (result.ok) delivered += 1
        // A push service saying the subscription is gone is the only reliable signal.
        if (result.gone) {
          mustWrite(
            await db
              .from('push_subscriptions')
              .update({ expired_at: new Date().toISOString() })
              .eq('id', target.id),
            'the push subscription',
          )
        }
      }

      await writeEvent(db, {
        caseId,
        type: 'notification_sent',
        actor: 'admin',
        payload: {
          channel: 'push',
          subscriptions: targets.length,
          delivered,
          title,
          body: message,
        },
      })

      return { message, url, subscriptions: targets.length, delivered }
    },
  }
}
