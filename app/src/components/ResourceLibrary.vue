<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { KnowledgePoint, ResourceItem } from '../domain/types'
import { decodeResourceText, formatBytes, MAX_RESOURCE_BYTES, MAX_RESOURCE_FILES, resourceKind, resourceLabel, suggestedResourceId, validResourceUrl } from '../domain/resources'
import Icon from './Icon.vue'
import ModalShell from './ModalShell.vue'

const props = defineProps<{ resources: ResourceItem[]; points: KnowledgePoint[] }>()
const emit = defineEmits<{ add: [resources: ResourceItem[], pointIds: string[]]; associate: [resourceId: string, pointIds: string[]]; preview: [resource: ResourceItem]; import: [resource: ResourceItem]; locate: [id: string]; remove: [resourceId: string] }>()
const query = ref('')
const filter = ref('all')
const showAdd = ref(false)
const inputMode = ref<'file' | 'link'>('file')
const fileInput = ref<HTMLInputElement | null>(null)
const drafts = ref<ResourceItem[]>([])
const selectedPoints = ref<string[]>([])
const pointQuery = ref('')
const errors = ref<string[]>([])
const reading = ref(false)
const dragging = ref(false)
const link = ref({ id: '', title: '', url: '' })
const customLinkId = ref(false)
const associating = ref<ResourceItem | null>(null)
const removing = ref<ResourceItem | null>(null)
const expandedIds = ref(new Set<string>())
let readSequence = 0
const filtered = computed(() => props.resources.filter((resource) => {
  const text = `${resource.title}\n${resource.filename ?? ''}\n${resource.id}`.toLowerCase()
  return (filter.value === 'all' || resource.kind === filter.value) && text.includes(query.value.trim().toLowerCase())
}))
const filteredPoints = computed(() => props.points.filter((point) => point.name.toLowerCase().includes(pointQuery.value.trim().toLowerCase())))
const kinds = computed(() => [...new Set(props.resources.map((resource) => resource.kind))])
const canImportAfterAdd = computed(() => inputMode.value === 'link' || drafts.value.length === 1)
function linkedPoints(id: string) { return props.points.filter((point) => point.resourceIds.includes(id)) }
function visibleLinkedPoints(id: string) { const points = linkedPoints(id); return expandedIds.value.has(id) ? points : points.slice(0, 3) }
function toggleLinkedPoints(id: string) { if (expandedIds.value.has(id)) expandedIds.value.delete(id); else expandedIds.value.add(id) }
watch(() => [link.value.title, link.value.url], () => {
  if (customLinkId.value) return
  const validUrl = validResourceUrl(link.value.url)
  const name = link.value.title.trim() || (validUrl ? new URL(validUrl).hostname : '')
  if (!name) { link.value.id = ''; return }
  const base = suggestedResourceId(name + '.link')
  let id = base
  let suffix = 2
  while (props.resources.some((resource) => resource.id === id)) id = `${base}-${suffix++}`
  link.value.id = id
})
function releaseDrafts() {
  drafts.value.forEach((resource) => { if (resource.blobUrl) URL.revokeObjectURL(resource.blobUrl) })
  drafts.value = []
}
function closeAdd() {
  readSequence++
  releaseDrafts()
  reading.value = false
  showAdd.value = false
  errors.value = []
}
function openAdd() {
  releaseDrafts()
  selectedPoints.value = []; pointQuery.value = ''; errors.value = []
  customLinkId.value = false
  link.value = { id: '', title: '', url: '' }
  inputMode.value = 'file'; showAdd.value = true
}
async function readFiles(files: File[]) {
  if (!files.length) return
  const sequence = ++readSequence
  releaseDrafts(); errors.value = []; reading.value = false
  if (files.length > MAX_RESOURCE_FILES) { errors.value = ['一次最多添加 50 个文件，请减少文件数量。']; return }
  const tooLarge = files.filter((file) => file.size > MAX_RESOURCE_BYTES)
  if (tooLarge.length) { errors.value = tooLarge.map((file) => `${file.name} 超过 20 MB，未添加任何文件。`); return }
  reading.value = true
  const next: ResourceItem[] = []
  const failures: string[] = []
  for (const file of files) {
    try {
      const kind = resourceKind(file.name)
      const content = ['text', 'markdown', 'html'].includes(kind) ? decodeResourceText(await file.arrayBuffer()) : undefined
      const mime = kind === 'pdf' ? 'application/pdf' : kind === 'image' ? ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' }[file.name.split('.').at(-1)?.toLowerCase() ?? ''] || file.type) : 'application/octet-stream'
      const baseId = suggestedResourceId(file.name)
      let id = baseId
      let suffix = 2
      while (props.resources.some((resource) => resource.id === id) || next.some((resource) => resource.id === id)) id = `${baseId}-${suffix++}`
      next.push({ id, title: file.name, filename: file.name, kind, content, size: file.size, mime, blobUrl: URL.createObjectURL(new Blob([file], { type: mime })) })
    } catch {
      failures.push(`${file.name} 无法读取；文本资料请保存为 UTF-8 后重试。`)
    }
  }
  if (sequence !== readSequence || failures.length) {
    next.forEach((resource) => { if (resource.blobUrl) URL.revokeObjectURL(resource.blobUrl) })
    if (sequence === readSequence) { errors.value = failures; reading.value = false }
    return
  }
  drafts.value = next; reading.value = false
}
function chooseFiles(event: Event) {
  const input = event.target as HTMLInputElement
  void readFiles(Array.from(input.files ?? []))
  input.value = ''
}
function dropFiles(event: DragEvent) {
  dragging.value = false
  void readFiles(Array.from(event.dataTransfer?.files ?? []))
}
function saveResources(importAfterAdd = false) {
  errors.value = []
  const resources: ResourceItem[] = inputMode.value === 'file' ? drafts.value.map((resource) => ({ ...resource, id: resource.id.trim(), title: resource.title.trim() })) : [{ id: link.value.id.trim(), title: link.value.title.trim(), kind: 'link', url: validResourceUrl(link.value.url) ?? '' }]
  if (!resources.length) errors.value.push('请先选择资料文件。')
  if (inputMode.value === 'link' && !resources[0]?.url) errors.value.push('请输入有效的 http:// 或 https:// 链接，地址中不能包含账号和密码。')
  const seen = new Set(props.resources.map((resource) => resource.id))
  for (const resource of resources) {
    if (!resource.title) errors.value.push('资料名称不能为空。')
    if (!resource.id || /[;\s]/u.test(resource.id)) errors.value.push('资料标识不能为空，不能含空白或分号。')
    if (seen.has(resource.id)) errors.value.push(`资料标识 ${resource.id} 已存在，请修改标识或取消后复用资料库中的资料。`)
    seen.add(resource.id)
  }
  if (errors.value.length || reading.value) return
  if (importAfterAdd && resources.length !== 1) return
  if (inputMode.value === 'link') releaseDrafts()
  query.value = ''; filter.value = 'all'
  emit('add', resources, [...selectedPoints.value])
  // The parent now owns these URLs until reset/unmount; no revocation on preview close.
  drafts.value = []; showAdd.value = false
  if (importAfterAdd) emit('import', resources[0]!)
}
function openAssociation(resource: ResourceItem) {
  associating.value = resource
  selectedPoints.value = linkedPoints(resource.id).map((point) => point.id)
  pointQuery.value = ''
}
function saveAssociation() {
  if (!associating.value) return
  emit('associate', associating.value.id, [...selectedPoints.value])
  associating.value = null
}
function importFromAssociation() {
  if (!associating.value) return
  const resource = associating.value
  associating.value = null
  emit('import', resource)
}
function confirmRemove() {
  if (!removing.value) return
  const id = removing.value.id
  removing.value = null
  expandedIds.value.delete(id)
  emit('remove', id)
}
onBeforeUnmount(() => { readSequence++; releaseDrafts() })
</script>

