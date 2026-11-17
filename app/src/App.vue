<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './components/Icon.vue'
import DesktopShell from './components/DesktopShell.vue'
import SearchPanel from './components/SearchPanel.vue'
import GraphCanvas from './components/GraphCanvas.vue'
import GraphBoundary from './components/GraphBoundary.vue'
import KnowledgeDetails from './components/KnowledgeDetails.vue'
import KnowledgeEditor from './components/KnowledgeEditor.vue'
import DeleteConfirmation from './components/DeleteConfirmation.vue'
import ResourcePreview from './components/ResourcePreview.vue'
import ResourceLibrary from './components/ResourceLibrary.vue'
import ModalShell from './components/ModalShell.vue'
import ImportWorkspace from './components/ImportWorkspace.vue'
import AiSettingsPanel from './components/AiSettings.vue'
import AiKnowledgePanel from './components/AiKnowledgePanel.vue'
import SpaceSwitcher from './components/SpaceSwitcher.vue'
import type { ResourceItem } from './domain/types'
import type { AiAdoptInput, AiImportRecord } from './domain/ai'
import { useNoterion } from './composables/useNoterion'
import type { Snapshot } from './composables/useNoterion'
import { useAiTasks } from './composables/useAiTasks'
import { invoke, errorText } from './desktop'

