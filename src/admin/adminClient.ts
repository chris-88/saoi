import {
  mortgageRatesListSchema,
  productCatalogueListSchema,
  type KnowledgeProductInput,
  type MortgageRateInput,
  type MortgageRatesList,
  type ProductCatalogueList,
} from '@contracts/catalogue.ts'
import {
  catalogueLoadSchema,
  catalogueWriteSchema,
  type CatalogueLoad,
  type CatalogueWrite,
} from '@contracts/admin.ts'
import { callAdminApi } from '@/lib/saoiApi'
import {
  analyticsSchema,
  catalogueOverridesSchema,
  collaboratorListSchema,
  feedbackListSchema,
  guardrailTestSchema,
  personaPreviewSchema,
  purgeResultSchema,
  type Analytics,
  type CatalogueOverrides,
  type GuardrailTest,
  type PersonaPreview,
  type Period,
  type PurgeResult,
} from '@contracts/admin.ts'
import type { z } from 'zod'

type FeedbackList = z.infer<typeof feedbackListSchema>
type CollaboratorList = z.infer<typeof collaboratorListSchema>
import {
  adminCaseSchema,
  adminOverviewSchema,
  notificationSchema,
  type AdminCase,
  type AdminOverview,
  type AdminRequest,
} from '@contracts/admin.ts'

/**
 * Calls to the presenter console.
 *
 * Admin status is checked by the server on every call — being on this screen proves nothing,
 * which matters because the site is on a public URL (§37).
 */
const call = (action: AdminRequest): Promise<unknown> => callAdminApi(action)

export const adminApi = {
  overview: async (period: Period = 'all'): Promise<AdminOverview> =>
    adminOverviewSchema.parse(await call({ action: 'overview', period })),
  inspect: async (caseId: string): Promise<AdminCase> =>
    adminCaseSchema.parse(await call({ action: 'inspect_case', caseId })),
  resetCase: (caseId?: string) =>
    call({ action: 'reset_case', ...(caseId === undefined ? {} : { caseId }) }),
  purgeCases: async (): Promise<PurgeResult> =>
    purgeResultSchema.parse(await call({ action: 'purge_cases' })),
  deleteCase: (caseId: string) => call({ action: 'delete_case', caseId }),
  testGuardrail: async (message: string): Promise<GuardrailTest> =>
    guardrailTestSchema.parse(await call({ action: 'test_guardrail', message })),
  analytics: async (period: Period): Promise<Analytics> =>
    analyticsSchema.parse(await call({ action: 'analytics', period })),

  // §44: what people said about it, and who asked to work on it.
  listFeedback: async (period: Period): Promise<FeedbackList> =>
    feedbackListSchema.parse(await call({ action: 'list_feedback', period })),
  listCollaborators: async (): Promise<CollaboratorList> =>
    collaboratorListSchema.parse(await call({ action: 'list_collaborators' })),
  catalogueOverrides: async (): Promise<CatalogueOverrides> =>
    catalogueOverridesSchema.parse(await call({ action: 'catalogue_overrides' })),

  // §51 — the product catalogue and the mortgage rate table, editable.
  listProducts: async (): Promise<ProductCatalogueList> =>
    productCatalogueListSchema.parse(await call({ action: 'list_products' })),
  setProduct: async (
    id: string,
    product: KnowledgeProductInput,
    enabled: boolean,
  ): Promise<CatalogueWrite> =>
    catalogueWriteSchema.parse(await call({ action: 'set_product', id, product, enabled })),
  deleteProduct: (id: string) => call({ action: 'delete_product', id }),
  loadPublishedProducts: async (): Promise<CatalogueLoad> =>
    catalogueLoadSchema.parse(await call({ action: 'load_published_products' })),
  restorePublishedProduct: (id: string) => call({ action: 'restore_published_product', id }),

  listRates: async (): Promise<MortgageRatesList> =>
    mortgageRatesListSchema.parse(await call({ action: 'list_rates' })),
  setRate: async (id: string, rate: MortgageRateInput, enabled: boolean): Promise<CatalogueWrite> =>
    catalogueWriteSchema.parse(await call({ action: 'set_rate', id, rate, enabled })),
  deleteRate: (id: string) => call({ action: 'delete_rate', id }),
  loadPublishedRates: async (): Promise<CatalogueLoad> =>
    catalogueLoadSchema.parse(await call({ action: 'load_published_rates' })),
  restorePublishedRate: (id: string) => call({ action: 'restore_published_rate', id }),
  setCatalogueOverride: (
    edit: Omit<Extract<AdminRequest, { action: 'set_catalogue_override' }>, 'action'>,
  ) => call({ action: 'set_catalogue_override', ...edit }),
  clearCatalogueOverride: (kind: 'goal' | 'need', entryId: string) =>
    call({ action: 'clear_catalogue_override', kind, entryId }),
  previewPersona: async (
    sliders: Extract<AdminRequest, { action: 'preview_persona' }>['sliders'],
    message: string,
  ): Promise<PersonaPreview> =>
    personaPreviewSchema.parse(await call({ action: 'preview_persona', sliders, message })),
  setSavingsBalance: (caseId: string, amount: number) =>
    call({ action: 'set_savings_balance', caseId, amount }) as Promise<{
      amount: number
      seen: number | null
      plansActive: number
      milestonesConsidered: number
      milestonesReached: number
    }>,
  planMove: (
    caseId: string,
    planId: string,
    move: Extract<AdminRequest, { action: 'plan_move' }>['move'],
  ) => call({ action: 'plan_move', caseId, planId, move }),
  reachSavingsTarget: (caseId: string) =>
    call({ action: 'reach_savings_target', caseId }) as Promise<{
      reached: boolean
      target: number | null
    }>,
  verifyDocuments: (caseId: string) =>
    call({ action: 'verify_documents', caseId }) as Promise<{
      verified: number
    }>,
  demoAction: (caseId: string, move: Extract<AdminRequest, { action: 'demo_action' }>['move']) =>
    call({ action: 'demo_action', caseId, move }),
  /** Open banking, simulated: the console is the receiving bank, and this is it settling. */
  settleTransfer: (transferId: string) => call({ action: 'settle_transfer', transferId }),
  setKillSwitch: (enabled: boolean) => call({ action: 'set_kill_switch', enabled }),
  setPersona: (body: Omit<Extract<AdminRequest, { action: 'set_persona' }>, 'action'>) =>
    call({ action: 'set_persona', ...body }),
  simulate: (body: Omit<Extract<AdminRequest, { action: 'simulate_event' }>, 'action'>) =>
    call({ action: 'simulate_event', ...body }),
  notify: async (caseId: string, custom?: { title: string; body: string }) =>
    notificationSchema.parse(
      await call({ action: 'send_notification', caseId, ...(custom ?? {}) }),
    ),

  /**
   * Applications against the bank's own digital form definitions.
   *
   * Typed loosely on purpose. The inspector renders whatever the definition contains, and a
   * schema here would be a second description of a document the bank publishes, kept in step
   * by hand. The server has already validated it against the real definition.
   */
  listFormApplications: () =>
    call({ action: 'list_form_applications' }) as Promise<{
      applications: readonly FormApplicationSummary[]
    }>,

  inspectFormApplication: (formApplicationId: string) =>
    call({ action: 'inspect_form_application', formApplicationId }) as Promise<FormInspection>,

  rebuildFormApplications: () =>
    call({ action: 'rebuild_form_applications' }) as Promise<{
      cases: number
      forms: number
      answered: number
      failed: number
    }>,
}

