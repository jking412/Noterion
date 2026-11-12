<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './components/Icon.vue'
import SearchPanel from './components/SearchPanel.vue'
import GraphCanvas from './components/GraphCanvas.vue'
import GraphBoundary from './components/GraphBoundary.vue'
import KnowledgeDetails from './components/KnowledgeDetails.vue'
import KnowledgeEditor from './components/KnowledgeEditor.vue'
import DeleteConfirmation from './components/DeleteConfirmation.vue'
import ResourcePreview from './components/ResourcePreview.vue'
import ResourceLibrary from './components/ResourceLibrary.vue'
import ModalShell from './components/ModalShell.vue'
import type { ResourceItem } from './domain/types'
import { useNoterion } from './composables/useNoterion'
import { invoke, errorText } from './desktop'

const { data, loaded, error, busy, toast, query, keywords, matchMode, selectedId, editingPoint, creatingPoint, deletingId, deletingPoint, deleteImpact, graphState, graphKey, focusRequest, effectiveTerms, results, selectedPoint, graphReady, notify, run, load, selectPoint, addKeyword, clearSearch, beginCreate, beginEdit, savePoint, requestDelete, confirmDelete, movePoint, restoreGraph, directorySelect } = useNoterion()
type View = 'graph' | 'resources' | 'import' | 'records'
const view = ref<View>('graph')
const showDirectory = ref(false)
const directoryPath = ref('')
const previewResource = ref<ResourceItem | null>(null)
const importSource = ref<ResourceItem | null>(null)
const searchFloating = ref<HTMLDivElement | null>(null)
const detailsFloating = ref<HTMLDivElement | null>(null)
const viewportInsets = ref({ left: 0, right: 0, top: 16, bottom: 76 })
let panelObserver: ResizeObserver | undefined
function measurePanels() { viewportInsets.value = { left: (searchFloating.value?.getBoundingClientRect().width || 0) + 32, right: selectedPoint.value ? (detailsFloating.value?.getBoundingClientRect().width || 0) + 32 : 16, top: 16, bottom: 76 } }
function navigate(target: View) { if (busy.value) return; view.value = target; if (location.hash !== '#' + target) history.pushState(null, '', '#' + target) }
function loadHash() { const hash = location.hash.slice(1); view.value = ['graph','resources','import','records'].includes(hash) ? hash as View : 'graph' }
function locate(id: string) { navigate('graph'); void nextTick(() => selectPoint(id)) }
function startImport(resource?: ResourceItem) { if (busy.value) return; importSource.value = resource ?? null; previewResource.value = null; navigate('import') }
async function chooseDirectory() { try { const path = await invoke<string | null>('choose_directory'); if (path) directoryPath.value = path } catch (e) { error.value = errorText(e) } }
async function changeDirectory(create: boolean) { if (await directorySelect(directoryPath.value, create)) { previewResource.value = null; editingPoint.value = null; deletingId.value = null; selectedId.value = null; showDirectory.value = false; graphKey.value++ } }
watch(() => Boolean(selectedPoint.value), async () => { await nextTick(); measurePanels() })
watch(view, async () => { await nextTick(); if (view.value === 'graph') measurePanels() })
onMounted(async () => { loadHash(); window.addEventListener('hashchange', loadHash); panelObserver = new ResizeObserver(measurePanels); if (searchFloating.value) panelObserver.observe(searchFloating.value); if (detailsFloating.value) panelObserver.observe(detailsFloating.value); measurePanels(); if (!(await load())) showDirectory.value = true })
onBeforeUnmount(() => { panelObserver?.disconnect(); window.removeEventListener('hashchange', loadHash) })
</script>

