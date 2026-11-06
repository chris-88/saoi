import type { Db } from '../client.ts'
import { supabaseAccessStore } from './access.ts'
import { supabaseAdminCasesStore } from './cases.ts'
import { supabaseAdminCatalogueStore } from './catalogue.ts'
import { supabaseAdminConfigStore } from './config.ts'
import type { AdminExternals } from './externals.ts'
import { supabaseAdminFormsStore } from './forms.ts'
import type { AdminStores } from './index.ts'
import { supabaseAdminInspectStore } from './inspect.ts'
import { supabaseAdminOverviewStore } from './overview.ts'
import { supabaseAdminPushStore } from './push.ts'
import { supabaseAdminSimulateStore } from './simulate.ts'

/** Every admin store over one service-role client. `server.ts` and the integration harness call this. */
export function createAdminStores(db: Db, externals: AdminExternals): AdminStores {
  return {
    access: supabaseAccessStore(db),
    cases: supabaseAdminCasesStore(db),
    catalogue: supabaseAdminCatalogueStore(db),
    config: supabaseAdminConfigStore(db, externals),
    forms: supabaseAdminFormsStore(db),
    inspect: supabaseAdminInspectStore(db),
    overview: supabaseAdminOverviewStore(db),
    push: supabaseAdminPushStore(db, externals),
    simulate: supabaseAdminSimulateStore(db),
  }
}
