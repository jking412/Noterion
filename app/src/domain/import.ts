import { cloneData } from './logic'
import type { DemoData, KnowledgePoint } from './types'

export type ImportFormat = 'markdown' | 'csv'
export type ImportResolution = 'keep' | 'adopt'
export interface ImportIssue {
  line: number
  rowId?: string
  field: string
  message: string
}
export interface ImportRow {
  id: string
  name: string
  description: string
  isTheme: boolean
  topicIds: string[]
  resourceIds: string[]
  line: number
  endLine: number
  resolution?: ImportResolution
}
export interface ImportDraft {
  importId: string
  defaultResourceIds: string[]
  rows: ImportRow[]
  issues: ImportIssue[]
}
export type ImportRowStatus = 'new' | 'updated' | 'existing' | 'conflict' | 'error'
export interface ImportPlan {
  data: DemoData | null
  issues: ImportIssue[]
  rows: { id: string; status: ImportRowStatus; issues: ImportIssue[] }[]
  counts: { added: number; updated: number; existing: number; topicLinks: number; resourceLinks: number }
}

export const CSV_HEADER = 'import_id,default_resource_ids,id,name,is_theme,topic_ids,resource_ids,description'
export const markdownTemplate = `import_id: my-first-import
default_resource_ids:

# 我的知识

## 学习主题 {#my-topic}
is_theme: true
topic_ids:
resource_ids:

这里是主题的 Markdown 描述。

## 一个知识点 {#my-point}
is_theme: false
topic_ids: my-topic
resource_ids:

在这里写说明、命令与个人理解。
`
export const csvTemplate = `${CSV_HEADER}\nmy-first-import,,my-topic,学习主题,true,,,这里是主题的描述。\nmy-first-import,,my-point,一个知识点,false,my-topic,,在这里写说明、命令与个人理解。\n`

const normalizeSource = (source: string) => source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
const unique = (ids: string[]) => [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
export const parseIdList = (value: string) => unique(value.split(';'))

/** Retain the full normalized input: a successful source may never be replayed after later edits/deletion. */
export function fingerprintImport(source: string, format: ImportFormat, defaultResourceIds: string[] = []): string {
  return JSON.stringify([format, normalizeSource(source), unique(defaultResourceIds).sort()])
}

function parseBoolean(value: string, line: number, issues: ImportIssue[], rowId: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === 'false') return false
  if (normalized === 'true') return true
  issues.push({ line, rowId, field: 'isTheme', message: 'is_theme 只能填写 true 或 false。' })
  return false
}