const { data, loaded, error, busy, toast, query, keywords, matchMode, selectedId, editingPoint, creatingPoint, deletingId, deletingPoint, deleteImpact, graphState, graphKey, focusRequest, effectiveTerms, results, selectedPoint, graphReady, notify, run, load, accept, selectPoint, addKeyword, clearSearch, beginCreate, beginEdit, savePoint, requestDelete, confirmDelete, movePoint, restoreGraph, directorySelect, spaceSwitch, spaceCreate, spaceRename } = useNoterion()
const { settings: aiSettings, activeConnection, serviceLabel: aiServiceLabel, busy: aiBusy, error: aiError, phaseLabel: aiPhase, result: aiResult, sessionId, request: lastAiRequest, refreshSettings, start: startAi, cancel: cancelAi, reset: resetAi } = useAiTasks()
const extracting = computed(() => lastAiRequest.value?.action === 'extract')
const aiSearchMode = ref(false)
type View = 'graph' | 'resources' | 'import' | 'models' | 'data'
const view = ref<View>('graph')
const modelSettingsBusy = ref(false)
const showDirectory = ref(false)
const directoryPath = ref('')
const previewResource = ref<ResourceItem | null>(null)
const importSource = ref<ResourceItem | null>(null)
const importGeneration = ref(0)
const importDirty = ref(false)
const resourceDirty = ref(false)
const pendingSpaceChange = ref<{ kind: 'switch' | 'create'; value: string } | null>(null)
const spaceKey = computed(() => data.value.root + ':' + data.value.spaceId + ':' + data.value.epoch)
const adopting = ref(false)
const adoptError = ref('')
const adopted = ref<AiImportRecord | null>(null)
const duplicateAdoption = ref(false)
const searchFloating = ref<HTMLDivElement | null>(null)
const detailsFloating = ref<HTMLDivElement | null>(null)
const canvasWorkspace = ref<HTMLDivElement | null>(null)
const searchOpen = ref(true)
const compactGraph = ref(false)
const searchVisible = computed(() => searchOpen.value && !(compactGraph.value && selectedPoint.value))
const viewportInsets = ref({ left: 0, right: 0, top: 16, bottom: 76 })
let panelObserver: ResizeObserver | undefined
function measurePanels() {
  const width = canvasWorkspace.value?.getBoundingClientRect().width || 0
  if (!width) return
  compactGraph.value = width < 1060
  viewportInsets.value = { left: searchVisible.value ? (searchFloating.value?.getBoundingClientRect().width || 0) + 32 : 16, right: selectedPoint.value ? (detailsFloating.value?.getBoundingClientRect().width || 0) + 32 : 16, top: 16, bottom: 76 }
}
function toggleSearch() {
  const opening = !searchVisible.value
  if (opening && compactGraph.value) selectedId.value = null
  searchOpen.value = opening
}
function navigate(target: View) { if (busy.value || modelSettingsBusy.value) return; view.value = target; if (location.hash !== '#' + target) history.pushState(null, '', '#' + target) }
function loadHash() { const hash = location.hash.slice(1); view.value = ['graph','resources','import','models','data'].includes(hash) ? hash as View : 'graph'; if (hash !== view.value) history.replaceState(null, '', '#' + view.value) }
function locate(id: string) { navigate('graph'); void nextTick(() => selectPoint(id)) }
function showKnowledgeTask() { aiSearchMode.value = true; selectedId.value = null; searchOpen.value = true; navigate('graph') }
async function freshImport() {
  if (busy.value) return
  const key = spaceKey.value
  await cancelAi()
  if (spaceKey.value !== key) return
  resetAi(); importSource.value = null; previewResource.value = null
  clearAdoption(); importGeneration.value++; navigate('import')
}
async function startImport(resource?: ResourceItem) {
  if (busy.value) return
  if (!resource) { navigate('import'); return }
  const key = spaceKey.value
  await freshImport()
  if (spaceKey.value === key) importSource.value = resource
}
async function adoptCandidates(input: AiAdoptInput) {
  if (busy.value || adopting.value) return
  adopting.value = true; busy.value = true; adoptError.value = ''; toast.value = ''
  const key = spaceKey.value
  try { const response = await invoke<{snapshot: Snapshot; record: AiImportRecord; duplicate: boolean}>('ai_adopt', { input }); if (spaceKey.value !== key || !accept(response.snapshot)) return; adopted.value = response.record; duplicateAdoption.value = response.duplicate; notify(response.duplicate ? '这份文本已采用' : '知识已保存到本机') }
  catch (e) { if (spaceKey.value === key) adoptError.value = errorText(e) }
  finally { busy.value = false; adopting.value = false }
}
function clearAdoption() { adopted.value = null; duplicateAdoption.value = false; adoptError.value = '' }
function clearWorkspace() { resetAi(); importSource.value = null; clearAdoption(); previewResource.value = null; editingPoint.value = null; deletingId.value = null; selectedId.value = null; clearSearch(); importDirty.value = false; resourceDirty.value = false; importGeneration.value++; aiSearchMode.value = false }
async function applySpaceChange(change: {kind: 'switch' | 'create'; value: string}) {
  if (busy.value || modelSettingsBusy.value) return false
  resetAi()
  const ok = change.kind === 'switch' ? await spaceSwitch(change.value) : await spaceCreate(change.value)
  if (ok) { clearWorkspace(); pendingSpaceChange.value = null }
  return ok
}
async function requestSpaceChange(kind: 'switch' | 'create', value: string) {
  if (kind === 'switch' && value === data.value.spaceId) return true
  if (editingPoint.value || importDirty.value || resourceDirty.value || aiBusy.value) { pendingSpaceChange.value = { kind, value }; return true }
  return applySpaceChange({ kind, value })
}
const switchSpace = (id: string) => requestSpaceChange('switch', id)
const createSpace = (name: string) => requestSpaceChange('create', name)
async function chooseDirectory() { try { const path = await invoke<string | null>('choose_directory'); if (path) directoryPath.value = path } catch (e) { error.value = errorText(e) } }
function readablePath(path: string) { return path.startsWith('\\\\?\\UNC\\') ? '\\\\' + path.slice(8) : path.startsWith('\\\\?\\') ? path.slice(4) : path }
function openDirectory() { directoryPath.value = readablePath(data.value.root); showDirectory.value = true }
async function changeDirectory(create: boolean) { await cancelAi(); if (await directorySelect(directoryPath.value, create)) { clearWorkspace(); showDirectory.value = false; graphKey.value++ } }
watch([() => Boolean(selectedPoint.value), searchVisible], async () => { await nextTick(); measurePanels() })
watch(view, async () => { await nextTick(); if (view.value === 'graph') measurePanels() })
onMounted(async () => { loadHash(); window.addEventListener('hashchange', loadHash); panelObserver = new ResizeObserver(measurePanels); for (const panel of [canvasWorkspace.value, searchFloating.value, detailsFloating.value]) if (panel) panelObserver.observe(panel); measurePanels(); if (!(await load())) showDirectory.value = true; void refreshSettings() })
onBeforeUnmount(() => { panelObserver?.disconnect(); window.removeEventListener('hashchange', loadHash) })
</script>

