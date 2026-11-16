import { computed, onBeforeUnmount, ref } from 'vue'
import { searchPoints } from '../domain/logic'
import type { DemoData, DeleteImpact, KnowledgePoint, MatchMode, Point } from '../domain/types'
import { errorText, invoke, setSpaceContext } from '../desktop'

export interface Space { id: string; name: string }
export interface Snapshot extends DemoData { root: string; revision: number; spaceId: string; epoch: number; spaces: Space[] }
export function useNoterion() {
  const data = ref<Snapshot>({ points: [], resources: [], positions: {}, root: '', revision: 0, spaceId: '', epoch: 0, spaces: [] })
  const loaded = ref(false)
  const error = ref('')
  const busy = ref(false)
  const toast = ref('')
  const query = ref('')
  const keywords = ref<string[]>([])
  const matchMode = ref<MatchMode>('all')
  const selectedId = ref<string | null>(null)
  const editingPoint = ref<KnowledgePoint | null>(null)
  const creatingPoint = ref(false)
  const deletingId = ref<string | null>(null)
  const deleteImpact = ref<DeleteImpact>({ deletedIds: [], retainedIds: [] })
  const deleteRevision = ref(0)
  const graphState = ref<'ready' | 'updating' | 'unavailable'>('ready')
  const graphKey = ref(0)
  const focusRequest = ref<{ id: string; seq: number } | null>(null)
  let focusSequence = 0
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  const effectiveTerms = computed(() => [...keywords.value, query.value.trim()].filter(Boolean))
  const results = computed(() => searchPoints(data.value.points, effectiveTerms.value, matchMode.value))
  const selectedPoint = computed(() => data.value.points.find(p => p.id === selectedId.value) ?? null)
  const deletingPoint = computed(() => data.value.points.find(p => p.id === deletingId.value) ?? null)
  const graphReady = computed(() => graphState.value === 'ready')
  function notify(message: string) { clearTimeout(toastTimer); toast.value = message; toastTimer = setTimeout(() => { toast.value = '' }, 4000) }
  function accept(snapshot: Snapshot, allowContextChange = false) {
    if (loaded.value && !allowContextChange && (snapshot.root !== data.value.root || snapshot.spaceId !== data.value.spaceId || snapshot.epoch !== data.value.epoch)) return false
    data.value = snapshot; loaded.value = true; error.value = ''
    setSpaceContext(snapshot)
    if (!snapshot.points.some(p => p.id === selectedId.value)) selectedId.value = null
    return true
  }
  async function run(command: string, args?: Record<string, unknown>, message?: string) {
    if (busy.value) return false
    busy.value = true
    clearTimeout(toastTimer)
    toast.value = ''
    error.value = ''
    const context = { spaceId: data.value.spaceId, epoch: data.value.epoch }
    const changing = ['app_load', 'directory_select', 'space_create', 'space_switch'].includes(command)
    try {
      const snapshot = await invoke<Snapshot>(command, { ...context, ...args })
      if (data.value.spaceId !== context.spaceId || data.value.epoch !== context.epoch) return false
      if (!accept(snapshot, changing)) return false
      if (message) notify(message); return true
    }
    catch (e) { if (data.value.spaceId === context.spaceId && data.value.epoch === context.epoch) error.value = errorText(e); return false }
    finally { busy.value = false }
  }
  async function load() { return run('app_load') }
  function selectPoint(id: string) { if (!data.value.points.some(p => p.id === id)) return; selectedId.value = id; if (graphReady.value) focusRequest.value = { id, seq: ++focusSequence } }
  function addKeyword() { const term = query.value.trim(); if (term && !keywords.value.includes(term)) keywords.value.push(term); query.value = '' }
  function clearSearch() { query.value = ''; keywords.value = [] }
  function beginCreate() {
    if (!loaded.value || busy.value) return
    creatingPoint.value = true
    editingPoint.value = { id: 'new-point', name: '', description: '', topicIds: [], resourceIds: [], isTheme: false, color: 'neutral' }
  }
  function beginEdit(id: string) { const point = data.value.points.find(p => p.id === id); if (point && !busy.value) { creatingPoint.value = false; editingPoint.value = JSON.parse(JSON.stringify(point)) } }
  async function savePoint(point: KnowledgePoint) {
    const previousIds = new Set(data.value.points.map(p => p.id))
    if (await run('point_save', { point, creating: creatingPoint.value }, '知识点已保存到本机')) {
      editingPoint.value = null
      const id = creatingPoint.value ? data.value.points.find(p => !previousIds.has(p.id))?.id : point.id
      if (id) selectPoint(id)
    }
  }
  async function requestDelete(id: string) {
    if (!graphReady.value || busy.value) return
    busy.value = true
    clearTimeout(toastTimer)
    toast.value = ''
    error.value = ''
    const context = { spaceId: data.value.spaceId, epoch: data.value.epoch }
    try { const impact = await invoke<DeleteImpact>('delete_preview', { id, ...context }); if (data.value.spaceId === context.spaceId && data.value.epoch === context.epoch) { deleteImpact.value = impact; deleteRevision.value = data.value.revision; deletingId.value = id } }
    catch (e) { error.value = errorText(e) }
    finally { busy.value = false }
  }
  async function confirmDelete() {
    if (!deletingId.value) return
    if (await run('point_delete', { id: deletingId.value, revision: deleteRevision.value }, '知识点已删除，全部资料已保留')) deletingId.value = null
  }
  async function movePoint(id: string, position: Point) {
    // Failed writes keep the committed snapshot and discard the local drag projection.
    if (!(await run('point_move', { id, position }))) graphKey.value++
  }
  async function restoreGraph() {
    graphState.value = 'updating'
    if (await load()) { graphKey.value++; graphState.value = 'ready'; if (selectedId.value) selectPoint(selectedId.value) }
    else graphState.value = 'unavailable'
  }
  async function directorySelect(path: string, create: boolean) { return run('directory_select', { path, create }, '已打开本机数据目录') }
  function clearSpaceState() { clearSearch(); selectedId.value = null; editingPoint.value = null; deletingId.value = null; focusRequest.value = null; graphState.value = 'ready'; graphKey.value++ }
  async function spaceSwitch(id: string) { if (id === data.value.spaceId) return true; const ok = await run('space_switch', { id }); if (ok) clearSpaceState(); return ok }
  async function spaceCreate(name: string) { const ok = await run('space_create', { name }, '空间已创建'); if (ok) clearSpaceState(); return ok }
  async function spaceRename(id: string, name: string) { return run('space_rename', { id, name }, '空间名称已保存') }
  onBeforeUnmount(() => clearTimeout(toastTimer))
  return { data, loaded, error, busy, toast, query, keywords, matchMode, selectedId, editingPoint, creatingPoint, deletingId, deletingPoint, deleteImpact, graphState, graphKey, focusRequest, effectiveTerms, results, selectedPoint, graphReady, notify, run, load, accept, selectPoint, addKeyword, clearSearch, beginCreate, beginEdit, savePoint, requestDelete, confirmDelete, movePoint, restoreGraph, directorySelect, spaceSwitch, spaceCreate, spaceRename }
}