<template>
  <section class="resource-library-page glass-panel" aria-label="资料库">
    <header class="library-heading">
      <div><div class="library-eyebrow">LEARNING MATERIALS</div><h1>资料库 <span>{{ resources.length }}</span></h1><p>从每份资料导入知识，或关联已有知识点。</p></div>
      <button class="button button-primary" @click="openAdd"><Icon name="plus" :size="17" />添加资料</button>
    </header>
    <div class="library-toolbar">
      <label class="library-search"><Icon name="search" :size="17" /><input v-model="query" aria-label="搜索资料" placeholder="搜索名称、文件名或资料标识" /><button v-if="query" aria-label="清空资料搜索" @click="query = ''"><Icon name="close" :size="15" /></button></label>
      <select v-model="filter" class="field" aria-label="资料类型"><option value="all">全部类型</option><option v-for="kind in kinds" :key="kind" :value="kind">{{ resourceLabel(kind) }}</option></select>
      <span class="library-filter-count">{{ filtered.length }} 份资料</span>
    </div>
    <div class="library-list">
      <div class="library-table-labels" aria-hidden="true"><span>学习资料</span><span>关联知识点</span><span>操作</span></div>
      <article v-for="resource in filtered" :key="resource.id" class="library-row" :aria-label="`学习资料：${resource.title}`">
        <div class="library-resource"><div class="library-file-icon"><Icon :name="resource.kind === 'link' ? 'external' : 'file'" :size="23" /></div><div><h2>{{ resource.title }}</h2><div class="library-meta"><span>{{ resourceLabel(resource.kind) }}</span><span v-if="resource.size !== undefined">{{ formatBytes(resource.size) }}</span><code>{{ resource.id }}</code></div><p v-if="resource.url" class="library-url" :title="resource.url">{{ resource.url }}</p></div></div>
        <div class="library-associations"><button v-for="point in visibleLinkedPoints(resource.id)" :key="point.id" class="tag library-point-link" :title="`查看知识点：${point.name}`" @click="emit('locate', point.id)">{{ point.name }}</button><button v-if="linkedPoints(resource.id).length > 3" class="library-extra text-button" :aria-expanded="expandedIds.has(resource.id)" @click="toggleLinkedPoints(resource.id)">{{ expandedIds.has(resource.id) ? '收起' : `另 ${linkedPoints(resource.id).length - 3} 个` }}</button><span v-if="!linkedPoints(resource.id).length" class="muted">尚未关联知识点</span></div>
        <div class="library-row-actions"><div class="library-main-actions"><button class="button button-primary" @click="emit('import', resource)">导入知识</button><button class="button" @click="emit('preview', resource)">{{ resource.kind === 'file' ? '查看文件' : resource.kind === 'link' ? '查看链接' : '预览' }}</button><button class="button" @click="openAssociation(resource)">关联知识点</button></div><button class="text-button library-remove" @click="removing = resource">移除资料</button></div>
      </article>
      <div v-if="!filtered.length" class="library-empty"><Icon name="book" :size="32" /><h2>{{ resources.length ? '未找到匹配资料' : '添加第一份学习资料' }}</h2><p>{{ resources.length ? '换一个关键词，或切换资料类型。' : '添加文件或网页链接，再从该资料导入知识。' }}</p><button v-if="resources.length" class="button" @click="query = ''; filter = 'all'">清除筛选</button><button v-else class="button button-primary" @click="openAdd">添加资料</button></div>
    </div>
    <footer class="library-page-footer">文件在当前页面内读取与使用；刷新或重置演示后需重新添加。</footer>
  </section>
  <ModalShell v-if="showAdd" title="添加学习资料" wide @close="closeAdd">
    <form class="resource-add-form" novalidate @submit.prevent="saveResources(canImportAfterAdd)">
      <div class="resource-form-main">
        <div class="resource-mode" role="group" aria-label="资料来源"><button type="button" :class="{ selected: inputMode === 'file' }" @click="inputMode = 'file'; errors = []">本地文件</button><button type="button" :class="{ selected: inputMode === 'link' }" @click="inputMode = 'link'; errors = []">网页链接</button></div>
        <template v-if="inputMode === 'file'">
          <input ref="fileInput" class="sr-only" type="file" multiple tabindex="-1" aria-label="选择资料文件" @change="chooseFiles" />
          <button type="button" class="resource-drop" :class="{ dragging }" :disabled="reading" @click="fileInput?.click()" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="dropFiles"><Icon :name="reading ? 'refresh' : 'file'" :size="30" /><strong>{{ reading ? '正在读取资料…' : '选择文件，或拖放至此处' }}</strong><span>每份不超过 20 MB，一次最多 50 份</span><small>TXT / Markdown / HTML / PDF / 图片可预览，其他格式下载后打开</small></button>
          <div v-if="drafts.length" class="resource-drafts"><article v-for="(resource, index) in drafts" :key="index" class="resource-draft"><div class="draft-file-name"><Icon name="file" :size="16" /><span>{{ resource.filename }}</span><small>{{ formatBytes(resource.size) }}</small></div><label>资料名称<input v-model="resource.title" class="field" :aria-label="`资料名称 ${index + 1}`" /></label><details class="resource-identifier" :open="errors.some((error) => error.includes('标识'))"><summary>资料标识 · 已自动生成</summary><label>资料标识<input v-model="resource.id" class="field resource-id-input" :aria-label="`资料标识 ${index + 1}`" spellcheck="false" /></label></details></article></div>
        </template>
        <div v-else class="resource-link-fields"><label for="resource-link-title">资料名称</label><input id="resource-link-title" v-model="link.title" class="field" placeholder="例如 Docker 官方文档" /><label for="resource-link-url">网页地址</label><input id="resource-link-url" v-model="link.url" class="field" type="url" placeholder="https://…" /><details class="resource-identifier" :open="errors.some((error) => error.includes('标识'))"><summary>资料标识 · 自动生成，可修改</summary><label for="resource-link-id">资料标识</label><input id="resource-link-id" v-model="link.id" class="field resource-id-input" placeholder="填写名称后自动生成" spellcheck="false" @input="customLinkId = true" /></details></div>
        <p class="resource-form-help">从资料导入知识时会自动关联来源，无需填写资料标识。手工编写模板时，可展开标识查看或修改。</p>
        <div v-if="errors.length" class="resource-errors" role="alert"><p v-for="(error, index) in errors" :key="index"><Icon name="alert" :size="15" />{{ error }}</p></div>
      </div>
      <fieldset class="resource-points"><legend>关联已有知识点 <span>可选 · 已选 {{ selectedPoints.length }}</span></legend><p>{{ points.length ? '可现在关联，也可以稍后从资料库中维护。' : '还没有知识点。添加资料后，可直接从这份资料导入知识。' }}</p><template v-if="points.length"><input v-model="pointQuery" class="field" placeholder="查找知识点" aria-label="查找要关联的知识点" /><div class="resource-point-list"><label v-for="point in filteredPoints" :key="point.id"><input v-model="selectedPoints" type="checkbox" :value="point.id" /><span>{{ point.name }}<small>{{ point.isTheme ? '主题' : '知识点' }}</small></span></label><p v-if="!filteredPoints.length" class="muted">没有匹配的知识点，试试其他名称。</p></div></template></fieldset>
      <footer class="resource-form-footer"><p v-if="inputMode === 'file' && drafts.length > 1" class="resource-batch-note">已选 {{ drafts.length }} 份资料；添加后可逐份导入知识。</p><button class="button" type="button" @click="closeAdd">取消</button><button v-if="canImportAfterAdd" class="button" type="button" :disabled="reading" @click="saveResources()">添加资料</button><button class="button button-primary" type="submit" :disabled="reading">{{ reading ? '读取中…' : canImportAfterAdd ? '添加并导入知识' : '添加资料' }}</button></footer>
    </form>
  </ModalShell>
  <ModalShell v-if="associating" title="关联知识点" @close="associating = null">
    <form class="resource-associate-form" @submit.prevent="saveAssociation"><div class="association-resource-title"><Icon name="file" />{{ associating.title }}</div><p class="resource-form-help">勾选后建立关联；取消勾选仅移除关联，资料仍保留在资料库。</p><input v-if="points.length" v-model="pointQuery" class="field" placeholder="查找知识点" aria-label="查找要关联的知识点" /><div class="resource-point-list association-point-list"><label v-for="point in filteredPoints" :key="point.id"><input v-model="selectedPoints" type="checkbox" :value="point.id" /><span>{{ point.name }}<small>{{ point.isTheme ? '主题' : '知识点' }}</small></span></label><p v-if="!filteredPoints.length" class="muted">{{ points.length ? '没有匹配的知识点，试试其他名称。' : '还没有知识点，可从这份资料导入知识后自动关联。' }}</p></div><footer class="resource-form-footer"><button type="button" class="button" @click="associating = null">取消</button><button v-if="points.length" type="submit" class="button button-primary">保存关联（{{ selectedPoints.length }}）</button><button v-else type="button" class="button button-primary" @click="importFromAssociation">从这份资料导入知识</button></footer></form>
  </ModalShell>
  <ModalShell v-if="removing" title="移除资料" @close="removing = null">
    <div class="resource-remove-copy"><p>确定从当前页面移除“<strong>{{ removing.title }}</strong>”？</p><p>会解除这份资料与 <strong>{{ linkedPoints(removing.id).length }} 个知识点</strong>的关联。知识点、导入记录和其他资料都会保留。</p><p class="muted">仅从本页移除，无法撤销。需要时可重新添加原文件或链接。</p></div>
    <footer class="resource-form-footer"><button class="button" type="button" @click="removing = null">取消</button><button class="button button-primary" type="button" @click="confirmRemove">移除资料</button></footer>
  </ModalShell>
