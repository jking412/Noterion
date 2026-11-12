<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './components/Icon.vue'
import SearchPanel from './components/SearchPanel.vue'
import GraphCanvas from './components/GraphCanvas.vue'
import KnowledgeDetails from './components/KnowledgeDetails.vue'
import KnowledgeEditor from './components/KnowledgeEditor.vue'
import DeleteConfirmation from './components/DeleteConfirmation.vue'
import ResourcePreview from './components/ResourcePreview.vue'
import ModalShell from './components/ModalShell.vue'
import ImportWorkspace from './components/ImportWorkspace.vue'
import ResourceLibrary from './components/ResourceLibrary.vue'
import ImportRecords from './components/ImportRecords.vue'
import type { ImportRecord, ImportSubmission } from './domain/importHistory'
import { buildImportPlan } from './domain/import'
import { prepareResourceImport, type ImportWorkspaceRequest } from './domain/importSource'
import type { ResourceItem } from './domain/types'
import { useNoterion } from './composables/useNoterion'

const {
  data, query, keywords, matchMode, selectedId, graphState, saveState, focusRequest, graphKey,
  editingPoint, creatingPoint, importRecords, deletingId, deletingPoint, deleteImpact, previewResource, showReset, toast, effectiveTerms,
  results, selectedPoint, graphReady, selectPoint, addKeyword, clearSearch, beginEdit, savePoint,
  beginCreate, addResources, associateResource, removeResource, recordImport, isDuplicateImport, requestDelete, confirmDelete, movePoint, simulateUnavailable, restoreGraph, graphUpdate, resetDemo, notify,
} = useNoterion()
type View = 'graph' | 'resources' | 'import' | 'records'
const view = ref<View>('graph')
const importRequest = ref<ImportWorkspaceRequest | null>(null)
const importResult = ref<ImportRecord | null>(null)
const importSession = ref(0)
const importSource = ref<ResourceItem | null>(null)
const importReturnView = ref<View>('graph')
const hasImportDraft = ref(false)
const preparingImport = ref(false)
type ImportIntent = { resource?: ResourceItem; record?: ImportRecord; returnTo: View }
const pendingImport = ref<ImportIntent | null>(null)
let activeFailedRecordId: string | null = null
let importRequestSequence = 0
function navigate(target: View) {
  view.value = target
  if (window.location.hash !== '#' + target) window.history.pushState(null, '', '#' + target)
}
function loadHash() { const hash = window.location.hash.slice(1); view.value = ['graph', 'resources', 'import', 'records'].includes(hash) ? hash as View : 'graph' }
function locate(id: string) { navigate('graph'); nextTick(() => selectPoint(id)) }
async function openImport(intent: ImportIntent) {
  const session = ++importRequestSequence
  preparingImport.value = true
  try {
    const input = intent.record ? { ...intent.record, preview: true } : intent.resource ? await prepareResourceImport(intent.resource) : null
    if (session !== importRequestSequence) return
    if (intent.resource && !data.value.resources.some((r) => r.id === intent.resource!.id)) { notify('这份资料已移除，请重新选择导入来源。'); return }
    activeFailedRecordId = intent.record?.recordId ?? null
    importSource.value = intent.resource ?? data.value.resources.find((r) => r.id === intent.record?.sourceResourceId) ?? null
    importReturnView.value = intent.returnTo
    importResult.value = null; hasImportDraft.value = false
    importRequest.value = input ? { ...input, seq: session } : null
    importSession.value++
    navigate('import')
  } finally { if (session === importRequestSequence) preparingImport.value = false }
}
function startImport(resource?: ResourceItem) {
  const returnTo = view.value === 'import' ? importReturnView.value : view.value
  if (hasImportDraft.value) {
    if (!resource || resource.id === importSource.value?.id) { navigate('import'); return }
    pendingImport.value = { resource, returnTo }; return
  }
  void openImport({ resource, returnTo })
}
function newImport() {
  const intent: ImportIntent = { returnTo: view.value === 'import' ? importReturnView.value : view.value }
  if (hasImportDraft.value) { pendingImport.value = intent; return }
  void openImport(intent)
}
function retry(record: ImportRecord) {
  if (hasImportDraft.value && activeFailedRecordId !== record.recordId) { pendingImport.value = { record, returnTo: 'records' }; return }
  if (hasImportDraft.value && activeFailedRecordId === record.recordId) { navigate('import'); return }
  void openImport({ record, returnTo: 'records' })
}
function replaceImport() { const intent = pendingImport.value; pendingImport.value = null; if (intent) void openImport(intent) }
function importFromPreview(resource: ResourceItem) { previewResource.value = null; startImport(resource) }
function submitImport(value: ImportSubmission) { importResult.value = recordImport(value, false, activeFailedRecordId ?? undefined); activeFailedRecordId = importResult.value.status === 'failed' ? importResult.value.recordId : null }
function invalidImport(value: ImportSubmission) { activeFailedRecordId = recordImport(value, true, activeFailedRecordId ?? undefined).recordId }
function preserveCorrection(value: ImportSubmission) {
  const record = importRecords.value.find((r) => r.recordId === activeFailedRecordId && r.status === 'failed')
  if (!record) return
  const plan = buildImportPlan(value.draft, data.value, value.defaultResourceIds)
  Object.assign(record, JSON.parse(JSON.stringify(value)), { messages: plan.issues.map((i) => '第 ' + i.line + ' 行：' + i.message) })
}
function resetAll() { importRequestSequence++; resetDemo(); activeFailedRecordId = null; importRequest.value = null; importResult.value = null; importSource.value = null; pendingImport.value = null; hasImportDraft.value = false; preparingImport.value = false; importSession.value++; navigate('graph') }
watch(view, async () => { demoMenu.value = false; await nextTick(); if (view.value === 'graph') measurePanels() })
watch(() => data.value.resources.some((r) => r.id === importSource.value?.id), (exists) => { if (!exists) importSource.value = null })
const demoMenu = ref(false)
const searchFloating = ref<HTMLDivElement | null>(null)
const detailsFloating = ref<HTMLDivElement | null>(null)
const viewportInsets = ref({ left: 0, right: 0, top: 16, bottom: 76 })
let panelObserver: ResizeObserver | undefined
function measurePanels() {
  viewportInsets.value = {
    left: (searchFloating.value?.getBoundingClientRect().width || 0) + 32,
    right: selectedPoint.value ? (detailsFloating.value?.getBoundingClientRect().width || 0) + 32 : 16,
    top: 16,
    bottom: 76,
  }
}
watch(() => Boolean(selectedPoint.value), async () => { await nextTick(); measurePanels() })
onMounted(() => {
  loadHash(); window.addEventListener('hashchange', loadHash)
  panelObserver = new ResizeObserver(measurePanels)
  if (searchFloating.value) panelObserver.observe(searchFloating.value)
  if (detailsFloating.value) panelObserver.observe(detailsFloating.value)
  measurePanels()
})
onBeforeUnmount(() => { panelObserver?.disconnect(); window.removeEventListener('hashchange', loadHash) })
const saveLabel = computed(() => saveState.value === 'saving' ? '正在暂存' : '已暂存于本页')
const importReturnLabel = computed(() => importReturnView.value === 'resources' ? '返回资料库' : importReturnView.value === 'records' ? '返回导入记录' : '返回图谱')
function unavailable() { demoMenu.value = false; simulateUnavailable() }
function reconnect() { demoMenu.value = false; restoreGraph() }
function updateGraph() { demoMenu.value = false; graphUpdate(1700) }
function askReset() { demoMenu.value = false; showReset.value = true }
</script>