function parseMarkdown(source: string): ImportDraft {
  const draft: ImportDraft = { importId: '', defaultResourceIds: [], rows: [], issues: [] }
  const lines = source.split('\n')
  const starts: { index: number; name: string; id: string }[] = []
  let fence: { char: string; length: number } | null = null
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (delimiter) {
      const marker = delimiter[1]!
      if (!fence) fence = { char: marker[0]!, length: marker.length }
      else if (marker[0] === fence.char && marker.length >= fence.length && !delimiter[2]!.trim()) fence = null
      continue
    }
    if (fence) continue
    const heading = line.match(/^##\s+(.*?)\s*\{#([^{}]*)\}\s*$/)
    if (heading) starts.push({ index, name: heading[1]!.trim(), id: heading[2]!.trim() })
  }
  const headerFields = new Set<string>()
  const headerEnd = starts[0]?.index ?? lines.length
  for (let index = 0; index < headerEnd; index++) {
    const line = lines[index]!
    if (!line.trim() || /^#\s/.test(line)) continue
    const metadata = line.match(/^(import_id|default_resource_ids):\s*(.*)$/)
    if (!metadata) {
      draft.issues.push({ line: index + 1, field: 'source', message: '文首仅支持 import_id、default_resource_ids 和可选的一级标题。' })
      continue
    }
    const key = metadata[1]!
    if (headerFields.has(key)) draft.issues.push({ line: index + 1, field: key, message: `${key} 在文首重复。` })
    headerFields.add(key)
    if (key === 'import_id') draft.importId = metadata[2]!.trim()
    else draft.defaultResourceIds = parseIdList(metadata[2]!)
  }
  for (let cursor = 0; cursor < starts.length; cursor++) {
    const start = starts[cursor]!
    const end = starts[cursor + 1]?.index ?? lines.length
    const row: ImportRow = { id: start.id, name: start.name, description: '', isTheme: false, topicIds: [], resourceIds: [], line: start.index + 1, endLine: end }
    let bodyStart = start.index + 1
    const fields = new Set<string>()
    for (; bodyStart < end; bodyStart++) {
      const line = lines[bodyStart]!
      if (!line.trim()) { bodyStart++; break }
      const metadata = line.match(/^(is_theme|topic_ids|resource_ids):\s*(.*)$/)
      if (!metadata) {
        draft.issues.push({ line: bodyStart + 1, rowId: row.id, field: 'source', message: '条目元字段与描述之间需要一个空行；元字段仅支持 is_theme、topic_ids、resource_ids。' })
        break
      }
      const key = metadata[1]!
      if (fields.has(key)) draft.issues.push({ line: bodyStart + 1, rowId: row.id, field: key, message: `${key} 在这个条目重复。` })
      fields.add(key)
      if (key === 'is_theme') row.isTheme = parseBoolean(metadata[2]!, bodyStart + 1, draft.issues, row.id)
      if (key === 'topic_ids') row.topicIds = parseIdList(metadata[2]!)
      if (key === 'resource_ids') row.resourceIds = parseIdList(metadata[2]!)
    }
    row.description = lines.slice(bodyStart, end).join('\n')
    draft.rows.push(row)
  }
  return draft
}

interface CsvRecord { cells: string[]; line: number; endLine: number }
function csvRecords(source: string, issues: ImportIssue[]): CsvRecord[] {
  const records: CsvRecord[] = []
  let cells: string[] = [], cell = '', quoted = false, afterQuote = false
  let line = 1, startLine = 1, quoteLine = 1
  function endCell() { cells.push(cell); cell = ''; afterQuote = false }
  function endRecord() {
    endCell()
    if (cells.some((value) => value.length > 0)) records.push({ cells, line: startLine, endLine: line })
    cells = []
    startLine = line + 1
  }
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { cell += '"'; index++ }
        else { quoted = false; afterQuote = true }
      } else { cell += char; if (char === '\n') line++ }
      continue
    }
    if (char === ',') { endCell(); continue }
    if (char === '\n') { endRecord(); line++; continue }
    if (char === '"' && !cell && !afterQuote) { quoted = true; quoteLine = line; continue }
    if (char === '"' || afterQuote) issues.push({ line, field: 'source', message: 'CSV 引号位置错误；包含逗号、引号或换行的单元格请用双引号包围，内部引号写成两个双引号。' })
    cell += char
  }
  if (quoted) issues.push({ line: quoteLine, field: 'source', message: 'CSV 双引号未闭合。' })
  if (cell.length || cells.length || afterQuote) endRecord()
  return records
}

function parseCsv(source: string): ImportDraft {
  const draft: ImportDraft = { importId: '', defaultResourceIds: [], rows: [], issues: [] }
  const records = csvRecords(source, draft.issues)
  const header = records.shift()
  if (!header || header.cells.join(',') !== CSV_HEADER || header.cells.length !== 8) {
    draft.issues.push({ line: header?.line ?? 1, field: 'source', message: `CSV 表头必须为：${CSV_HEADER}` })
    return draft
  }
  let batchSet = false
  for (const record of records) {
    if (record.cells.length !== 8) {
      draft.issues.push({ line: record.line, field: 'source', message: `CSV 此行有 ${record.cells.length} 列，需要 8 列。` })
      continue
    }
    const [batch = '', defaults = '', id = '', name = '', isTheme = '', topics = '', resources = '', description = ''] = record.cells
    const defaultIds = parseIdList(defaults)
    if (!batchSet) { draft.importId = batch.trim(); draft.defaultResourceIds = defaultIds; batchSet = true }
    else if (batch.trim() !== draft.importId || JSON.stringify([...defaultIds].sort()) !== JSON.stringify([...draft.defaultResourceIds].sort())) {
      draft.issues.push({ line: record.line, rowId: id.trim(), field: 'importId', message: '同一 CSV 的 import_id 和 default_resource_ids 必须一致。' })
    }
    draft.rows.push({ id: id.trim(), name: name.trim(), description, isTheme: parseBoolean(isTheme, record.line, draft.issues, id.trim()), topicIds: parseIdList(topics), resourceIds: parseIdList(resources), line: record.line, endLine: record.endLine })
  }
  return draft
}

export function parseImport(source: string, format: ImportFormat): ImportDraft {
  const draft = format === 'csv' ? parseCsv(normalizeSource(source)) : parseMarkdown(normalizeSource(source))
  if (!draft.importId) draft.issues.push({ line: 1, field: 'importId', message: '请填写本批次稳定的 import_id。' })
  if (!draft.rows.length) draft.issues.push({ line: 1, field: 'source', message: '没有可导入的知识点，请使用提供的模板。' })
  return draft
}

