import type { ImportDraft } from './import'
import type { ResourceItem } from './types'
import { decodeResourceText } from './resources'

export interface ImportWorkspaceRequest {
  seq: number
  source: string
  format: 'markdown' | 'csv'
  filename: string
  defaultResourceIds: string[]
  draft?: ImportDraft
  preview?: boolean
  error?: string
}

/** Preserve explicit choices on Back; only newly declared file defaults are added. */
export function mergePreviewDefaults(selected: string[], previous: string[], incoming: string[], sourceId?: string) {
  return [...new Set([...selected, ...incoming.filter((id) => !previous.includes(id)), ...(sourceId ? [sourceId] : [])])]
}

/** Ordinary learning material remains a source; only structured files become import input. */
export async function prepareResourceImport(resource: ResourceItem): Promise<Omit<ImportWorkspaceRequest, 'seq'>> {
  const empty = { source: '', format: 'markdown' as const, filename: '粘贴的 Markdown', defaultResourceIds: [resource.id] }
  const csv = /\.csv$/i.test(resource.filename || '')
  const markdown = resource.kind === 'markdown'
  if (!csv && !markdown) return empty
  if ((resource.size ?? 0) > 5 * 1024 * 1024) return { ...empty, error: '这份资料超过知识文件的 5 MB 上限。可保留为来源，另选整理好的知识文件。' }
  let source = resource.content
  if (source === undefined && resource.blobUrl?.startsWith('blob:')) {
    try {
      const response = await fetch(resource.blobUrl)
      if (!response.ok) throw new Error()
      source = decodeResourceText(await response.arrayBuffer())
    } catch { return { ...empty, error: '无法读取知识文件，请确认文件为 UTF-8，或重新选择文件。当前资料仍作为来源保留。' } }
  }
  if (source === undefined) return { ...empty, error: '文件内容已不可用，请重新选择知识文件。' }
  if (markdown && !/^import_id\s*:|^##\s+.*\{#[^{}]+\}\s*$/m.test(source)) return empty
  return { ...empty, source, format: csv ? 'csv' : 'markdown', filename: resource.filename || resource.title, preview: true }
}