<template>
  <main class="app-shell" :class="{ 'has-selection': selectedPoint }">
    <header class="app-header glass-panel">
      <div class="brand"><button class="wordmark" aria-label="Noterion 知识图谱" @click="navigate('graph')">Noterion</button><nav class="main-nav" aria-label="主导航"><button :class="{ active: view === 'graph' }" @click="navigate('graph')"><Icon name="layers" :size="16" />知识图谱</button><button :class="{ active: view === 'resources' }" @click="navigate('resources')"><Icon name="book" :size="16" />资料库</button><button :class="{ active: view === 'import' }" @click="navigate('import')"><Icon name="file" :size="16" />知识导入<span v-if="hasImportDraft" class="nav-draft-dot" title="有未提交草稿" /></button><button :class="{ active: view === 'records' }" @click="navigate('records')"><Icon name="clock" :size="16" />导入记录</button></nav></div>
      <div class="header-actions">
        <button v-if="view === 'graph'" class="button" @click="beginCreate"><Icon name="plus" :size="15" />新建知识点</button><button v-if="view !== 'import'" class="button button-primary" :disabled="preparingImport" @click="startImport()"><Icon name="file" :size="15" />{{ preparingImport ? '读取中…' : hasImportDraft ? '继续导入' : '导入知识' }}</button><template v-else><button class="button" @click="navigate(importReturnView)"><Icon name="arrow" :size="15" />{{ importReturnLabel }}</button><button class="button button-primary" :disabled="preparingImport" @click="newImport"><Icon name="plus" :size="15" />新建导入</button></template>
        <span class="save-indicator" role="status" title="仅当前页面暂存，刷新、关闭或重置会清空。"><span v-if="saveState === 'saving'" class="spinner small" /><Icon v-else name="check" :size="15" /><span>{{ saveLabel }}</span></span>
        <span v-if="graphState !== 'ready'" class="graph-status" role="status"><span v-if="graphState === 'updating'" class="spinner small" /><Icon v-else name="alert" :size="15" />{{ graphState === 'updating' ? '图谱更新中' : '图服务不可用' }}</span>
        <div class="demo-menu-wrap" @keydown.esc="demoMenu = false">
          <button class="button demo-menu-button" aria-haspopup="menu" :aria-expanded="demoMenu" @click="demoMenu = !demoMenu">演示<Icon name="chevron" :size="13" /></button>
          <template v-if="demoMenu">
            <button class="menu-scrim" aria-label="关闭演示菜单" tabindex="-1" @click="demoMenu = false" />
            <div class="popover-menu demo-menu" role="menu"><div class="popover-title">演示控制</div><button role="menuitem" :disabled="graphState !== 'ready'" @click="unavailable"><Icon name="plug" />模拟图不可用</button><button role="menuitem" :disabled="graphState !== 'ready'" @click="updateGraph"><Icon name="refresh" />模拟图谱更新</button><button v-if="graphState === 'unavailable'" role="menuitem" @click="reconnect"><Icon name="refresh" />恢复连接</button><div class="menu-divider" /><button role="menuitem" @click="askReset"><Icon name="refresh" />重置演示</button><p class="popover-note">数据仅保留在当前页面；刷新或重置后回到空白。</p></div>
          </template>
        </div>
      </div>
    </header>
    <div v-show="view === 'graph'" class="canvas-workspace">
      <GraphCanvas :key="graphKey" :points="data.points" :positions="data.positions" :selected-id="selectedId" :graph-state="graphState" :focus-request="focusRequest" :viewport-insets="viewportInsets" @select="selectPoint" @move="movePoint" @edit="beginEdit" @delete="requestDelete" @restore="restoreGraph" />
      <div ref="searchFloating" class="search-floating">
        <SearchPanel v-model:query="query" :keywords="keywords" v-model:mode="matchMode" :results="results" :points="data.points" :selected-id="selectedId" :has-query="effectiveTerms.length > 0" @add="addKeyword" @remove="keywords.splice($event, 1)" @clear="clearSearch" @select="selectPoint" />
      </div>
      <div ref="detailsFloating" v-show="selectedPoint" class="details-floating">
        <KnowledgeDetails :point="selectedPoint" :points="data.points" :resources="data.resources" :delete-disabled="!graphReady" @select="selectPoint" @edit="beginEdit" @delete="requestDelete" @preview="previewResource = $event" @close="selectedId = null" />
      </div>
    </div>
    <ResourceLibrary v-if="view === 'resources'" :resources="data.resources" :points="data.points" @add="addResources" @associate="associateResource" @preview="previewResource = $event" @import="startImport" @locate="locate" @remove="removeResource" />
    <ImportWorkspace :key="importSession" v-show="view === 'import'" :data="data" :request="importRequest" :result="importResult" :source-resource="importSource" :return-label="importReturnLabel" :check-duplicate="isDuplicateImport" @submit="submitImport" @invalid="invalidImport" @draft-change="preserveCorrection" @dirty-change="hasImportDraft = $event" @cancel="navigate(importReturnView)" @records="navigate('records')" @locate="locate" @preview="previewResource = $event" />
    <ImportRecords v-if="view === 'records'" :records="importRecords" :points="data.points" @retry="retry" @locate="locate" @create="newImport" />
    <Transition name="toast"><div v-if="toast" class="toast-message" role="status"><Icon name="check" :size="16" />{{ toast }}</div></Transition>
    <KnowledgeEditor v-if="editingPoint" :point="editingPoint" :points="data.points" :resources="data.resources" :creating="creatingPoint" @save="savePoint" @close="editingPoint = null" />
    <DeleteConfirmation v-if="deletingPoint" :point="deletingPoint" :points="data.points" :resources="data.resources" :impact="deleteImpact" @confirm="confirmDelete" @close="deletingId = null" />
    <ResourcePreview v-if="previewResource" :resource="previewResource" @close="previewResource = null" @import="importFromPreview" />
    <ModalShell v-if="pendingImport" title="已有未提交的导入草稿" @close="pendingImport = null"><p class="draft-replace-copy">当前草稿会在切换页面时保留。开始另一份导入会替换这份草稿，已经成功导入的知识不受影响。</p><div class="dialog-actions"><button class="button" @click="pendingImport = null; navigate('import')">继续当前草稿</button><button class="button button-primary" @click="replaceImport">放弃草稿并开始</button></div></ModalShell>
    <ModalShell v-if="showReset" title="重置演示" @close="showReset = false"><div class="reset-copy"><p>清空本次页面中的知识点、资料、导入记录和节点位置。</p><p class="muted">本次添加的资料、导入记录和修改会被清除。</p></div><div class="dialog-actions"><button class="button" @click="showReset = false">取消</button><button class="button button-primary" @click="resetAll">重置演示</button></div></ModalShell>
  </main>
</template>

