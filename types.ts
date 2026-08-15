/**
 * dsh-minimal 的契约类型——复用 comrade-harness-lib 的定义（bash 上移后本包依赖 lib，
 * 类型同构，单一定义源）。导出面保持：
 * ```ts
 * import { minimalTools, PERSONA_TEXT } from "dsh-minimal"
 * import { buildSystemPrompt, runTools, toolsCore } from "comrade-harness-lib"
 * const tools = [...toolsCore(), ...minimalTools()]  // 类型上直接兼容
 * const system = `${PERSONA_TEXT}\n\n${buildSystemPrompt(coreId, immutable)}`
 * ```
 */
export { toToolDef, toToolPackage } from 'comrade-harness-lib'
export type {
  Tool,
  ToolDef,
  ToolPackage,
  ToolParameter,
  ToolResult,
} from 'comrade-harness-lib'
