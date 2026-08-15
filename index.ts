/**
 * dsh-minimal——deepseek-harness「极简模式」的组件库（library）。
 *
 * 被 comrade-harness 的子 harness（core 的 src/index.ts 数据流）import：
 * - **system prompt（role）**：`PERSONA_TEXT` —— 完整 persona 文本
 *   （上游 `complete: true` 语义：极简模式的 system prompt 就是这一句）；
 * - **tools**：`bashPackage()` / `editorPackage()` —— 两个 ToolPackage
 *   （与 comrade-harness-lib 的 ToolPackage 结构兼容，`runTools` 直接消费）。
 *
 * 组合发生在流的代码里（资源加载 + 数据流自定义）：
 * ```ts
 * import { minimalTools, PERSONA_TEXT } from "dsh-minimal"
 * import { buildSystemPrompt, toolsCore } from "comrade-harness-lib"
 *
 * const system = `${PERSONA_TEXT}\n\n${buildSystemPrompt(coreId, immutable)}`
 * const tools = [...toolsCore(), ...minimalTools({ cwd: CORE_DIR })]
 * ```
 *
 * 模型可见的一切（描述、参数 schema、错误消息、裁剪标记、退出码格式）
 * 逐字对齐上游；运行时零 npm 依赖。
 *
 * 2026-08-15 起依赖 comrade-harness-lib：持久 bash 与 terminal 的实现上移到 lib
 * （单一定义源，dsh-minimal 与 standard 共享），本包 re-export 并保持导出面。
 */

import { createBashTool } from './bash'
import { bashPackage } from './bash'
import { createStrReplaceEditorTool } from './str-replace-editor'
import { editorPackage } from './str-replace-editor'
import type { ToolPackage } from './types'

export {
  SYSTEM_PROMPT,
  PERSONA_TEXT,
  PERSONA_SECTION,
  PERSONA_ORDER,
  buildPersona,
} from './system-prompt'
export { createBashTool, bashPackage, PRESET_DESCRIPTION, type BashToolConfig } from './bash'
export {
  createStrReplaceEditorTool,
  editorPackage,
  type StrReplaceEditorToolConfig,
} from './str-replace-editor'
export { WorkspaceFs, FsVersion } from './workspace'
export type {
  FsInfo,
  FsTarget,
  FsWriteIntent,
  FsWriteOutcome,
  FsDirEntry,
} from './workspace'
export { FsError, type FsErrorCode } from './fs-error'
export { PipeTerminal, type PipeTerminalConfig, type TerminalHandle } from './terminal'
export { toToolDef, toToolPackage } from './types'
export type {
  Tool,
  ToolDef,
  ToolPackage,
  ToolParameter,
  ToolResult,
} from './types'

/** 极简模式双工具的整体配置。 */
export interface MinimalToolsConfig {
  /** 工作目录（bash 与文件工具的公共根；缺省 process.cwd()）。 */
  cwd?: string
  /** bash 的 shell 可执行文件（缺省 `bash`）。 */
  shellPath?: string
  /** bash 单条命令超时（缺省 300000）。 */
  bashTimeoutMs?: number
  /** bash 输出裁剪上限（缺省 16000）。 */
  bashMaxOutputChars?: number
  /** str_replace_editor 输出裁剪上限（缺省 16000）。 */
  editorMaxOutputChars?: number
  /** bash 的模型可见描述（缺省为极简模式 preset 描述）。 */
  bashDescription?: string
  /** str_replace_editor 的模型可见描述（缺省为上游 DEFAULT_DESCRIPTION）。 */
  editorDescription?: string
}

/**
 * 极简模式的两个工具包：`dsh-minimal-bash`（持久 bash）+ `dsh-minimal-editor`
 * （str_replace_editor）。与 `toolsCore()` 返回的包直接拼数组交给 `runTools`。
 */
export function minimalTools(config: MinimalToolsConfig = {}): ToolPackage[] {
  return [
    bashPackage({
      cwd: config.cwd,
      shellPath: config.shellPath,
      timeoutMs: config.bashTimeoutMs,
      maxOutputChars: config.bashMaxOutputChars,
      description: config.bashDescription,
    }),
    editorPackage({
      cwd: config.cwd,
      maxOutputChars: config.editorMaxOutputChars,
      description: config.editorDescription,
    }),
  ]
}
