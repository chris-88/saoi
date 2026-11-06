import type { AdminAccessStore } from './access.ts'
import type { AdminCasesStore } from './cases.ts'
import type { AdminCatalogueStore } from './catalogue.ts'
import type { AdminConfigStore } from './config.ts'
import type { AdminFormsStore } from './forms.ts'
import type { AdminInspectStore } from './inspect.ts'
import type { AdminOverviewStore } from './overview.ts'
import type { AdminPushStore } from './push.ts'
import type { AdminSimulateStore } from './simulate.ts'

/**
 * Everything the admin API reads and writes, one store per family. The routes reach it as
 * `c.get('admin')`. Each store is a typed interface plus a Supabase implementation, and none
 * of them imports Hono. Tests replace whole stores with fakes.
 */
export type AdminStores = {
  readonly access: AdminAccessStore
  readonly cases: AdminCasesStore
  readonly catalogue: AdminCatalogueStore
  readonly config: AdminConfigStore
  readonly forms: AdminFormsStore
  readonly inspect: AdminInspectStore
  readonly overview: AdminOverviewStore
  readonly push: AdminPushStore
  readonly simulate: AdminSimulateStore
}
