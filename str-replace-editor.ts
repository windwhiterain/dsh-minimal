/**
 * `str_replace_editor` 工具（上游 dsh-tool-str-replace-editor 的独立移植）。
 *
 * 四个命令：view / create / str_replace / insert。语义与模型可见文本
 * （描述、参数、错误消息、裁剪标记）逐字对齐上游；path 必须是绝对路径。
 * 版本守卫（读后写）保证并发下不覆盖别人改过的文件。
 */

import { isAbsolute } from 'node:path'
import type { FsInfo, FsTarget } from './workspace'
import { WorkspaceFs } from './workspace'
import type { Tool, ToolPackage } from './types'
import { toToolPackage } from './types'
import { FsError } from './fs-error'

const TRUNCATED_MESSAGE = '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with `grep -n` in order to find the line numbers of what you are looking for.</NOTE>'

const DEFAULT_DESCRIPTION = `
Custom editing tool for viewing, creating and editing files
* State is persistent across command calls and discussions with the user
* If \`path\` is a file, \`view\` displays the result of applying \`cat -n\`. If \`path\` is a directory, \`view\` lists non-hidden files and directories up to 2 levels deep
* The \`create\` command cannot be used if the specified \`path\` already exists as a file
* If a \`command\` generates a long output, it will be truncated and marked with \`<response clipped>\`

Notes for using the \`str_replace\` command:
* The \`old_str\` parameter should match EXACTLY one or more consecutive lines from the original file. Be mindful of whitespaces!
* If the \`old_str\` parameter is not unique in the file, the replacement will not be performed. Make sure to include enough context in \`old_str\` to make it unique
* The \`new_str\` parameter should contain the edited lines that should replace the \`old_str\`
`.trim()

/** `str_replace_editor` 的配置。 */
export interface StrReplaceEditorToolConfig {
  /** 文件系统根（解析基准，非沙箱边界；缺省 process.cwd()）。 */
  cwd?: string
  /** 单次返回的最大字符数（缺省 16000，超长以 `<response clipped>` 截断）。 */
  maxOutputChars?: number
  /** 模型可见的工具描述（缺省为上游 DEFAULT_DESCRIPTION）。 */
  description?: string
}

function maybeTruncate(content: string, maxOutputChars: number): string {
  return content.length <= maxOutputChars
    ? content
    : content.slice(0, maxOutputChars) + TRUNCATED_MESSAGE
}

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function matchOffsets(content: string, search: string): number[] {
  const offsets: number[] = []
  let offset = 0
  while (true) {
    const match = content.indexOf(search, offset)
    if (match < 0) return offsets
    offsets.push(match)
    offset = match + search.length
  }
}

function lineNumbersAt(content: string, offsets: readonly number[]): number[] {
  let line = 1
  let cursor = 0
  return offsets.map((offset) => {
    while (cursor < offset) {
      if (content[cursor] === '\n') line += 1
      cursor += 1
    }
    return line
  })
}

async function resolveTarget(ws: WorkspaceFs, path: string): Promise<FsTarget> {
  if (path.trim().length === 0) throw new Error('path must be a non-empty string')
  if (!isAbsolute(path)) {
    throw new Error(`The path ${path} is not an absolute path, it should start with \`/\`. Maybe you meant /${path}?`)
  }
  return ws.resolve(path)
}

async function statExisting(
  ws: WorkspaceFs,
  target: FsTarget,
  command: 'view' | 'str_replace' | 'insert',
): Promise<FsInfo> {
  const info = await ws.stat(target)
  if (info === undefined) {
    throw new FsError(
      `The path ${target.displayPath} does not exist. Please provide a valid path.`,
      'FS_NOT_FOUND',
    )
  }
  if (info.type === 'directory' && command !== 'view') {
    throw new FsError(
      `The path ${target.displayPath} is a directory and only the \`view\` command can be used on directories`,
      'FS_NOT_REGULAR_FILE',
    )
  }
  return info
}

function requiredForCommand(
  value: string | undefined,
  parameter: string,
  command: string,
  allowEmpty = true,
): string {
  if (value === undefined) throw new Error(`Parameter \`${parameter}\` is required for command: ${command}`)
  if (!allowEmpty && value.length === 0) {
    throw new Error(`Parameter \`${parameter}\` is empty for command: ${command}`)
  }
  return value
}