/** Make a complete candidate before committing; no branch ever mutates the supplied data or draft. */
export function buildImportPlan(draft: ImportDraft, data: DemoData, defaultResourceIds = draft.defaultResourceIds): ImportPlan {
  const issues = draft.issues.map((issue) => ({ ...issue }))
  const result = cloneData(data)
  const existingById = new Map(data.points.map((point) => [point.id, point]))
  const candidates = new Map(result.points.map((point) => [point.id, point]))
  const resourceIds = new Set(data.resources.map((resource) => resource.id))
  const rowIds = new Set<string>()
  const statuses: ImportPlan['rows'] = []
  const counts = { added: 0, updated: 0, existing: 0, topicLinks: 0, resourceLinks: 0 }
  const defaults = unique(defaultResourceIds)
  function issue(row: ImportRow, field: string, message: string) { issues.push({ line: row.line, rowId: row.id, field, message }) }
  if (!draft.importId.trim() && !issues.some((item) => item.field === 'importId')) issues.push({ line: 1, field: 'importId', message: '请填写本批次稳定的 import_id。' })
  if (!draft.rows.length && !issues.some((item) => item.field === 'source')) issues.push({ line: 1, field: 'source', message: '没有可导入的知识点。' })
  for (const row of draft.rows) {
    if (!row.id.trim()) issue(row, 'id', '知识点标识不能为空。')
    if (!row.name.trim()) issue(row, 'name', '知识点名称不能为空。')
    if (rowIds.has(row.id)) issue(row, 'id', '同一批次存在重复的知识点 ID，请使用不同 ID 或合并成一个条目。')
    rowIds.add(row.id)
    const old = existingById.get(row.id)
    const contentConflict = Boolean(old && (old.name !== row.name.trim() || old.description !== row.description))
    if (old && old.isTheme !== row.isTheme) issue(row, 'isTheme', '此 ID 的主题标志与已有知识点不同，请修正类型或使用新 ID。')
    if (contentConflict && row.resolution !== 'keep' && row.resolution !== 'adopt') issue(row, 'resolution', '名称或描述与已有内容不同，请选择保留已有或采用导入。')
    const point: KnowledgePoint = {
      id: row.id,
      name: old && row.resolution !== 'adopt' ? old.name : row.name.trim(),
      description: old && row.resolution !== 'adopt' ? old.description : row.description,
      isTheme: old?.isTheme ?? row.isTheme,
      color: old?.color ?? 'neutral',
      topicIds: unique([...(old?.topicIds ?? []), ...row.topicIds]),
      resourceIds: unique([...(old?.resourceIds ?? []), ...row.resourceIds, ...defaults]),
    }
    candidates.set(row.id, point)
    const linksAdded = point.topicIds.length - (old?.topicIds.length ?? 0)
    const resourcesAdded = point.resourceIds.length - (old?.resourceIds.length ?? 0)
    counts.topicLinks += linksAdded
    counts.resourceLinks += resourcesAdded
    let status: ImportRowStatus = 'new'
    if (!old) counts.added++
    else if (contentConflict && !row.resolution) status = 'conflict'
    else if (point.name !== old.name || point.description !== old.description || linksAdded > 0 || resourcesAdded > 0) { status = 'updated'; counts.updated++ }
    else { status = 'existing'; counts.existing++ }
    statuses.push({ id: row.id, status, issues: [] })
  }
  for (const row of draft.rows) {
    const point = candidates.get(row.id)!
    for (const topicId of point.topicIds) {
      if (topicId === row.id) issue(row, 'topicIds', '知识点不能属于自己。')
      else if (!candidates.get(topicId)?.isTheme) issue(row, 'topicIds', `所属主题 ${topicId} 不存在或不是主题。`)
    }
    for (const resourceId of point.resourceIds) if (!resourceIds.has(resourceId)) issue(row, 'resourceIds', `资料 ${resourceId} 不存在，请添加该资料或明确移除此引用。`)
    const seen = new Set<string>(), queue = [...point.topicIds]
    let cyclic = false
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor]!
      if (id === row.id) { cyclic = true; break }
      if (seen.has(id)) continue
      seen.add(id)
      queue.push(...(candidates.get(id)?.topicIds ?? []))
    }
    if (cyclic && !point.topicIds.includes(row.id)) issue(row, 'topicIds', '这组所属主题会形成循环，请修正关系。')
  }
  for (const row of statuses) {
    row.issues = issues.filter((item) => item.rowId === row.id)
    if (row.issues.length) row.status = row.issues.every((item) => item.field === 'resolution') ? 'conflict' : 'error'
  }
  result.points = [...candidates.values()]
  return { data: issues.length ? null : result, issues, rows: statuses, counts }
}
