/**
 * Saves the worked example plan through the live `POST /api/plans`, as `saoi_save_plan` will,
 * and prints the claim link. For trying the app side of the handoff before the MCP tools exist.
 *
 *   npm run plan:sample                          # against https://api.saoi.ie
 *   SAOI_API_URL=http://127.0.0.1:3000 npm run plan:sample
 *
 * The link works once, for seven days. Opening it creates a conversation (or uses an empty one
 * the browser already has); tag that case as test from the console afterwards (Audience in
 * CLAUDE.md), so a probe does not count against the day's cap.
 */
import { exampleMarketPlan } from '../../supabase/functions/_shared/contracts/market-plan.example.ts'
import { savePlanResponseSchema } from '../../supabase/functions/_shared/contracts/market-plan.ts'

const api = (process.env['SAOI_API_URL'] ?? 'https://api.saoi.ie').replace(/\/+$/, '')

const response = await fetch(`${api}/api/plans`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ plan: exampleMarketPlan(new Date()), client: 'sample' }),
})
const body: unknown = await response.json()

if (response.status !== 201) {
  console.error(`POST ${api}/api/plans answered ${String(response.status)}:`)
  console.error(JSON.stringify(body, null, 2))
  process.exit(1)
}

const saved = savePlanResponseSchema.parse(body)
console.log(saved.claimUrl)
console.error(`expires ${saved.expiresAt}`)
