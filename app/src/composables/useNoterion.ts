import { computed, onBeforeUnmount, ref } from 'vue'
import { createEmptyData } from '../data/seed'
import { applyDelete, cloneData, getDeleteImpact, searchPoints, validatePoint } from '../domain/logic'
import type { DemoData, KnowledgePoint, MatchMode, Point, ResourceItem } from '../domain/types'
import { buildImportPlan, fingerprintImport } from '../domain/import'
import type { ImportRecord, ImportSubmission } from '../domain/importHistory'

type GraphState = 'ready' | 'updating' | 'unavailable'

export function useNoterion(initialData: DemoData = createEmptyData()) {
  const seed = cloneData(initialData)
  const data = ref<DemoData>(cloneData(seed))
  const query = ref('')
  const keywords = ref<string[]>([])
  const matchMode = ref<MatchMode>('all')
  const selectedId = ref<string | null>(null)
  const graphState = ref<GraphState>('ready')
  const saveState = ref<'saved' | 'saving'>('saved')
  const focusRequest = ref<{ id: string; seq: number } | null>(null)
  const graphKey = ref(0)
  const editingPoint = ref<KnowledgePoint | null>(null)
  const creatingPoint = ref(false)
  const importRecords = ref<ImportRecord[]>([])
  const successfulImports = ref(new Set<string>())
  const ownedBlobUrls = new Set<string>()
  const deletingId = ref<string | null>(null)
  const previewResource = ref<ResourceItem | null>(null)
  const showReset = ref(false)
  const toast = ref('')
  let graphTimer: ReturnType<typeof setTimeout> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let focusSequence = 0
  const effectiveTerms = computed(() => [...keywords.value, query.value.trim()].filter(Boolean))
  const results = computed(() => searchPoints(data.value.points, effectiveTerms.value, matchMode.value))
  const selectedPoint = computed(() => data.value.points.find((p) => p.id === selectedId.value) || null)
  const deletingPoint = computed(() => data.value.points.find((p) => p.id === deletingId.value) || null)
  const deleteImpact = computed(() => getDeleteImpact(data.value.points, deletingId.value || ''))
  const graphReady = computed(() => graphState.value === 'ready')

  function notify(message: string) {
    clearTimeout(toastTimer)
    toast.value = message
    toastTimer = setTimeout(() => { toast.value = '' }, 2600)
  }
  function markSaved() {
    saveState.value = 'saving'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { saveState.value = 'saved' }, 350)
  }
  function selectPoint(id: string) {
    if (!data.value.points.some((p) => p.id === id)) return
    selectedId.value = id
    if (graphReady.value) focusRequest.value = { id, seq: ++focusSequence }
  }
  function addKeyword() {
    const term = query.value.trim()
    if (!term) return
    if (!keywords.value.some((existing) => existing.toLowerCase() === term.toLowerCase())) keywords.value.push(term)
    query.value = ''
  }
  function clearSearch() { query.value = ''; keywords.value = [] }
  function beginEdit(id: string) {
    creatingPoint.value = false
    const point = data.value.points.find((p) => p.id === id)
    if (point) editingPoint.value = JSON.parse(JSON.stringify(point))
  }
  function graphUpdate(duration = 1000, reconnect = false) {
    // Content changes remain usable while the graph projection is unavailable.
    if (graphState.value === 'unavailable' && !reconnect) return
    clearTimeout(graphTimer)
    graphState.value = 'updating'
    graphTimer = setTimeout(() => {
      graphState.value = 'ready'
      if (selectedId.value) focusRequest.value = { id: selectedId.value, seq: ++focusSequence }
    }, duration)
  }
  function beginCreate() {
    creatingPoint.value = true
    editingPoint.value = { id: 'point-' + crypto.randomUUID().slice(0, 8), name: '', description: '', topicIds: [], resourceIds: [], isTheme: false, color: 'neutral' }
  }
  function savePoint(point: KnowledgePoint) {
    if (creatingPoint.value && data.value.points.some((p) => p.id === point.id)) { notify('这个 ID 已存在，请换一个 ID。'); return }
    const error = validatePoint(point, data.value.points)
    if (error) { notify(error); return }
    if (point.resourceIds.some((id) => !data.value.resources.some((r) => r.id === id))) { notify('请选择有效的资料。'); return }
    const saved = JSON.parse(JSON.stringify(point)) as KnowledgePoint
    if (creatingPoint.value) { data.value.points.push(saved); selectedId.value = saved.id }
    else data.value.points = data.value.points.map((p) => p.id === point.id ? saved : p)
    editingPoint.value = null
    markSaved()
    notify('知识点已保存在当前页面')
    graphUpdate(850)
  }
  function requestDelete(id: string) { if (graphReady.value) deletingId.value = id }
  function addResources(resources: ResourceItem[], pointIds: string[]) {
    const ids = new Set(data.value.resources.map((r) => r.id))
    const invalid = resources.some((r) => { if (!r.id.trim() || ids.has(r.id)) return true; ids.add(r.id); return false })
    if (invalid || pointIds.some((id) => !data.value.points.some((p) => p.id === id))) {
      resources.forEach((r) => { if (r.blobUrl) URL.revokeObjectURL(r.blobUrl) })
      notify('资料 ID 重复或关联知识点不存在，请重新添加。'); return
    }
    resources.forEach((r) => { if (r.blobUrl) ownedBlobUrls.add(r.blobUrl) })
    data.value.resources.push(...resources)
    data.value.points = data.value.points.map((p) => pointIds.includes(p.id) ? { ...p, resourceIds: [...new Set([...p.resourceIds, ...resources.map((r) => r.id)])] } : p)
    markSaved(); notify('已添加 ' + resources.length + ' 份资料，可在本次页面复用')
  }
  function associateResource(resourceId: string, pointIds: string[]) {
    if (!data.value.resources.some((r) => r.id === resourceId) || pointIds.some((id) => !data.value.points.some((p) => p.id === id))) return
    data.value.points = data.value.points.map((p) => ({ ...p, resourceIds: pointIds.includes(p.id) ? [...new Set([...p.resourceIds, resourceId])] : p.resourceIds.filter((id) => id !== resourceId) }))
    markSaved(); notify('资料关联已保存')
  }
  function removeResource(resourceId: string) {
    const resource = data.value.resources.find((item) => item.id === resourceId)
    if (!resource) return
    data.value.resources = data.value.resources.filter((item) => item.id !== resourceId)
    data.value.points = data.value.points.map((point) => ({ ...point, resourceIds: point.resourceIds.filter((id) => id !== resourceId) }))
    if (previewResource.value?.id === resourceId) previewResource.value = null
    const url = resource.blobUrl
    if (url && !data.value.resources.some((item) => item.blobUrl === url) && ownedBlobUrls.delete(url)) URL.revokeObjectURL(url)
    markSaved(); notify('资料已移除，知识点已保留')
  }
  function recordImport(submission: ImportSubmission, failedOnly = false, retryRecordId?: string): ImportRecord {
    const fingerprint = fingerprintImport(submission.source, submission.format, submission.defaultResourceIds)
    const duplicate = successfulImports.value.has(fingerprint)
    const plan = buildImportPlan(submission.draft, data.value, submission.defaultResourceIds)
    const status = duplicate ? 'duplicate' : plan.data && !failedOnly ? 'success' : 'failed'
    const snapshot = JSON.parse(JSON.stringify(submission)) as ImportSubmission
    const retriedRecord = importRecords.value.find((entry) => entry.recordId === retryRecordId && entry.status === 'failed')
    const record: ImportRecord = { ...snapshot, recordId: crypto.randomUUID(), createdAt: new Date().toISOString(), status,
      counts: status === 'success' ? plan.counts : { added: 0, updated: 0, existing: duplicate ? submission.draft.rows.length : 0, topicLinks: 0, resourceLinks: 0 },
      pointIds: status === 'success' ? submission.draft.rows.map((r) => r.id) : [],
      messages: duplicate ? ['这个批次和输入已处理，未写入任何内容。'] : plan.issues.map((issue) => '第 ' + issue.line + ' 行：' + issue.message),
    }
    if (status === 'success' && plan.data) {
      data.value = plan.data; successfulImports.value.add(fingerprint)
      markSaved(); graphUpdate(850); notify('知识已导入当前页面')
    }
    if (retriedRecord && status === 'failed') {
      // A corrected draft that still has errors remains one pending attempt.
      Object.assign(retriedRecord, record, { recordId: retriedRecord.recordId, createdAt: retriedRecord.createdAt })
      return retriedRecord
    }
    if (retriedRecord) {
      retriedRecord.status = 'resolved'
      retriedRecord.resolvedByRecordId = record.recordId
    }
    importRecords.value.unshift(record)
    return record
  }
  function isDuplicateImport(source: string, format: 'markdown' | 'csv', defaults: string[]) { return successfulImports.value.has(fingerprintImport(source, format, defaults)) }
  function releaseFiles() { ownedBlobUrls.forEach((url) => URL.revokeObjectURL(url)); ownedBlobUrls.clear() }
  function confirmDelete() {
    if (!graphReady.value || !deletingId.value) return
    const count = deleteImpact.value.deletedIds.length
    data.value = applyDelete(data.value, deletingId.value)
    if (!data.value.points.some((p) => p.id === selectedId.value)) selectedId.value = null
    deletingId.value = null
    markSaved()
    graphUpdate(850)
    notify('已移除 ' + count + ' 个知识点，资料文件已保留')
  }
  function movePoint(id: string, position: Point) {
    if (!graphReady.value) return
    data.value.positions[id] = position
    markSaved()
  }
  function simulateUnavailable() {
    clearTimeout(graphTimer)
    graphState.value = 'unavailable'
    deletingId.value = null
  }
  function restoreGraph() { if (graphState.value !== 'ready') graphUpdate(1700, true) }
  function resetDemo() {
    clearTimeout(graphTimer)
    clearTimeout(saveTimer)
    data.value = cloneData(seed)
    releaseFiles(); successfulImports.value.clear(); importRecords.value = []; creatingPoint.value = false
    query.value = ''; keywords.value = []; matchMode.value = 'all'
    selectedId.value = null; focusRequest.value = null
    graphState.value = 'ready'; saveState.value = 'saved'
    editingPoint.value = null; deletingId.value = null; previewResource.value = null
    showReset.value = false
    graphKey.value++
    notify('演示已重置')
  }
  onBeforeUnmount(() => { clearTimeout(graphTimer); clearTimeout(saveTimer); clearTimeout(toastTimer); releaseFiles() })
  return { data, query, keywords, matchMode, selectedId, graphState, saveState, focusRequest, graphKey, editingPoint, creatingPoint, importRecords, deletingId, deletingPoint, deleteImpact, previewResource, showReset, toast, effectiveTerms, results, selectedPoint, graphReady, selectPoint, addKeyword, clearSearch, beginEdit, beginCreate, savePoint, addResources, associateResource, removeResource, recordImport, isDuplicateImport, requestDelete, confirmDelete, movePoint, simulateUnavailable, restoreGraph, graphUpdate, resetDemo, notify }
}
