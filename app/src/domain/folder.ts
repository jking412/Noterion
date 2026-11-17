import type { Snapshot } from '../composables/useNoterion'

export interface FolderContext { spaceId: string; epoch: number }
export interface FolderFile { id: string; relativePath: string; size: number; error?: string }
export interface FolderWarning { relativePath: string; error: string }
export interface FolderScan { scanId: string; files: FolderFile[]; warnings: FolderWarning[] }
export interface PreparedFolderFile { text: string; sourceName: string; sourceResourceId: string; snapshot: Snapshot }
export type FolderStatus = 'pending' | 'reading' | 'processing' | 'review' | 'saved' | 'duplicate' | 'skipped' | 'failed' | 'cancelled'
export interface FolderEntry extends FolderFile { status: FolderStatus }
export interface FolderGateway {
  scan(path: string, context: FolderContext, requestId: string): Promise<FolderScan>
  prepare(scanId: string, fileId: string, context: FolderContext): Promise<PreparedFolderFile>
  discard(scanId: string): Promise<unknown>
  cancelScan(requestId: string, context: FolderContext): Promise<unknown>
}

export const folderStatusLabels: Record<FolderStatus, string> = {
  pending: '待处理', reading: '正在读取', processing: '正在解析', review: '待核对', saved: '已保存',
  duplicate: '已存在', skipped: '已跳过', failed: '失败', cancelled: '已取消',
}
