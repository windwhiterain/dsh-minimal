/**
 * 极简模式的 system prompt（role）。
 *
 * 上游语义（apps/cli/config/agent-presets/minimal/agent.cordis.yml）：
 * `dsh-persona` 以 `complete: true` 注册 persona 段落——它是**完整的**
 * system prompt，压掉 global identity / Web orientation / tool guidance
 * 等所有其他段落；`includeRuntimeContext: false` 同时禁止动态运行时
 * 上下文快照。因此极简模式的整份 system prompt 就是这一句话，没有
 * 环境信息、没有工具指南、没有历史注入。
 */

/** 极简模式的完整 persona 文本（即完整 system prompt）。 */
export const PERSONA_TEXT = 'You are a helpful software engineer assistant.'

/** 上游注册段落名（dsh-system-prompt 的 PERSONA_SECTION）。 */
export const PERSONA_SECTION = 'deployment:persona'

/** 上游注册顺序（PERSONA_ORDER，作为唯一段落无实际意义）。 */
export const PERSONA_ORDER = 0

/**
 * 构造极简模式的完整 persona 文本。
 * 与上游 `complete: true` 一致：除 persona 外不附加任何段落。
 * 传入自定义 text 可改身份，但保持「唯一段落」的语义。
 *
 * 命名与 comrade-harness-lib 的 `buildSystemPrompt(coreId, immutable)`
 * 区分开（后者生成 harness 运行契约）；core 的流里两者都 import 时不撞名，
 * 组合方式见 index.ts 顶部注释。
 */
export function buildPersona(text: string = PERSONA_TEXT): string {
  return text
}

/** 极简模式的 system prompt（完整 persona，无其他段落）。 */
export const SYSTEM_PROMPT = buildPersona()
