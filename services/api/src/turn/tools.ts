import type { ToolExecutor } from '@shared/llm/saoirse.ts'
import type { ToolName } from '@shared/llm/tools.ts'
import type { ToolContext, ToolModule } from './tools/_shared.ts'
import { TOOL_MODULES } from './tools/index.ts'

export type { ToolContext } from './tools/_shared.ts'

/**
 * Executes a validated tool call against the case. Dispatch only: each tool's rules sit in its
 * own module under `tools/`, and `tools/index.ts` is the registry.
 *
 * The input has already been checked against the tool's Zod schema by `validateToolCall` in
 * `runSaoirseTurn` before a call reaches here, so it is handed to the module as it arrived.
 */
export function createToolExecutor(context: ToolContext): ToolExecutor {
  return async (name, input) => {
    if (!Object.prototype.hasOwnProperty.call(TOOL_MODULES, name)) {
      return { result: 'That is not available yet.' }
    }

    // TypeScript cannot follow a lookup by a runtime name back to that module's own input type.
    const tool = TOOL_MODULES[name] as ToolModule<ToolName>
    return tool.run(input as never, context)
  }
}