function formatFileView(
  path: string,
  content: string,
  maxOutputChars: number,
  viewRange?: number[],
): string {
  const allLines = content.split('\n')
  let lines = allLines
  let initialLine = 1
  let finalLine: number | undefined
  let prompt = `Here's the content of ${path} with line numbers (which has a total of ${allLines.length} lines)`
  if (viewRange !== undefined) {
    const [requestedInitialLine, requestedFinalLine] = viewRange
    if (
      viewRange.length !== 2
      || requestedInitialLine === undefined
      || requestedFinalLine === undefined
      || !viewRange.every(Number.isInteger)
    ) {
      throw new Error('Invalid `view_range`. It should be a list of two integers.')
    }
    initialLine = requestedInitialLine
    finalLine = requestedFinalLine
    if (initialLine < 1 || initialLine > allLines.length) {
      throw new Error(
        `Invalid \`view_range\`: [${viewRange.join(', ')}]. Its first element \`${initialLine}\` should be within the range of lines of the file: [1, ${allLines.length}]`,
      )
    }
    if (finalLine > allLines.length) {
      throw new Error(
        `Invalid \`view_range\`: [${viewRange.join(', ')}]. Its second element \`${finalLine}\` should be smaller than the number of lines in the file: \`${allLines.length}\``,
      )
    }
    if (finalLine !== -1 && finalLine < initialLine) {
      throw new Error(
        `Invalid \`view_range\`: [${viewRange.join(', ')}]. Its second element \`${finalLine}\` should be larger or equal than its first \`${initialLine}\``,
      )
    }
    lines = finalLine === -1
      ? allLines.slice(initialLine - 1)
      : allLines.slice(initialLine - 1, finalLine)
    prompt += ` with view_range=[${initialLine}, ${finalLine}]`
  }
  const numbered = lines
    .map((line, index) => `${String(initialLine + index).padStart(6, ' ')}  ${line}`)
    .join('\n')
  return maybeTruncate(`${prompt}:\n${numbered}\n`, maxOutputChars)
}

async function listDirectory(
  ws: WorkspaceFs,
  target: FsTarget,
  maxOutputChars: number,
): Promise<string> {
  async function visit(dir: FsTarget, depth: number): Promise<string[]> {
    const entries = await ws.listDir(dir)
    const rows: string[] = []
    for (const entry of entries.filter(candidate =>
      !candidate.name.startsWith('.')
      && candidate.name !== 'node_modules'
      && candidate.name !== '__pycache__')) {
      const type = entry.type === 'directory' ? 'd' : entry.type === 'file' ? 'f' : '?'
      rows.push(`${type}\t${entry.target.displayPath}`)
      if (entry.type === 'directory' && depth < 2) {
        rows.push(...await visit(entry.target, depth + 1))
      }
    }
    return rows
  }
  const rows = [`d\t${target.displayPath}`, ...await visit(target, 1)]
  rows.sort((left, right) => {
    const leftPath = left.slice(left.indexOf('\t') + 1)
    const rightPath = right.slice(right.indexOf('\t') + 1)
    return codepointCompare(leftPath, rightPath)
  })
  const listing = maybeTruncate(rows.join('\n') + '\n', maxOutputChars)
  return `Here're the files and directories up to 2 levels deep in ${target.displayPath}, excluding hidden items, node_modules, and Python cache directories:\n${listing}\n`
}

async function viewPath(
  ws: WorkspaceFs,
  path: string,
  viewRange: number[] | undefined,
  maxOutputChars: number,
): Promise<string> {
  const target = await resolveTarget(ws, path)
  const info = await statExisting(ws, target, 'view')
  if (info.type === 'directory') {
    if (viewRange !== undefined) {
      throw new Error('The `view_range` parameter is not allowed when `path` points to a directory.')
    }
    return listDirectory(ws, target, maxOutputChars)
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot view "${target.displayPath}": not a regular file or directory`, 'FS_NOT_REGULAR_FILE')
  }
  const content = await ws.readText(target)
  return formatFileView(target.displayPath, content, maxOutputChars, viewRange)
}

async function createFile(
  ws: WorkspaceFs,
  path: string,
  fileText: string | undefined,
): Promise<string> {
  const content = requiredForCommand(fileText, 'file_text', 'create')
  const target = await resolveTarget(ws, path)
  if (await ws.stat(target) !== undefined) {
    throw new Error(`File already exists at: ${target.displayPath}. Cannot overwrite files using command \`create\`.`)
  }
  await ws.writeText(target, content, { kind: 'createIfAbsent' })
  return `New file created successfully at: ${target.displayPath}`
}

async function replaceInFile(
  ws: WorkspaceFs,
  path: string,
  oldStr: string | undefined,
  newStr: string | undefined,
): Promise<string> {
  const target = await resolveTarget(ws, path)
  const oldValue = requiredForCommand(oldStr, 'old_str', 'str_replace', false)
  const newValue = newStr ?? ''
  const info = await statExisting(ws, target, 'str_replace')
  if (info.type !== 'file') {
    throw new FsError(`cannot edit "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  const before = await ws.readText(target)
  const offsets = matchOffsets(before, oldValue)
  const offset = offsets[0]
  if (offset === undefined) {
    throw new FsError(
      `No replacement was performed, old_str \`${oldValue}\` did not appear verbatim in ${target.displayPath}.`,
      'FS_EDIT_NOT_FOUND',
    )
  }
  if (offsets.length > 1) {
    const lines = lineNumbersAt(before, offsets)
    throw new FsError(
      `No replacement was performed. Multiple occurrences of old_str \`${oldValue}\` in lines [${lines.join(', ')}]. Please ensure it is unique`,
      'FS_AMBIGUOUS_EDIT',
    )
  }
  await ws.writeText(
    target,
    before.slice(0, offset) + newValue + before.slice(offset + oldValue.length),
    { kind: 'replaceIfVersion', version: info.version },
  )
  return `The file ${target.displayPath} has been edited successfully.`
}

