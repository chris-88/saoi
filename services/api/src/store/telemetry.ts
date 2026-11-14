import type { McpCall } from '@shared/contracts/telemetry.ts'
import type { Db } from './client.ts'

/**
 * The AI usage record (`mcp_calls`): one row per call to the Saoi MCP server, written by
 * `POST /api/telemetry/mcp`. One insert and no reads, so the MCP server's post stays cheap.
 */
export type TelemetryStore = {
  record(call: McpCall): Promise<void>
}

export function supabaseTelemetryStore(db: Db): TelemetryStore {
  return {
    async record(call) {
      const result = await db.from('mcp_calls').insert({
        kind: call.kind,
        name: call.name,
        host: call.host,
        user_agent: call.userAgent,
        client_name: call.clientName,
        client_version: call.clientVersion,
        session_key: call.sessionKey,
        outcome: call.outcome,
        ms: call.ms,
        card: call.card,
        gate_missing: call.gateMissing,
        asked: call.asked,
        saved_plan_id: call.savedPlanId,
        plan_saved: call.savedPlanId !== null,
      })
      if (result.error) throw new Error(`Could not record the call: ${result.error.message}`)
    },
  }
}