<template>
  <main class="app-shell" :class="{ 'has-selection': selectedPoint }">
    <header class="app-header glass-panel">
      <div class="brand"><button :disabled="busy" class="wordmark" aria-label="Noterion 知识图谱" @click="navigate('graph')">Noterion</button><nav class="main-nav" aria-label="主导航"><button :disabled="busy" :class="{ active: view === 'graph' }" @click="navigate('graph')"><Icon name="layers" :size="16" />知识图谱</button><button :disabled="busy" :class="{ active: view === 'resources' }" @click="navigate('resources')"><Icon name="book" :size="16" />资料库</button><button :disabled="busy" :class="{ active: view === 'import' }" @click="startImport()"><Icon name="file" :size="16" />知识导入</button><button :disabled="busy" :class="{ active: view === 'records' }" @click="navigate('records')"><Icon name="clock" :size="16" />导入记录</button></nav></div>
      <div class="header-actions"><button v-if="view === 'graph'" class="button button-primary" data-testid="create-point" :disabled="!loaded || busy" @click="beginCreate"><Icon name="plus" :size="15" />新建知识点</button><span class="save-indicator" role="status"><span v-if="busy" class="spinner small" /><Icon v-else :name="error ? 'alert' : 'check'" :size="15" />{{ busy ? '正在保存…' : error ? '操作失败，请查看错误' : loaded ? '已保存到本机' : '尚未打开数据' }}</span><button class="button" aria-label="数据目录设置" :disabled="busy" @click="directoryPath = data.root; showDirectory = true">数据目录</button></div>
    </header>
    <div v-if="error" class="storage-error" role="alert" data-testid="storage-error"><Icon name="alert" :size="17" /><span>{{ error }}</span><button class="button" :disabled="busy" @click="load">重新读取</button><button class="button" @click="showDirectory = true">选择目录</button></div>
    <div class="storage-location" :title="data.root">{{ loaded ? '当前数据：' + data.root : '请选择可写的本机数据目录' }}<button v-if="graphState === 'unavailable'" class="text-button" @click="restoreGraph">恢复图谱</button><button v-else class="text-button" :disabled="busy" @click="restoreGraph">重新读取图谱</button></div>
    <div v-show="view === 'graph'" class="canvas-workspace">
      <GraphBoundary :key="graphKey" @failure="graphState = 'unavailable'"><GraphCanvas v-if="loaded" :points="data.points" :positions="data.positions" :selected-id="selectedId" :graph-state="graphState" :focus-request="focusRequest" :viewport-insets="viewportInsets" @select="selectPoint" @move="movePoint" @edit="beginEdit" @delete="requestDelete" @restore="restoreGraph" /></GraphBoundary>
      <div ref="searchFloating" class="search-floating"><SearchPanel v-if="loaded" v-model:query="query" :keywords="keywords" v-model:mode="matchMode" :results="results" :points="data.points" :selected-id="selectedId" :has-query="effectiveTerms.length > 0" @add="addKeyword" @remove="keywords.splice($event, 1)" @clear="clearSearch" @select="selectPoint" /><div v-else class="search-panel glass-panel unread-data" role="status">尚未读取本机知识。请先选择数据目录或重新读取。</div></div>
      <div ref="detailsFloating" v-show="selectedPoint" class="details-floating"><KnowledgeDetails :point="selectedPoint" :points="data.points" :resources="data.resources" :delete-disabled="!graphReady || busy" @select="selectPoint" @edit="beginEdit" @delete="requestDelete" @preview="previewResource = $event" @close="selectedId = null" /></div>
    </div>
    <ResourceLibrary v-if="view === 'resources'" :resources="data.resources" :points="data.points" :busy="busy" :enabled="loaded" :operation-error="error" :run="run" @preview="previewResource = $event" @import="startImport" @locate="locate" @error="error = $event" />
    <section v-if="view === 'import' || view === 'records'" class="pending-page glass-panel"><div><Icon name="file" :size="34" /><h1>{{ view === 'import' ? '从学习笔记整理知识' : '导入记录' }}</h1><p v-if="importSource && view === 'import'">当前资料：{{ importSource.title }}</p><p>AI 纯文本提取流程尚待确定，当前未接入自动提取。模型、联网方式与资料发送权限将在确认后提供。</p><p>你现在可以手工新建知识点，填写名称和自己的理解，再关联资料。已有知识和本地资料可正常使用。</p><button class="button button-primary" :disabled="!loaded || busy" @click="beginCreate">新建知识点</button><button class="button" @click="navigate('resources')">返回资料库</button></div></section>
    <Transition name="toast"><div v-if="toast" class="toast-message" role="status"><Icon name="check" :size="16" />{{ toast }}</div></Transition>
    <KnowledgeEditor v-if="editingPoint" :point="editingPoint" :points="data.points" :resources="data.resources" :creating="creatingPoint" :busy="busy" :operation-error="error" @save="savePoint" @close="!busy && (editingPoint = null)" />
    <DeleteConfirmation v-if="deletingPoint" :point="deletingPoint" :points="data.points" :resources="data.resources" :impact="deleteImpact" :busy="busy" :operation-error="error" @confirm="confirmDelete" @close="!busy && (deletingId = null)" />
    <ResourcePreview v-if="previewResource" :resource="previewResource" @close="previewResource = null" @import="startImport" />
    <ModalShell v-if="showDirectory" title="本机数据目录" @close="showDirectory = false"><p class="directory-copy">结构化数据与资料副本一起保存在此目录。创建用于空目录；打开用于已有 Noterion 数据，不会搬迁或合并原目录。</p><label for="data-directory">目录位置</label><div class="directory-row"><input id="data-directory" v-model="directoryPath" class="field" aria-label="数据目录" placeholder="例如 D:\Noterion 数据" /><button class="button" :disabled="busy" @click="chooseDirectory">选择本机目录</button></div><p v-if="error" class="validation-message" role="alert">{{ error }}</p><div class="dialog-actions"><button class="button" :disabled="busy || !directoryPath.trim()" @click="changeDirectory(true)">创建新数据目录</button><button class="button button-primary" :disabled="busy || !directoryPath.trim()" @click="changeDirectory(false)">打开已有数据目录</button></div></ModalShell>
  </main>
</template>
<style scoped>
.unread-data { padding: 24px; line-height: 1.9; color: #666; font-size: 14px; }.app-shell { display: flex; flex-direction: column; }.app-header { flex-shrink: 0; min-height: 62px; }.canvas-workspace,.resource-library-page,.pending-page { flex: 1; }.storage-location,.storage-error { flex-shrink: 0; }
.storage-error { display: flex; align-items: center; gap: 10px; margin: 0 16px 6px; padding: 10px 16px; border: 1px solid #9c7373; border-radius: 8px; background: #fff4f0; font-size: 13px; }.storage-error span { flex: 1; overflow-wrap: anywhere; }.storage-location { display: flex; justify-content: space-between; gap: 18px; padding: 1px 22px 9px; font-size: 11px; color: #666; overflow-wrap: anywhere; }.directory-copy { line-height: 1.8; font-size: 14px; margin-bottom: 18px; }.directory-row { display: flex; gap: 8px; margin: 9px 0 22px; }.directory-row input { flex: 1; min-width: 0; }.pending-page { margin: 8px 16px 16px; display: grid; place-items: center; padding: 60px; }.pending-page>div { max-width: 620px; }.pending-page h1 { font-size: 25px; margin: 20px 0; }.pending-page p { color: #646464; line-height: 1.9; margin: 14px 0; }.pending-page .button { margin: 16px 10px 0 0; }.validation-message { line-height: 1.7; color: #8f3c2d; margin-bottom: 15px; }
</style>