<template>
  <DesktopShell :view="view" :disabled="busy || modelSettingsBusy" @navigate="navigate">
    <template #workspace><SpaceSwitcher :spaces="data.spaces" :current-id="data.spaceId" :busy="busy || modelSettingsBusy" :switch-space="switchSpace" :create-space="createSpace" :rename-space="spaceRename" /></template>
    <template #actions>
      <span class="save-status" role="status"><span v-if="busy" class="spinner small" /><Icon v-else :name="error ? 'alert' : 'check'" :size="15" />{{ busy ? '正在处理…' : error ? '操作失败' : loaded ? '已保存' : '尚未打开数据' }}</span>
      <button v-if="view === 'graph'" class="button" :aria-expanded="searchVisible" aria-controls="knowledge-search" @click="toggleSearch"><Icon name="search" :size="16" />{{ searchVisible ? '收起搜索' : '查找知识' }}</button>
      <button v-if="view === 'graph' && graphState === 'unavailable'" class="button" :disabled="busy" @click="restoreGraph">重新读取图谱</button>
      <button v-if="view === 'graph'" class="button button-primary" data-testid="create-point" :disabled="!loaded || busy" @click="beginCreate"><Icon name="plus" :size="15" />新建知识点</button>
    </template>
    <div v-if="error" class="storage-error" role="alert" data-testid="storage-error"><Icon name="alert" :size="17" /><span>{{ error }}</span><button class="button" :disabled="busy" @click="load">重新读取</button><button class="button" @click="showDirectory = true">选择目录</button></div>

    <div ref="canvasWorkspace" v-show="view === 'graph'" class="canvas-workspace">
      <GraphBoundary :key="graphKey" @failure="graphState = 'unavailable'"><GraphCanvas v-if="loaded" :points="data.points" :positions="data.positions" :selected-id="selectedId" :graph-state="graphState" :busy="busy" :focus-request="focusRequest" :viewport-insets="viewportInsets" @select="selectPoint" @move="movePoint" @edit="beginEdit" @delete="requestDelete" @restore="restoreGraph" /></GraphBoundary>
      <div id="knowledge-search" ref="searchFloating" v-show="searchVisible" class="search-floating"><SearchPanel v-if="loaded" v-model:ai-mode="aiSearchMode" v-model:query="query" :keywords="keywords" v-model:mode="matchMode" :results="results" :points="data.points" :selected-id="selectedId" :has-query="effectiveTerms.length > 0" @add="addKeyword" @remove="keywords.splice($event, 1)" @clear="clearSearch" @select="selectPoint"><template #ai><AiKnowledgePanel :key="spaceKey" :points="data.points" :resources="data.resources" :busy="aiBusy && !extracting" :blocked="aiBusy && extracting" :error="!extracting ? aiError : ''" :phase="!extracting ? aiPhase : ''" :result="aiResult" :session-id="sessionId" :configured="!!activeConnection?.configured" :service-label="aiServiceLabel" @start="startAi" @cancel="cancelAi" @reset="resetAi" @show-task="navigate('import')" @settings="navigate('models')" @locate="locate" @preview="previewResource=$event" /></template></SearchPanel><div v-else class="search-panel glass-panel unread-data" role="status">请打开数据目录。</div></div>
      <div ref="detailsFloating" v-show="selectedPoint" class="details-floating"><KnowledgeDetails :point="selectedPoint" :points="data.points" :resources="data.resources" :delete-disabled="!graphReady || busy" @select="selectPoint" @edit="beginEdit" @delete="requestDelete" @preview="previewResource = $event" @close="selectedId = null" /></div>
    </div>
    <ResourceLibrary v-if="view === 'resources'" :key="spaceKey" :resources="data.resources" :points="data.points" :busy="busy" :enabled="loaded" :operation-error="error" :run="run" @preview="previewResource = $event" @import="startImport" @locate="locate" @error="error = $event" @dirty="resourceDirty = $event" />
    <ImportWorkspace v-show="view === 'import'" :key="spaceKey + ':' + importGeneration" :space-id="data.spaceId" :epoch="data.epoch" :points="data.points" :resources="data.resources" :source-resource="importSource" :result="aiResult" :busy="aiBusy && extracting" :blocked="aiBusy && !extracting" :adopting="adopting" :error="adoptError || (lastAiRequest?.action === 'extract' ? aiError : '')" :phase="extracting ? aiPhase : ''" :configured="!!activeConnection?.configured" :service-label="aiServiceLabel" :adopted="adopted" :duplicate="duplicateAdoption" :enabled="loaded" @start="startAi" @cancel="cancelAi" @adopt="adoptCandidates" @settings="navigate('models')" @locate="locate" @graph="navigate('graph')" @clear-adoption="clearAdoption" @show-task="showKnowledgeTask" @fresh="freshImport" @snapshot="accept" @dirty="importDirty = $event" />
    <section v-if="view === 'models' || view === 'data'" class="settings-workspace">
      <nav class="settings-tabs" aria-label="应用设置"><button :class="{active:view==='models'}" :aria-current="view==='models'?'page':undefined" :disabled="modelSettingsBusy" @click="navigate('models')">模型设置</button><button :class="{active:view==='data'}" :aria-current="view==='data'?'page':undefined" :disabled="modelSettingsBusy" @click="navigate('data')">数据位置</button></nav>
      <AiSettingsPanel v-if="view === 'models'" :task-busy="aiBusy" @saved="aiSettings=$event" @busy="modelSettingsBusy=$event" />
      <section v-else class="data-settings glass-panel" aria-labelledby="data-settings-title"><h2 id="data-settings-title">数据位置</h2><div class="data-location"><Icon name="book" :size="24" /><strong>{{ data.root ? readablePath(data.root).split(/[\\/]/).filter(Boolean).at(-1) : '尚未打开数据目录' }}</strong><button class="button" aria-label="数据目录设置" :disabled="busy" @click="openDirectory">更换数据目录</button></div></section>
    </section>
    <Transition name="toast"><div v-if="toast" class="toast-message" role="status"><Icon name="check" :size="16" />{{ toast }}</div></Transition>
    <KnowledgeEditor v-if="editingPoint" :point="editingPoint" :points="data.points" :resources="data.resources" :creating="creatingPoint" :busy="busy" :operation-error="error" @save="savePoint" @close="!busy && (editingPoint = null)" />
    <DeleteConfirmation v-if="deletingPoint" :point="deletingPoint" :points="data.points" :resources="data.resources" :impact="deleteImpact" :busy="busy" :operation-error="error" @confirm="confirmDelete" @close="!busy && (deletingId = null)" />
    <ResourcePreview v-if="previewResource" :key="spaceKey + previewResource.id" :space-id="data.spaceId" :epoch="data.epoch" :resource="previewResource" @close="previewResource = null" @import="startImport" />
    <ModalShell v-if="pendingSpaceChange" title="切换空间" @close="pendingSpaceChange = null"><p>放弃未保存的编辑和候选，并取消当前任务？</p><footer class="dialog-actions"><button class="button" @click="pendingSpaceChange = null">继续当前工作</button><button class="button button-primary" data-testid="space-confirm-switch" :disabled="busy" @click="applySpaceChange(pendingSpaceChange)">放弃并切换</button></footer></ModalShell>
    <ModalShell v-if="showDirectory" title="本机数据目录" @close="showDirectory = false"><label for="data-directory">目录位置</label><div class="directory-row"><input id="data-directory" v-model="directoryPath" class="field" aria-label="数据目录" placeholder="例如 D:\Noterion 数据" /><button class="button" :disabled="busy" @click="chooseDirectory">选择本机目录</button></div><p v-if="error" class="validation-message" role="alert">{{ error }}</p><div class="dialog-actions"><button class="button" :disabled="busy || !directoryPath.trim()" @click="changeDirectory(true)">创建新数据目录</button><button class="button button-primary" :disabled="busy || !directoryPath.trim()" @click="changeDirectory(false)">打开已有数据目录</button></div></ModalShell>
  </DesktopShell>
