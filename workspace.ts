/**
 * 极简模式的文件系统层（上游 dsh-fs-local 的独立移植）。
 *
 * 语义对齐上游：
 * - **身份**：targetKey 优先取 realpath（符号链接别名共享同一把锁/版本守卫），
 *   文件不存在时沿最近存在的祖先 realpath 后接缺失后缀，保证 key 在创建期间稳定；
 * - **版本**：`dev:ino:size:mtimeNs:ctimeNs`（bigint stat），str_replace_editor
 *   靠它做「读后写」的过期守卫（FS_STALE_VERSION）；
 * - **写入**：同目录临时文件 + rename 原子发布，per-target FIFO 锁串行化
 *   读→守卫→写窗口；
 * - **cwd 只是解析基准，不是沙箱边界**（与上游一致：沙箱是宿主策略，独立
 *   移植不带）。
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute, join, dirname, basename, resolve, relative, sep } from 'node:path'
import { realpath, stat, readFile, readdir, writeFile, rename, unlink } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import { FsError } from './fs-error'

declare const fsVersionBrand: unique symbol
/** 文件版本（品牌字符串，见 versionOf）。 */
export type FsVersion = string & { [fsVersionBrand]: 'FsVersion' }

/** 品牌化一个版本字符串。仅供本包内部使用。 */
export function FsVersion(value: string): FsVersion {
  return value as FsVersion
}

/** 文件/目录信息。 */
export interface FsInfo {
  version: FsVersion
  type: 'file' | 'directory' | 'other'
  size: number
}

/** 解析后的目标：targetKey 是身份，displayPath 是展示路径。 */
export interface FsTarget {
  targetKey: string
  displayPath: string
}

/** 写入意图（版本守卫的两种形态）。 */
export type FsWriteIntent =
  | { kind: 'createIfAbsent' }
  | { kind: 'replaceIfVersion'; version: FsVersion }

/** 写入结果。before/after 是 LF 归一化后的内容（diff 展示用）。 */
export interface FsWriteOutcome {
  operation: 'create' | 'update'
  version: FsVersion
  before: string | null
  after: string
}

/** 目录条目。 */
export interface FsDirEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  target: FsTarget
  version?: FsVersion
  size?: number
}

