import * as Sentry from '@sentry/react'
import { env } from '@/lib/env'

/**
 * Never send message content or fact values (CLAUDE.md > Sentry). Only structural
 * tags: case id, participant role, gate category.
 *
 * Sentry 11 replaced `sendDefaultPii` with granular `dataCollection`, whose defaults are
 * PERMISSIVE — HTTP bodies, stack-frame locals and gen-AI inputs/outputs are collected
 * unless switched off. Every category is therefore denied explicitly below. Anything
 * added to this object should default to "off" for this project.
 */
const DENY_ALL_CONTENT = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  // Request/response bodies carry conversation turns and fact values.
  httpBodies: [],
  // URLs carry opaque handoff and notification tokens (§29, §58).
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  // Locals in a Saoirse turn hold message text.
  stackFrameVariables: false,
  genAI: { inputs: false, outputs: false },
} as const satisfies NonNullable<Parameters<typeof Sentry.init>[0]>['dataCollection']

export function initSentry(): void {
  const dsn = env?.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.2,
    dataCollection: DENY_ALL_CONTENT,
    beforeBreadcrumb: (breadcrumb) => {
      // Console breadcrumbs can carry conversation text.
      if (breadcrumb.category === 'console') return null
      return breadcrumb
    },
  })
}

export type SentryContext = {
  caseId?: string
  participantRole?: 'customer' | 'partner' | 'admin' | 'audience'
  gateCategory?: string
}

export function setSentryContext(context: SentryContext): void {
  if (context.caseId !== undefined) Sentry.setTag('case_id', context.caseId)
  if (context.participantRole !== undefined) {
    Sentry.setTag('participant_role', context.participantRole)
  }
  if (context.gateCategory !== undefined) Sentry.setTag('gate_category', context.gateCategory)
}