</template>
<style scoped>
.save-status{display:flex;align-items:center;gap:7px;font-size:13px;color:#555;white-space:nowrap}
.canvas-workspace{flex:1;min-height:0;border-radius:0;container-type:inline-size}.search-floating{width:300px;left:20px;top:20px;bottom:76px;max-height:calc(100% - 96px)}.details-floating{width:360px;right:20px;top:20px;bottom:76px;max-height:calc(100% - 96px)}.unread-data{padding:24px;font-size:14px;line-height:1.8}
.search-floating :deep(.glass-panel),.details-floating :deep(.glass-panel){background:#fafafa;backdrop-filter:none}
.storage-error{display:flex;flex-wrap:wrap;align-items:center;gap:10px;flex:none;margin:12px 18px 0;padding:10px 14px;border:1px solid #9c7373;border-radius:8px;background:#fff4f0;font-size:14px}.storage-error span{flex:1;min-width:150px;overflow-wrap:anywhere}.directory-row{display:flex;flex-wrap:wrap;gap:8px;margin:9px 0 22px}.directory-row input{flex:1;min-width:180px}.validation-message{line-height:1.7;color:#8f3c2d;margin-bottom:15px}
.settings-workspace{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0}.settings-tabs{display:flex;gap:8px;padding:16px 22px 8px;flex:none}.settings-tabs button{padding:9px 16px;border-radius:7px}.settings-tabs .active{background:#e0e0e0;font-weight:600}.data-settings{flex:1;margin:8px 16px 16px;padding:28px;overflow:auto;min-width:0}.data-settings h2{font-size:25px}.data-location{display:flex;align-items:center;flex-wrap:wrap;gap:16px;margin-top:30px;max-width:800px}.data-location strong{flex:1;min-width:160px;overflow-wrap:anywhere}
@container(max-width:1059px){.details-floating{width:min(360px,calc(100% - 40px))}.search-floating{width:min(320px,calc(100% - 40px))}}
@media(max-width:850px){.save-status{display:none}.settings-tabs{padding:12px 16px 4px}.data-settings{padding:22px}}
</style>