/** 本地文件系统（上游 LocalFileSystem 的独立移植）。 */
export class WorkspaceFs {
  /** 缺省 cwd（解析基准）。 */
  readonly cwd: string
  /** 每个 targetKey 的 FIFO 尾承诺：串行化变更操作。 */
  private locks = new Map<string, Promise<unknown>>()

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd
  }

  /**
   * 解析一个路径为 FsTarget。
   * @throws FsError FS_NOT_FOUND - 空路径或父路径段不是目录。
   */
  async resolve(path: string): Promise<FsTarget> {
    if (path.trim().length === 0) throw new FsError('file_path must be a non-empty string', 'FS_NOT_FOUND')
    const displayPath = resolve(this.cwd, path)
    try {
      // 优先用文件自身的 realpath（把符号链接解析到目标）。
      return { displayPath, targetKey: await realpath(displayPath) }
    } catch (error: unknown) {
      if (isENOTDIR(error)) {
        throw new FsError(`cannot resolve "${displayPath}": a parent path segment is not a directory`, 'FS_NOT_FOUND')
      }
      if (!isENOENT(error)) throw error
    }
    // 文件不存在：realpath 最近存在的祖先，再补回缺失后缀，
    // 使 key 在后续创建这些目录期间保持稳定。
    const missing = [basename(displayPath)]
    let ancestor = dirname(displayPath)
    while (true) {
      try {
        const realAncestor = await realpath(ancestor)
        if (process.platform === 'win32') {
          // Windows 对 `普通文件/子路径` 报 ENOENT 而非 ENOTDIR，补回语义区分。
          const parentInfo = await stat(realAncestor)
          if (!parentInfo.isDirectory()) {
            throw new FsError(`cannot resolve "${displayPath}": a parent path segment is not a directory`, 'FS_NOT_FOUND')
          }
        }
        return { displayPath, targetKey: join(realAncestor, ...missing) }
      } catch (error: unknown) {
        if (error instanceof FsError) throw error
        if (!isENOENT(error)) throw error
        const parent = dirname(ancestor)
        if (parent === ancestor) return { displayPath, targetKey: displayPath }
        missing.unshift(basename(ancestor))
        ancestor = parent
      }
    }
  }

  /** 目标是否在 dir 之内（上游 contains 语义，供宿主做范围判断）。 */
  contains(parent: FsTarget, child: FsTarget): boolean {
    const path = relative(parent.targetKey, child.targetKey)
    return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  }

  /** stat；不存在返回 undefined。 */
  async stat(target: FsTarget): Promise<FsInfo | undefined> {
    const info = await probe(target.targetKey)
    if (info === null) return undefined
    return { version: info.version, type: info.type, size: info.size }
  }

  /** 读整个文件为 UTF-8 文本。 */
  async readText(target: FsTarget): Promise<string> {
    try {
      return await readFile(target.targetKey, 'utf8')
    } catch (error: unknown) {
      if (isENOENT(error)) {
        throw new FsError(`cannot read "${target.displayPath}": file does not exist`, 'FS_NOT_FOUND')
      }
      throw error
    }
  }

  /** 列出目录条目（含每个条目的版本与大小）。 */
  async listDir(target: FsTarget): Promise<FsDirEntry[]> {
    let dirents
    try {
      dirents = await readdir(target.targetKey, { withFileTypes: true })
    } catch (error: unknown) {
      if (isENOENT(error)) {
        throw new FsError(`cannot list "${target.displayPath}": directory does not exist`, 'FS_NOT_FOUND')
      }
      throw error
    }
    const entries: FsDirEntry[] = []
    for (const dirent of dirents) {
      const childPath = join(target.targetKey, dirent.name)
      const childTarget: FsTarget = { targetKey: childPath, displayPath: join(target.displayPath, dirent.name) }
      const info = await probe(childPath)
      entries.push({
        name: dirent.name,
        type: dirent.isDirectory() ? 'directory' : dirent.isFile() ? 'file' : 'other',
        target: childTarget,
        ...info !== null ? { version: info.version, size: info.size } : {},
      })
    }
    return entries
  }

  /**
   * 写文件（原子发布 + 版本守卫）。
   * @throws FsError - FS_NOT_REGULAR_FILE（目标是目录）/ FS_STALE_VERSION（
   * replaceIfVersion 且文件已变化或消失）/ FS_NOT_OBSERVED（createIfAbsent
   * 且文件已存在——盲写覆盖需要先读）。
   */
  async writeText(target: FsTarget, content: string, expected?: FsWriteIntent): Promise<FsWriteOutcome> {
    return this.withLock(target.targetKey, async () => {
      const existing = await probe(target.targetKey)
      if (existing !== null && existing.type !== 'file') {
        throw new FsError(`cannot write "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }

      if (expected?.kind === 'replaceIfVersion') {
        if (existing === null) {
          throw new FsError(`cannot write "${target.displayPath}": file no longer exists`, 'FS_STALE_VERSION')
        }
        if (existing.version !== expected.version) {
          throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
        }
      } else if (expected?.kind === 'createIfAbsent' && existing !== null) {
        throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, 'FS_NOT_OBSERVED')
      }
      // 无意图 = 无条件但原子的写。

      const before = existing !== null ? normalizeLineEndings(await readFile(target.targetKey, 'utf8')) : null
      await writeFileAtomic(target.targetKey, content, existing?.mode)
      const afterProbe = await probe(target.targetKey)
      return {
        operation: existing !== null ? 'update' : 'create',
        version: afterProbe !== null ? afterProbe.version : FsVersion(`missing:${target.targetKey}`),
        before,
        after: normalizeLineEndings(content),
      }
    })
  }

  /** 以 targetKey 为键跑独占操作（FIFO 每键串行）。 */
  private async withLock<T>(targetKey: string, op: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(targetKey) ?? Promise.resolve()
    const run = prior.then(op, op)
    const tail = run.then(() => undefined, () => undefined)
    this.locks.set(targetKey, tail)
    try {
      return await run
    } finally {
      if (this.locks.get(targetKey) === tail) {
        this.locks.delete(targetKey)
      }
    }
  }
}

interface PathInfo {
  version: FsVersion
  mode: number | undefined
  type: 'file' | 'directory' | 'other'
  size: number
}

function versionOf(info: BigIntStats): FsVersion {
  return FsVersion(`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`)
}

function pathType(info: BigIntStats): PathInfo['type'] {
  if (info.isFile()) return 'file'
  if (info.isDirectory()) return 'directory'
  return 'other'
}

async function probe(absolutePath: string): Promise<PathInfo | null> {
  try {
    const info = await stat(absolutePath, { bigint: true })
    return {
      version: versionOf(info),
      mode: Number(info.mode & 0o777n),
      type: pathType(info),
      size: Number(info.size),
    }
  } catch (error: unknown) {
    if (isENOENT(error)) return null
    throw error
  }
}

/** 原子发布：同目录临时文件 + rename（保留既有 mode）。 */
async function writeFileAtomic(targetKey: string, content: string, mode?: number): Promise<void> {
  const tmp = `${targetKey}.dsh-tmp-${randomUUID()}`
  try {
    await writeFile(tmp, content, mode !== undefined ? { mode } : undefined)
    await rename(tmp, targetKey)
  } catch (error: unknown) {
    await unlink(tmp).catch(() => {})
    throw error
  }
}

function normalizeLineEndings(content: string): string {
  return content.replaceAll('\r\n', '\n')
}

function isENOENT(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function isENOTDIR(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOTDIR'
}
