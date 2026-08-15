/**
 * 文件系统错误（上游 dsh-fs 的 FsError 独立移植）。
 * code 与上游对齐，消费方可按 code 区分「文件不存在 / 版本过期 / 编辑歧义」等。
 */

/** 文件系统错误码（与上游 dsh-fs 对齐）。 */
export type FsErrorCode =
  | 'FS_NOT_FOUND'
  | 'FS_NOT_REGULAR_FILE'
  | 'FS_STALE_VERSION'
  | 'FS_NOT_OBSERVED'
  | 'FS_AMBIGUOUS_EDIT'
  | 'FS_EDIT_NOT_FOUND'
  | 'FS_ABORTED'

export class FsError extends Error {
  readonly code: FsErrorCode

  constructor(message: string, code: FsErrorCode, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'FsError'
    this.code = code
  }
}