async function insertInFile(
  ws: WorkspaceFs,
  path: string,
  insertLine: number | undefined,
  newStr: string | undefined,
): Promise<string> {
  if (insertLine === undefined) throw new Error('Parameter `insert_line` is required for command: insert')
  const value = requiredForCommand(newStr, 'new_str', 'insert')
  const target = await resolveTarget(ws, path)
  const info = await statExisting(ws, target, 'insert')
  if (info.type !== 'file') {
    throw new FsError(`cannot insert into "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  const before = await ws.readText(target)
  const lines = before.split('\n')
  if (!Number.isInteger(insertLine) || insertLine < 0 || insertLine > lines.length) {
    throw new Error(
      `Invalid \`insert_line\` parameter: ${insertLine}. It should be within the range of lines of the file: [0, ${lines.length}]`,
    )
  }
  const after = [
    ...lines.slice(0, insertLine),
    ...value.split('\n'),
    ...lines.slice(insertLine),
  ].join('\n')
  await ws.writeText(target, after, { kind: 'replaceIfVersion', version: info.version })
  return `The file ${target.displayPath} has been edited successfully.`
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function asIntegerArray(value: unknown): number[] | undefined {
  return Array.isArray(value) && value.every(item => Number.isInteger(item))
    ? value as number[]
    : undefined
}

/** 创建一个 `str_replace_editor` 工具（极简模式的第二个工具）。 */
export function createStrReplaceEditorTool(config: StrReplaceEditorToolConfig = {}): Tool {
  const maxOutputChars = config.maxOutputChars ?? 16_000
  const description = config.description ?? DEFAULT_DESCRIPTION
  if (!Number.isSafeInteger(maxOutputChars) || maxOutputChars <= 0) {
    throw new Error('str_replace_editor: maxOutputChars must be a positive safe integer')
  }
  if (description.trim().length === 0) {
    throw new Error('str_replace_editor: description must be non-empty')
  }
  const ws = new WorkspaceFs(config.cwd ?? process.cwd())

  return {
    name: 'str_replace_editor',
    description,
    parameters: {
      command: {
        type: 'string',
        required: true,
        enum: ['view', 'create', 'str_replace', 'insert'],
        description: 'The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`.',
      },
      path: {
        type: 'string',
        required: true,
        description: 'Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`.',
      },
      file_text: {
        type: 'string',
        description: 'Required parameter of `create` command, with the content of the file to be created.',
      },
      insert_line: {
        type: 'integer',
        description: 'Required parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`.',
      },
      new_str: {
        type: 'string',
        description: 'Optional parameter of `str_replace` command containing the new string (if not given, no string will be added). Required parameter of `insert` command containing the string to insert.',
      },
      old_str: {
        type: 'string',
        description: 'Required parameter of `str_replace` command containing the string in `path` to replace.',
      },
      view_range: {
        type: 'array',
        items: { type: 'integer' },
        description: 'Optional parameter of `view` command when `path` points to a file. If none is given, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file.',
      },
    },
    async execute(args) {
      const command = asString(args.command)
      if (command === undefined) throw new Error('Parameter `command` is required')
      const path = asString(args.path)
      if (path === undefined) throw new Error('Parameter `path` is required')
      const viewRange = asIntegerArray(args.view_range)
      switch (command) {
        case 'view':
          return viewPath(ws, path, viewRange, maxOutputChars)
        case 'create':
          return createFile(ws, path, asString(args.file_text))
        case 'str_replace':
          return replaceInFile(ws, path, asString(args.old_str), asString(args.new_str))
        case 'insert':
          return insertInFile(ws, path, asInteger(args.insert_line), asString(args.new_str))
        default:
          throw new Error(`Unknown command: ${command}. Allowed options are: \`view\`, \`create\`, \`str_replace\`, \`insert\`.`)
      }
    },
  }
}

/** 把 `str_replace_editor` 工具包成 ToolPackage（comrade-harness 子 harness 直接 import 用）。 */
export function editorPackage(config: StrReplaceEditorToolConfig = {}): ToolPackage {
  return toToolPackage('dsh-minimal-editor', createStrReplaceEditorTool(config))
}