export type FormApplicationSummary = {
  readonly id: string
  readonly caseId: string
  readonly formId: string
  readonly formVersion: string
  /** Whose application it is: the name on the form, or the participant's own. */
  readonly who: string | null
  readonly answered: number
  readonly reused: number
  readonly updatedAt: string
}

export type SubmissionEntry = {
  readonly key: string
  readonly value: string
  readonly source: 'answer' | 'reused' | 'default' | 'consent' | 'derived' | 'runtime'
  readonly fieldId: string | null
  readonly label: string
  readonly toscana: string | null
  readonly sensitive: boolean
}

export type FormInspection = {
  readonly id: string
  readonly caseId: string
  readonly updatedAt: string
  readonly definition: {
    readonly formId: string
    readonly version: string
    readonly source: string
    readonly retrievedAt: string
    readonly sourceHash: string
    readonly fieldCount: number
    readonly activeCount: number
    readonly questionCount: number
    readonly requiredCount: number
  }
  readonly collected: readonly {
    readonly fieldId: string
    readonly label: string
    readonly type: string
    readonly toscana: string | null
    readonly value: unknown
    readonly reused: boolean
    readonly givenDirectly: string | null
  }[]
  /** What the form works out for itself, and how honest each answer is. */
  readonly calculations: readonly {
    readonly fieldId: string
    readonly control: string
    readonly label: string
    readonly fidelity: 'source_faithful' | 'fixture' | 'unsupported'
    readonly note: string
    readonly parameters: Readonly<Record<string, string | number>>
    readonly result: string | number | null
  }[]
  /** Which published rate a quote was computed at, when one was. */
  readonly rateBasis: string | null
  /** Limits the document states for itself. Not a credit decision. */
  readonly limits: readonly {
    readonly label: string
    readonly comparedField: string
    readonly operator: string
    readonly limit: string
    readonly actual: number
  }[]
  readonly consents: readonly {
    readonly fieldId: string
    readonly wording: string
    readonly agreedAt: string
  }[]
  readonly documents: readonly {
    readonly fieldId: string
    readonly fileName: string
    readonly sizeBytes: number | null
    readonly attachedAt: string
    readonly signatures: string
  }[]
  readonly outstanding: readonly {
    readonly fieldId: string
    readonly label: string
    readonly type: string
  }[]
  readonly submission: {
    readonly target: string
    readonly method: string
    readonly encoding: string
    readonly formId: string
    readonly formVersion: string
    readonly entries: readonly SubmissionEntry[]
    readonly generatedAt: string
    readonly status: 'GENERATED_NOT_SENT'
    readonly externalRequestMade: false
  }
}