</template>

<style scoped>
.resource-library-page { margin: 8px 16px 16px; min-height: 0; display: flex; flex-direction: column; overflow: hidden; padding: 28px 32px 0; }
.library-heading { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding-bottom: 26px; }
.library-eyebrow { color: #858585; font-family: 'Segoe UI',sans-serif; font-size: 10px; letter-spacing: 1.6px; margin-bottom: 8px; }
.library-heading h1 { font-size: 28px; font-weight: 650; line-height: 1.3; }
.library-heading h1 span { font-size: 15px; color: #777; margin-left: 8px; font-weight: 400; }
.library-heading p { color: #646464; margin-top: 10px; font-size: 13px; }
.library-toolbar { display: flex; gap: 12px; align-items: center; padding: 16px 0; border-top: 1px solid #dedede; }
.library-search { display: flex; gap: 9px; align-items: center; width: min(480px,55%); padding: 0 12px; height: 39px; background: #fff9; border: 1px solid #d1d1d1; border-radius: 8px; }
.library-search input { flex: 1; min-width: 0; background: transparent; border: 0; font-size: 13px; }
.library-search button { padding: 3px; }
.library-toolbar select { width: 132px; height: 39px; padding: 7px 10px; }
.library-filter-count { margin-left: auto; color: #777; font-size: 12px; }
.library-list { min-height: 0; flex: 1; overflow: auto; }
.library-table-labels, .library-row { display: grid; grid-template-columns: minmax(260px,1.25fr) minmax(180px,1fr) 296px; gap: 24px; align-items: center; }
.library-table-labels { font-size: 12px; color: #777; padding: 13px 16px; background: #e9e9e96b; border: 1px solid #dfdfdf; border-radius: 8px; }
.library-table-labels > :last-child { text-align: right; }
.library-row { padding: 22px 16px; border-bottom: 1px solid #dedede; }
.library-resource { display: flex; align-items: flex-start; gap: 14px; min-width: 0; }
.library-resource > div:last-child { min-width: 0; }
.library-file-icon { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 48px; border: 1px solid #d2d2d2; border-radius: 9px; background: linear-gradient(145deg,#fff,#eee9); color: #555; }
.library-resource h2 { font-size: 15px; font-weight: 600; line-height: 1.55; overflow-wrap: anywhere; }
.library-meta { display: flex; gap: 9px; flex-wrap: wrap; margin-top: 7px; color: #747474; font-size: 11px; align-items: baseline; }
.library-meta code { font: 11px Consolas,'Microsoft YaHei',monospace; overflow-wrap: anywhere; }
.library-url { font-size: 11px; color: #777; margin-top: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.library-associations { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; font-size: 12px; }
.library-associations .tag { white-space: normal; justify-content: flex-start; text-align: left; overflow-wrap: anywhere; }
.library-point-link { cursor: pointer; }
.library-point-link:hover { background: #dedede; }
.library-extra { color: #777; font-size: 11px; }
.library-row-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 9px; }
.library-main-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.library-row-actions .button { font-size: 12px; min-height: 36px; padding: 6px 11px; }
.library-remove { font-size: 12px; padding: 2px 0; }
.resource-remove-copy { font-size: 14px; line-height: 1.9; overflow-wrap: anywhere; padding-bottom: 20px; }
.resource-remove-copy p + p { margin-top: 12px; }
.resource-remove-copy .muted { font-size: 12px; }
.library-empty { display: flex; align-items: center; flex-direction: column; text-align: center; padding: 72px 24px; gap: 16px; color: #777; }
.library-empty h2 { color: #444; font-size: 17px; font-weight: 500; }
.library-empty p { font-size: 13px; }
.library-page-footer { flex: 0 0 auto; padding: 15px 0; color: #777; font-size: 12px; }
.resource-add-form { display: grid; grid-template-columns: minmax(0,1.4fr) minmax(220px,1fr); gap: 24px; }
.resource-form-main { min-width: 0; }
.resource-mode { display: flex; gap: 4px; padding: 4px; background: #e9e9e9; border-radius: 9px; margin-bottom: 18px; }
.resource-mode button { flex: 1; padding: 8px; border-radius: 6px; font-size: 13px; }
.resource-mode button.selected { background: #fff; box-shadow: 0 1px 5px #0000000b; font-weight: 600; }
.resource-drop { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 13px; width: 100%; min-height: 210px; border: 1px dashed #aaa; border-radius: 12px; background: #ffffffb5; padding: 25px 20px; text-align: center; }
.resource-drop:hover, .resource-drop.dragging { border-color: #444; background: #eee; }
.resource-drop strong { font-size: 14px; font-weight: 500; }
.resource-drop span { font-size: 12px; color: #646464; }
.resource-drop small { font-size: 11px; color: #777; line-height: 1.7; }
.resource-drafts { margin-top: 14px; display: flex; flex-direction: column; gap: 12px; max-height: 330px; overflow: auto; padding: 2px; }
.resource-draft { background: #ffffffa8; border: 1px solid #d5d5d5; padding: 14px; border-radius: 8px; }
.draft-file-name { display: flex; gap: 7px; align-items: center; margin-bottom: 13px; min-width: 0; font-size: 12px; }
.draft-file-name span { flex: 1; overflow-wrap: anywhere; }
.draft-file-name small { color: #777; flex-shrink: 0; font-size: 10px; }
.resource-draft label { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; font-size: 12px; color: #555; }
.resource-id-input { font-family: Consolas,'Microsoft YaHei',monospace; font-size: 13px; }
.resource-identifier { margin-top: 14px; color: #555; font-size: 12px; }
.resource-identifier summary { cursor: pointer; width: fit-content; line-height: 1.7; }
.resource-identifier label { display: block; margin: 12px 0 7px; font-size: 12px; }
.resource-identifier input { margin-top: 7px; }
.resource-form-help { color: #646464; font-size: 12px; line-height: 1.8; margin: 14px 0; }
.resource-points { padding: 0; border: 0; min-width: 0; margin: 0; }
.resource-points legend { font-weight: 600; font-size: 14px; padding: 0; }
.resource-points legend span { display: inline-block; font-weight: 400; font-size: 11px; color: #777; margin-left: 8px; }
.resource-points > p { color: #646464; font-size: 12px; margin: 10px 0 12px; }
.resource-point-list { display: flex; flex-direction: column; gap: 6px; max-height: 330px; overflow: auto; margin-top: 12px; padding: 2px; }
.resource-point-list > label { display: flex; gap: 10px; align-items: flex-start; padding: 9px 10px; border: 1px solid #d9d9d9; border-radius: 8px; background: #ffffff9c; cursor: pointer; }
.resource-point-list > label:hover { background: #eee; }
.resource-point-list input { flex-shrink: 0; margin: 3px 0 0; }
.resource-point-list span { min-width: 0; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.resource-point-list small { display: block; font-size: 10px; color: #777; }
.resource-point-list > p { padding: 18px; font-size: 12px; }
.resource-form-footer { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px; padding-top: 18px; border-top: 1px solid #d9d9d9; }
.resource-batch-note { flex: 1 1 240px; margin: 0; color: #646464; font-size: 12px; line-height: 1.7; }
.resource-link-fields { display: flex; flex-direction: column; gap: 8px; }
.resource-link-fields label { font-size: 13px; font-weight: 500; margin-top: 8px; }
.resource-errors { padding: 12px; border: 1px solid #888; border-radius: 8px; background: #ededed; }
.resource-errors p { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.resource-errors p + p { margin-top: 5px; }
.resource-errors .ui-icon { margin-top: 3px; }
.association-resource-title { display: flex; gap: 9px; align-items: center; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.association-point-list { max-height: 350px; margin-bottom: 20px; }
@media (max-width: 1300px) { .resource-library-page { margin: 8px 8px 12px; padding: 24px 24px 0; } .library-row, .library-table-labels { grid-template-columns: minmax(240px,1.2fr) minmax(160px,1fr) 280px; gap: 16px; } .library-row { padding: 18px 12px; } }
@media (max-width: 850px) { .library-row, .library-table-labels { grid-template-columns: minmax(0,1fr) 280px; } .library-table-labels > :nth-child(2) { display: none; } .library-associations { grid-column: 1; } .library-row-actions { grid-column: 2; grid-row: 1 / 3; } .resource-add-form { grid-template-columns: 1fr; } }
@media (max-width: 650px) { .library-heading { flex-wrap: wrap; gap: 16px; } .library-toolbar { flex-wrap: wrap; } .library-search { width: 100%; } .library-row { grid-template-columns: minmax(0,1fr); } .library-table-labels { display: none; } .library-associations, .library-row-actions { grid-column: auto; grid-row: auto; } .library-row-actions { align-items: flex-start; } .library-main-actions { justify-content: flex-start; } }
</style>
