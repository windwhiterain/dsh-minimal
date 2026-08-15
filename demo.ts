/**
 * dsh-minimal 演示（库消费形态）：persona 文本 + 两个 ToolPackage，
 * 与 comrade-harness-lib 的 runTools 同款消费方式（exec 收原始 JSON 字符串）。
 * 跑法：bun demo.ts
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { minimalTools, PERSONA_TEXT } from './index'
import type { ToolPackage } from './types'

/** 模拟 comrade-harness-lib 的 runTools：按名字找包、调 exec。 */
async function runTool(packages: ToolPackage[], name: string, args: unknown): Promise<string> {
  const pkg = packages.find(p => p.tools.some(t => t.function.name === name))
  const result = await pkg!.exec(name, JSON.stringify(args))
  return result.kind === 'result' ? result.text : result.message
}

const work = mkdtempSync(join(tmpdir(), 'dsh-minimal-demo-'))
const cwd = join(work, 'workspace')
mkdirSync(cwd, { recursive: true })

const packages = minimalTools({ cwd })
const bash = packages.find(p => p.name === 'dsh-minimal-bash')!
const editor = packages.find(p => p.name === 'dsh-minimal-editor')!

try {
  console.log('== role（system prompt 的 persona 段）==')
  console.log(PERSONA_TEXT)
  console.log()
  console.log('== 工具 schema（ToolDef，与 comrade-harness-lib 同形）==')
  for (const pkg of packages) {
    for (const def of pkg.tools) {
      console.log(`- ${def.function.name}: ${def.function.description.split('\n')[0]}`)
      console.log(`  parameters: ${JSON.stringify(def.function.parameters)}`)
    }
  }

  const file = join(cwd, 'hello.txt')
  console.log()
  console.log('== str_replace_editor: create ==')
  console.log(await runTool(packages, 'str_replace_editor', { command: 'create', path: file, file_text: 'alpha\nbeta\ngamma\n' }))

  console.log()
  console.log('== str_replace_editor: view ==')
  console.log(await runTool(packages, 'str_replace_editor', { command: 'view', path: file }))

  console.log()
  console.log('== str_replace_editor: str_replace (beta → BETA!) ==')
  console.log(await runTool(packages, 'str_replace_editor', { command: 'str_replace', path: file, old_str: 'beta', new_str: 'BETA!' }))

  console.log()
  console.log('== 参数不是合法 JSON（exec 的错误路径）==')
  const result = await editor.exec('str_replace_editor', '{not json')
  console.log(result.kind === 'result' ? result.text : result.message)

  console.log()
  console.log('== bash: pwd ==')
  console.log(await runTool(packages, 'bash', { command: 'pwd' }))

  console.log()
  console.log('== bash: 状态跨调用持久（export 后下一条仍可见） ==')
  console.log(await runTool(packages, 'bash', { command: 'export DSH_DEMO=42; echo "set: $DSH_DEMO"' }))
  console.log(await runTool(packages, 'bash', { command: 'echo "still: $DSH_DEMO"' }))

  console.log()
  console.log('== bash: 退出码标记 ==')
  console.log(await runTool(packages, 'bash', { command: 'false' }))

  console.log()
  console.log('== bash: 超时 → 部分输出 + shell 重置 ==')
  const timed = minimalTools({ cwd, bashTimeoutMs: 1500 })
  const timedBash = timed.find(p => p.name === 'dsh-minimal-bash')!
  console.log(await runTool(timed, 'bash', { command: 'echo start; sleep 5; echo end' }))
  await timedBash.dispose?.()
} finally {
  // 释放持久 shell（否则子进程的 stdio 监听会挂住事件循环）。
  await bash.dispose?.()
  rmSync(work, { recursive: true, force: true })
}
