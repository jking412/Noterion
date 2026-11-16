import { computed, ref } from 'vue'
import type { FolderContext, FolderEntry, FolderGateway, FolderStatus, FolderWarning, PreparedFolderFile } from '../domain/folder'
import { errorText, invoke } from '../desktop'

const nativeGateway: FolderGateway = {
  scan: (path, context, requestId) => invoke('folder_scan', { path, requestId, ...context }),
  prepare: (scanId, fileId, context) => invoke('folder_prepare', { scanId, fileId, ...context }),
  discard: scanId => invoke('folder_discard', { scanId }),
  cancelScan: (requestId, context) => invoke('folder_cancel_scan', { requestId, ...context }),
}

export function useFolderImport(context: () => FolderContext, gateway: FolderGateway = nativeGateway) {
  const scanId = ref('')
  const files = ref<FolderEntry[]>([])
  const warnings = ref<FolderWarning[]>([])
  const scanning = ref(false)
  const error = ref('')
  const currentId = ref('')
  const current = computed(() => files.value.find(file => file.id === currentId.value))
  const hasBatch = ref(false)
  const stopped = ref(false)
  let generation = 0
  let activeScan: { requestId: string; context: FolderContext } | null = null
  const counts = computed(() => {
    const value: Record<FolderStatus, number> & { total: number; completed: number; remaining: number } = {
      pending: 0, reading: 0, processing: 0, review: 0, saved: 0, duplicate: 0, skipped: 0, failed: 0, cancelled: 0,
      total: files.value.length, completed: 0, remaining: 0,
    }
    for (const file of files.value) value[file.status]++
    value.completed = value.saved + value.duplicate + value.skipped + value.failed + value.cancelled
    value.remaining = value.total - value.completed
    return value
  })
  function sameContext(value: FolderContext) { const now = context(); return value.spaceId === now.spaceId && value.epoch === now.epoch }
  function change(status: FolderStatus, detail?: string) {
    if (!current.value) return
    current.value.status = status
    current.value.error = detail
  }
  async function scan(path: string) {
    const token = ++generation, captured = { ...context() }
    if (activeScan) void gateway.cancelScan(activeScan.requestId, activeScan.context).catch(() => {})
    const requestId = crypto.randomUUID()
    activeScan = { requestId, context: captured }
    const previous = scanId.value
    scanning.value = true; error.value = ''; currentId.value = ''; files.value = []; warnings.value = []; scanId.value = ''; hasBatch.value = true; stopped.value = false
    if (previous) void gateway.discard(previous).catch(() => {})
    try {
      const result = await gateway.scan(path, captured, requestId)
      if (token !== generation || !sameContext(captured)) { void gateway.discard(result.scanId).catch(() => {}); return false }
      scanId.value = result.scanId
      files.value = result.files.map(file => ({ ...file, status: file.error ? 'failed' : 'pending' }))
      warnings.value = result.warnings
      return true
    } catch (failure) { if (token === generation && sameContext(captured)) error.value = errorText(failure); return false }
    finally { if (token === generation) { scanning.value = false; activeScan = null } }
  }
  async function readNext(fileId?: string): Promise<PreparedFolderFile | null> {
    if (scanning.value || ['reading', 'processing', 'review'].includes(current.value?.status || '')) return null
    const entry = fileId ? files.value.find(file => file.id === fileId) : files.value.find(file => file.status === 'pending')
    if (!entry || !['pending', 'failed', 'cancelled'].includes(entry.status)) return null
    const token = ++generation, captured = { ...context() }
    stopped.value = false; currentId.value = entry.id; change('reading'); error.value = ''
    try {
      const result = await gateway.prepare(scanId.value, entry.id, captured)
      if (token !== generation || !sameContext(captured)) return null
      return result
    } catch (failure) { if (token === generation && sameContext(captured)) change('failed', errorText(failure)); return null }
  }
  function processing() { if (['reading', 'review'].includes(current.value?.status || '')) change('processing') }
  function review() { if (current.value?.status === 'processing') change('review') }
  function failed(detail: string) { if (current.value?.status === 'processing') change('failed', detail) }
  function saved(duplicate: boolean) { if (current.value?.status === 'review') change(duplicate ? 'duplicate' : 'saved') }
  function skip(fileId?: string) {
    const entry = fileId ? files.value.find(file => file.id === fileId) : current.value
    if (!entry || ['saved', 'duplicate'].includes(entry.status)) return
    if (entry.id === currentId.value) generation++
    entry.status = 'skipped'; entry.error = undefined
  }
  function cancel() {
    const token = ++generation
    const cancelling = activeScan
    activeScan = null; stopped.value = true; scanning.value = false
    if (cancelling) void gateway.cancelScan(cancelling.requestId, cancelling.context).catch(failure => { if (generation === token && sameContext(cancelling.context)) error.value = errorText(failure) })
    for (const file of files.value) if (['pending', 'reading', 'processing', 'review'].includes(file.status)) { file.status = 'cancelled'; file.error = undefined }
  }
  function retry() {
    stopped.value = false
    for (const file of files.value) if (['failed', 'cancelled'].includes(file.status)) { file.status = 'pending'; file.error = undefined }
    currentId.value = ''
  }
  function dispose() { generation++; if (activeScan) void gateway.cancelScan(activeScan.requestId, activeScan.context).catch(() => {}); activeScan = null; if (scanId.value) void gateway.discard(scanId.value).catch(() => {}); scanId.value = ''; hasBatch.value = false }
  return { scanId, files, warnings, scanning, error, currentId, current, hasBatch, stopped, counts, scan, readNext, processing, review, failed, saved, skip, cancel, retry, dispose }
}
