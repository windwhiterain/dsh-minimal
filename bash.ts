/**
 * dsh-minimal 的 bash 工具入口——实现已上移到 comrade-harness-lib（单一定义源，
 * dsh-minimal 与 standard 共享同一份 bash）。本文件只保持导出面，模型可见层
 * （描述 / 参数 schema / 错误消息 / 退出码格式）逐字不变，由 lib 的 PRESET_DESCRIPTION 保证。
 */
export {
  createBashTool,
  bashPackage,
  translateWindowsPaths,
  PRESET_DESCRIPTION,
  type BashToolConfig,
} from 'comrade-harness-lib'
