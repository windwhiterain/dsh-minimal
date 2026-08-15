/**
 * 持久 shell 的终端层——实现已上移到 comrade-harness-lib（与 bash 同源，单一定义源）。
 * 本文件只保持导出面：PipeTerminal / PipeTerminalConfig / TerminalHandle。
 */
export { PipeTerminal, type PipeTerminalConfig, type TerminalHandle } from 'comrade-harness-lib'
