<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { AiAdoptInput, AiCandidate, AiChoice, AiDraft, AiImportRecord, AiRequest, AiResult } from '../domain/ai'
import type { KnowledgePoint, ResourceItem } from '../domain/types'
import type { Snapshot } from '../composables/useNoterion'
import { useFolderImport } from '../composables/useFolderImport'
import { folderStatusLabels } from '../domain/folder'
import { errorText, invoke } from '../desktop'
import Icon from './Icon.vue'
import MarkdownText from './MarkdownText.vue'
const props = defineProps<{ spaceId: string; epoch: number; points: KnowledgePoint[]; resources: ResourceItem[]; sourceResource: ResourceItem | null; result: AiResult | null; busy: boolean; blocked?: boolean; adopting: boolean; error: string; phase: string; configured: boolean; serviceLabel: string; adopted: AiImportRecord | null; duplicate: boolean; enabled: boolean }>()
const emit = defineEmits<{ start: [request: AiRequest]; cancel: []; adopt: [input: AiAdoptInput]; settings: []; locate: [id: string]; graph: []; showTask: []; clearAdoption: []; fresh: []; snapshot: [snapshot: Snapshot]; dirty: [dirty: boolean] }>()
const source = ref(''); const sourceName = ref('粘贴的学习笔记'); const sourceAtRequest = ref(''); const resourceIds = ref<string[]>([])
const sourceChanged = ref(false)
const draft = ref<AiDraft | null>(null); const choices = ref<AiChoice[]>([]); const selectedIndex = ref(0); const localError = ref(''); const reading = ref(false); const fileInput = ref<HTMLInputElement | null>(null); const operationId = ref(crypto.randomUUID())
const unavailable = computed(() => props.busy || props.blocked)
const folder = useFolderImport(() => ({ spaceId: props.spaceId, epoch: props.epoch }))
const { files: folderFiles, warnings: folderWarnings, scanning: folderScanning, error: folderError, current: folderCurrent, hasBatch, stopped: folderStopped, counts: folderCounts } = folder
const folderMode = ref(false)
const choosingFolder = ref(false)
let disposed = false
let inputGeneration = 0
const captureInput = () => ({ generation: ++inputGeneration, spaceId: props.spaceId, epoch: props.epoch })
const inputCurrent = (value: ReturnType<typeof captureInput>) => !disposed && value.generation === inputGeneration && value.spaceId === props.spaceId && value.epoch === props.epoch
const folderWorking = computed(() => folderScanning.value || ['reading', 'processing', 'review'].includes(folderCurrent.value?.status || ''))
const dirty = computed(() => choosingFolder.value || reading.value || props.busy || props.adopting || (folderMode.value && (folderScanning.value || folderCounts.value.remaining > 0)) || (!!source.value.trim() && (!props.adopted || source.value !== sourceAtRequest.value)))
watch(dirty, value => emit('dirty', value), { immediate: true })
const selected = computed(() => choices.value[selectedIndex.value])
const candidate = computed<AiCandidate | undefined>(() => draft.value?.points[selectedIndex.value])
const target = computed(() => props.points.find(p => p.id === selected.value?.targetId))
const adoptedPoints = computed(() => (props.adopted?.pointIds || []).flatMap(id => props.points.find(p => p.id === id) || []))
const adoptionNotice = ref<HTMLElement | null>(null)
watch(() => props.adopted, async adopted => {
  if (!adopted) return
  if (folderMode.value) folder.saved(props.duplicate)
  await nextTick()
  adoptionNotice.value?.scrollIntoView({ block: 'start' })
})
const themes = computed(() => {
  const all = new Map(props.points.filter(p => p.isTheme).map(p => [p.id, p]))
  choices.value.filter(c => c.point.isTheme && c.action !== 'skip').forEach(c => all.set(c.point.id, c.point))
  return [...all.values()].filter(p => p.id !== selected.value?.point.id)
})
const adoptCount = computed(() => choices.value.filter(c => c.action !== 'skip').length)
const counts = computed(() => ({ create: choices.value.filter(c => c.action === 'create').length, reuse: choices.value.filter(c => c.action === 'reuse').length, update: choices.value.filter(c => c.action === 'update').length }))
const ready = computed(() => {
  if (!draft.value || unavailable.value || sourceChanged.value || source.value !== sourceAtRequest.value) return false
  if (draft.value.duplicateRecordId) return true
  return adoptCount.value > 0 && !draft.value.points.some(c => !c.evidence.length) && !choices.value.some(c => c.action !== 'skip' && (!c.point.name.trim() || (['reuse','update'].includes(c.action) && !c.targetId)))
})
const textReady = computed(() => props.sourceResource && ['text', 'markdown'].includes(props.sourceResource.kind))
watch(() => props.result, value => {
  if (value?.kind !== 'extract') { draft.value = null; choices.value = []; return }
  draft.value = value.draft; choices.value = value.draft.points.map(c => ({ candidateId: c.point.id, point: JSON.parse(JSON.stringify(c.point)), action: 'create' as const })); selectedIndex.value = 0; localError.value = ''; operationId.value = crypto.randomUUID()
  if (folderMode.value) folder.review()
})
watch(() => props.error, value => { if (value && folderMode.value && !props.adopting) folder.failed(value) })
// Restoring earlier text must not reactivate a draft that the user invalidated.
watch(source, value => { if (draft.value && value !== sourceAtRequest.value) sourceChanged.value = true }, { flush: 'sync' })
watch(choices, () => {
  for (const choice of choices.value) {
    if (choice.action === 'create' || choice.action === 'skip') delete choice.targetId
  }
  operationId.value = crypto.randomUUID(); emit('clearAdoption')
}, { deep: true, flush: 'sync' })
watch(() => props.sourceResource, resource => {
  if (!resource) return
  resourceIds.value = [resource.id]; sourceName.value = resource.filename || resource.title; source.value = ''; sourceAtRequest.value = ''; draft.value = null; choices.value = []; localError.value = ''; emit('clearAdoption')
}, { immediate: true })
async function readFile(file?: File) {
  if (!file) return
  const captured = captureInput()
  localError.value = ''; reading.value = true
  try {
    if (!/\.(txt|md|markdown)$/i.test(file.name)) throw new Error('请选择 Markdown 或 TXT 文本。')
    if (file.size > 256 * 1024) throw new Error('文件超过 256 KiB，请拆分后重试。')
    const bytes = await file.arrayBuffer()
    if (!inputCurrent(captured)) return
    source.value = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); sourceName.value = file.name; draft.value = null; choices.value = []; emit('clearAdoption')
  } catch (e) { if (inputCurrent(captured)) localError.value = errorText(e) } finally { if (inputCurrent(captured)) { reading.value = false; if (fileInput.value) fileInput.value.value = '' } }
}
async function readResource() {
  if (!props.sourceResource) return
  const captured = captureInput()
  reading.value = true; localError.value = ''
  try { const text = await invoke<string>('ai_read_text', { resourceId: props.sourceResource.id, spaceId: props.spaceId, epoch: props.epoch }); if (inputCurrent(captured)) { source.value = text; draft.value = null; choices.value = []; emit('clearAdoption') } }
  catch (e) { if (inputCurrent(captured)) localError.value = errorText(e) } finally { if (inputCurrent(captured)) reading.value = false }
}
function submit() {
  if (!source.value.trim() || unavailable.value || reading.value || !props.enabled) return
  if (new TextEncoder().encode(source.value).byteLength > 256 * 1024) { localError.value = '文本超过 256 KiB，请拆分后重试。'; return }
  sourceAtRequest.value = source.value; sourceChanged.value = false; emit('clearAdoption'); draft.value = null; choices.value = []; localError.value = ''
  if (folderMode.value) folder.processing()
  emit('start', { action: 'extract', text: source.value, sourceName: sourceName.value, resourceIds: [...resourceIds.value], allowSupplement: false })
}
function adopt() {
  if (!ready.value || !draft.value) return
  const submittedChoices: AiChoice[] = draft.value.duplicateRecordId ? [] : choices.value.map(choice => {
    const copy: AiChoice = JSON.parse(JSON.stringify(choice))
    if (copy.action === 'create' || copy.action === 'skip') delete copy.targetId
    return copy
  })
  emit('adopt', { draftId: draft.value.id, operationId: operationId.value, choices: submittedChoices })
}
function nameOf(id: string) { return choices.value.find(c=>c.point.id===id)?.point.name || props.points.find(p=>p.id===id)?.name || '已移除的主题' }
function disambiguate(point: KnowledgePoint) { const topics = point.topicIds.map(id=>props.points.find(p=>p.id===id)?.name).filter(Boolean).join(' / '); return point.name + (topics ? '（' + topics + '）' : '') + (point.description ? ' — ' + point.description.replace(/\s+/g,' ').slice(0,60) : '') }
function isSuggested(id: string) { return candidate.value?.matches.includes(id) }
function newInput() { draft.value = null; choices.value = []; source.value = ''; sourceAtRequest.value = ''; emit('clearAdoption'); emit('fresh') }
function clearFile() { draft.value = null; choices.value = []; source.value = ''; sourceAtRequest.value = ''; localError.value = ''; resourceIds.value = []; emit('clearAdoption') }
async function chooseFolder() {
  if (unavailable.value || props.adopting || folderWorking.value) return
  const captured = captureInput()
  choosingFolder.value = true
  try {
    const path = await invoke<string | null>('choose_directory')
    if (!path || !inputCurrent(captured)) return
    choosingFolder.value = false
    clearFile(); folderMode.value = true
    await folder.scan(path)
  } catch (failure) { if (inputCurrent(captured)) localError.value = errorText(failure) }
  finally { if (inputCurrent(captured)) choosingFolder.value = false }
}
async function nextFolderFile(fileId?: string) {
  if (unavailable.value || props.adopting || folderWorking.value || !props.configured || !props.enabled) return
  clearFile()
  const result = await folder.readNext(fileId)
  if (!result) return
  emit('snapshot', result.snapshot)
  source.value = result.text; sourceName.value = result.sourceName; resourceIds.value = [result.sourceResourceId]
  if (!source.value.trim()) { folder.processing(); folder.failed('文件内容为空，请补充内容后重试。'); return }
  submit()
}
function skipFolderFile() { if (props.adopting) return; emit('cancel'); folder.skip(); clearFile() }
function cancelFolder() { inputGeneration++; choosingFolder.value = false; emit('cancel'); folder.cancel(); clearFile() }
function retryFolder() { if (unavailable.value || props.adopting || folderWorking.value) return; folder.retry(); clearFile(); void nextFolderFile() }
function textMode() { if (unavailable.value || props.adopting || folderWorking.value) return; folder.dispose(); folderMode.value = false; clearFile(); sourceName.value = '粘贴的学习笔记' }
onBeforeUnmount(() => { disposed = true; inputGeneration++; folder.dispose() })
</script>
<template>
  <section class="ai-import-workspace glass-panel" aria-label="AI 知识整理">
    <header class="ai-workspace-heading"><h1>整理学习笔记</h1><div class="import-mode-actions"><button class="button" :class="{ 'button-selected': !folderMode }" :disabled="unavailable || adopting || folderWorking || choosingFolder" data-testid="import-text-mode" @click="textMode">文本 / 单文件</button><button class="button" :class="{ 'button-selected': folderMode }" :disabled="!enabled || unavailable || adopting || folderWorking || choosingFolder" data-testid="folder-select" @click="chooseFolder">{{ choosingFolder ? '正在选择…' : '选择文件夹' }}</button></div></header>
    <section v-if="folderMode" class="folder-import" aria-label="文件夹导入" data-testid="folder-import">
      <header class="folder-heading"><h2>文件清单</h2><strong v-if="hasBatch && !folderScanning" data-testid="folder-count">{{folderCounts.total}} 份文件</strong></header>
      <div v-if="folderScanning" class="ai-task-status" role="status"><span class="spinner small" />正在查找文件…<button class="button" data-testid="folder-cancel" @click="cancelFolder">取消</button></div>
      <p v-if="folderError" class="ai-error" role="alert">{{folderError}}</p>
      <template v-if="hasBatch && !folderScanning && !folderError">
        <p v-if="!folderFiles.length" class="folder-empty" role="status" data-testid="folder-empty">{{folderStopped ? '扫描已取消' : '未找到 Markdown 或 TXT 文件。'}}</p>
        <template v-else>
          <div class="folder-progress" role="status" data-testid="folder-progress"><span>{{folderCounts.completed}} / {{folderCounts.total}} 已处理</span><span>已保存 {{folderCounts.saved}}</span><span>重复 {{folderCounts.duplicate}}</span><span>跳过 {{folderCounts.skipped}}</span><span>失败 {{folderCounts.failed}}</span><span>待处理 {{folderCounts.remaining}}</span><span v-if="folderCounts.cancelled">已取消 {{folderCounts.cancelled}}</span></div>
          <progress class="folder-progress-bar" :value="folderCounts.completed" :max="folderCounts.total" aria-label="文件处理进度" />
          <div class="folder-files"><table><thead><tr><th scope="col">相对路径</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody><tr v-for="file in folderFiles" :key="file.id" :class="{ 'folder-current': file.id === folderCurrent?.id }" :data-file-path="file.relativePath"><td><span class="folder-path">{{file.relativePath}}</span><p v-if="file.error" class="folder-file-error">{{file.error}}</p></td><td>{{folderStatusLabels[file.status]}}</td><td><div class="folder-row-actions"><button v-if="['pending','failed','cancelled'].includes(file.status)" class="text-button" :disabled="unavailable || adopting || folderWorking || !configured" @click="nextFolderFile(file.id)">{{file.status === 'pending' ? '处理' : '重试'}}</button><button v-if="['pending','failed','cancelled'].includes(file.status)" class="text-button" :disabled="unavailable || adopting || folderWorking" @click="folder.skip(file.id)">跳过</button></div></td></tr></tbody></table></div>
          <div class="folder-actions"><button v-if="!configured" class="button" @click="emit('settings')">配置模型</button><button v-if="folderWorking && !folderScanning" class="button" :disabled="adopting" data-testid="folder-skip" @click="skipFolderFile">跳过当前文件</button><button v-if="folderCounts.remaining" class="button" :disabled="adopting" data-testid="folder-cancel" @click="cancelFolder">取消批次</button><button v-if="folderCounts.failed || folderCounts.cancelled" class="button" :disabled="unavailable || adopting || folderWorking || !configured" data-testid="folder-retry" @click="retryFolder">重试未完成文件</button><button v-if="folderCounts.pending" class="button button-primary" :disabled="unavailable || adopting || folderWorking || !configured" data-testid="folder-next" @click="nextFolderFile()">{{folderCounts.completed ? '处理下一份' : '开始逐份解析'}}</button><span v-if="folderStopped" role="status">批次已取消</span></div>
        </template>
      </template>
      <ul v-if="folderWarnings.length" class="folder-warnings" aria-label="未扫描的路径"><li v-for="warning in folderWarnings" :key="warning.relativePath">{{warning.relativePath}}：{{warning.error}}</li></ul>
    </section>
    <div v-if="sourceResource && !folderMode" class="ai-context-banner"><Icon name="book" :size="17" /><span>来源资料：{{sourceResource.title}}</span><button v-if="textReady" class="button compact-button" :disabled="reading || unavailable || adopting" @click="readResource">{{reading?'正在读取…':'读取这份文本'}}</button></div>
    <div v-if="!enabled" class="ai-error" role="alert">请先打开数据目录。</div>
    <div v-if="localError || error" class="ai-error" role="alert" data-testid="ai-import-error">{{localError || error}}</div>
    <div v-if="blocked" class="ai-context-banner" role="status">AI 助手正在处理问题。<button class="button compact-button" data-testid="ai-view-task" @click="emit('showTask')">查看任务</button></div>
    <div v-if="busy" class="ai-task-status" role="status"><span class="spinner small" />{{phase}}<button class="button compact-button" data-testid="ai-import-cancel" @click="folderMode ? cancelFolder() : emit('cancel')">取消解析</button></div>
    <p v-else-if="phase==='已取消'" class="ai-help" role="status">已取消，输入已保留。</p>
    <div v-if="adopted" ref="adoptionNotice" class="ai-adopted" role="status" data-testid="ai-adopted">
      <Icon name="check" :size="23" />
      <div class="ai-adopted-content">
        <h2>{{duplicate?'这份输入已经采用':'知识已保存到本机'}}</h2>
        <p v-if="!duplicate">新增 {{adopted.added}} 个、更新 {{adopted.updated}} 个、复用 {{adopted.reused}} 个知识点。</p>
        <p v-else-if="!adoptedPoints.length">相关知识已移除。</p>
        <div v-if="adoptedPoints.length" class="ai-adopted-links"><button v-for="point in adoptedPoints" :key="point.id" class="tag tag-button" @click="emit('locate',point.id)">{{point.name}}</button></div>
        <div class="ai-result-actions"><button class="button" @click="emit('graph')">进入图谱</button><button v-if="folderMode && folderCounts.pending" class="button" :disabled="unavailable || adopting" @click="nextFolderFile()">处理下一份</button><button v-else class="button" :disabled="unavailable || adopting" @click="folderMode ? textMode() : newInput()">继续导入</button></div>
      </div>
    </div>
    <div v-if="!folderMode || source || draft" class="ai-import-input" :class="{'has-draft':draft}">
      <section class="ai-input-section"><div class="ai-section-heading"><h2>{{draft?'本次原文':'学习文本'}}</h2><button v-if="!folderMode" class="button compact-button" :disabled="unavailable || reading || adopting" @click="fileInput?.click()">选择 TXT / Markdown</button><input ref="fileInput" class="sr-only" type="file" accept=".txt,.md,.markdown" aria-label="选择学习文本" @change="readFile(($event.target as HTMLInputElement).files?.[0])" /></div><textarea v-model="source" class="field ai-source-input" :readonly="unavailable || adopting" aria-label="学习文本" data-testid="ai-source" placeholder="粘贴学习笔记，或选择文本文件" /><div class="ai-source-controls"><p v-if="sourceName !== '粘贴的学习笔记'" class="ai-filename">{{sourceName}}</p><button v-if="!configured" class="button" @click="emit('settings')">配置模型</button><button class="button button-primary" :disabled="unavailable || adopting || reading || !source.trim() || !enabled" data-testid="ai-extract" @click="submit">{{draft?'重新整理':'整理知识'}}</button></div><details v-if="resources.length" class="ai-source-picker"><summary>关联来源{{resourceIds.length ? `（已选 ${resourceIds.length}）` : ''}}</summary><label v-for="resource in resources" :key="resource.id"><input v-model="resourceIds" type="checkbox" :value="resource.id" :disabled="unavailable || adopting || !!draft" />{{resource.title}}</label><p v-if="!resources.length" class="ai-help">暂无资料，可不关联来源。</p></details></section>
      <section v-if="draft" class="ai-review-section" aria-label="AI 候选预览"><div class="ai-section-heading"><h2>{{draft.duplicateRecordId?'已保存知识':'核对候选知识'}} <span v-if="!draft.duplicateRecordId">{{choices.length}}</span></h2><span v-if="!draft.duplicateRecordId">{{counts.create}} 新建 · {{counts.reuse}} 复用 · {{counts.update}} 更新</span></div><p v-if="sourceChanged || source !== sourceAtRequest" class="ai-error" role="alert">原文已修改，请重新整理。</p><p v-if="draft.duplicateRecordId" class="ai-context-banner" data-testid="ai-duplicate">这份文本已采用。</p><p v-for="(warning,index) in draft.warnings" :key="index" class="ai-help">{{warning}}</p><div v-if="choices.length" class="ai-candidate-layout"><nav class="ai-candidate-list" aria-label="候选知识点"><button v-for="(choice,index) in choices" :key="choice.candidateId" :class="{selected:index===selectedIndex}" :aria-pressed="index===selectedIndex" @click="selectedIndex=index"><Icon :name="choice.point.isTheme?'layers':'file'" :size="15" /><span>{{choice.point.name || '未命名知识点'}}<small>{{{create:'新建',reuse:'复用已有',update:'更新已有',skip:'跳过'}[choice.action]}}</small></span></button></nav><div v-if="selected" class="ai-candidate-editor"><label class="ai-field-label">名称<input v-model="selected.point.name" class="field" aria-label="候选知识点名称" :disabled="adopting" /></label><label class="ai-check"><input v-model="selected.point.isTheme" type="checkbox" :disabled="adopting" />可作为主题</label><label class="ai-field-label">描述<textarea v-model="selected.point.description" class="field ai-candidate-description" aria-label="候选知识点描述" :disabled="adopting" /></label><details><summary class="ai-help">查看描述效果</summary><MarkdownText :text="selected.point.description" /></details><fieldset class="ai-candidate-topics"><legend>所属主题</legend><label v-for="theme in themes" :key="theme.id" class="ai-check"><input v-model="selected.point.topicIds" type="checkbox" :value="theme.id" :disabled="adopting" />{{theme.name}}</label><p v-if="!selected.point.topicIds.length" class="ai-help">独立知识点</p><label v-for="id in selected.point.topicIds.filter(id=>!themes.some(t=>t.id===id))" :key="id" class="ai-check"><input v-model="selected.point.topicIds" type="checkbox" :value="id" :disabled="adopting" />已移除或已跳过的主题（取消关联）</label></fieldset><fieldset class="ai-candidate-topics"><legend>关联资料</legend><label v-for="resource in resources" :key="resource.id" class="ai-check"><input v-model="selected.point.resourceIds" type="checkbox" :value="resource.id" :disabled="adopting" />{{resource.title}}</label><label v-for="id in selected.point.resourceIds.filter(id=>!resources.some(r=>r.id===id))" :key="id" class="ai-check"><input v-model="selected.point.resourceIds" type="checkbox" :value="id" :disabled="adopting" />资料已移除（取消关联）</label><p v-if="!resources.length" class="ai-help">暂无资料。</p></fieldset><section class="ai-evidence"><h3>原文依据</h3><p v-if="!candidate?.evidence.length" class="ai-help">来源未确认，请重新整理。</p><blockquote v-for="(evidence,index) in candidate?.evidence" :key="index"><span>{{evidence.inferred?'结构推断，需核对':'来自原文'}}</span><p>{{evidence.quote || sourceAtRequest.slice(evidence.start,evidence.end)}}</p></blockquote></section><label class="ai-field-label">采用方式<select v-model="selected.action" class="field" aria-label="候选采用方式" :disabled="adopting"><option value="create">新建独立知识点</option><option value="reuse">复用已有知识点</option><option value="update">明确更新已有知识点</option><option value="skip">跳过这个候选</option></select></label><template v-if="selected.action==='reuse' || selected.action==='update'"><label class="ai-field-label">选择已有知识点<select v-model="selected.targetId" class="field" aria-label="选择已有知识点" :disabled="adopting"><option :value="undefined">请选择要复用或更新的知识点</option><option v-for="point in [...points].sort((a,b)=>Number(isSuggested(b.id))-Number(isSuggested(a.id)))" :key="point.id" :value="point.id">{{isSuggested(point.id)?'建议核对：':''}}{{disambiguate(point)}}</option></select></label><div v-if="target" class="ai-difference"><h3>已有内容</h3><strong>{{target.name}}</strong><p>{{target.description || '暂无描述'}}</p><p>已有主题：{{target.topicIds.map(nameOf).join('、') || '无'}}</p><h3>{{selected.action==='update'?'将更新为':'复用后保留'}}</h3><strong>{{selected.action==='update'?selected.point.name:target.name}}</strong><p>{{selected.action==='update'?selected.point.description:target.description}}</p></div></template></div></div><div v-else-if="!draft.duplicateRecordId" class="ai-help">没有提取到可采用的知识点，请补充学习文本后重试。</div><footer class="ai-adopt-actions"><button class="button button-primary" :disabled="!ready || unavailable || adopting || !!adopted" data-testid="ai-adopt" @click="adopt">{{adopting?(draft.duplicateRecordId?'正在读取…':'正在保存…'):draft.duplicateRecordId?'查看已保存知识':`采用 ${adoptCount} 个候选`}}</button></footer></section>
    </div>
  </section>
</template>
<style scoped>
.import-mode-actions,.folder-heading,.folder-actions,.folder-row-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.folder-import{padding:22px 0 0;min-width:0}.folder-heading h2{font-size:16px;font-weight:600}.folder-heading>span{color:#4c4c4c}.folder-heading strong{margin-left:auto;font-size:14px}.folder-progress{display:flex;flex-wrap:wrap;gap:8px 20px;margin:18px 0 10px;font-variant-numeric:tabular-nums;line-height:1.7}.folder-progress-bar{display:block;width:100%;height:6px;accent-color:#3b3b3b;margin-bottom:14px}.folder-files{max-height:280px;overflow:auto;border:1px solid #ccc;border-radius:8px}.folder-files table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.6}.folder-files th,.folder-files td{text-align:left;padding:10px 14px;vertical-align:top;border-bottom:1px solid #ddd}.folder-files th{font-weight:600;background:#f2f2f2;position:sticky;top:0;z-index:1}.folder-files th:first-child{width:65%}.folder-files th:nth-child(2){min-width:90px;white-space:nowrap}.folder-files td:nth-child(2){white-space:nowrap}.folder-files th:last-child{min-width:130px}.folder-files tr:last-child td{border-bottom:0}.folder-current{background:#e9e9e9}.folder-path{overflow-wrap:anywhere}.folder-file-error{color:#813b2f;margin:7px 0 0;overflow-wrap:anywhere}.folder-row-actions{gap:12px;flex-wrap:nowrap}.folder-row-actions .text-button{font-size:14px;min-height:24px;padding:0;color:#333}.folder-actions{justify-content:flex-end;margin-top:14px}.folder-empty{padding:26px 0;font-size:14px}.folder-warnings{margin:16px 0 0;padding-left:20px;list-style:disc;line-height:1.7;overflow-wrap:anywhere}.folder-warnings li+li{margin-top:6px}
.ai-import-workspace{container-type:inline-size;container-name:import;min-width:0;margin:8px 16px 16px;min-height:0;flex:1;display:flex;flex-direction:column;overflow:auto;padding:26px 30px}.ai-workspace-heading{display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:22px;border-bottom:1px solid #d9d9d9}.ai-workspace-heading h1{font-size:25px;font-weight:600}.ai-import-input{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;min-height:0;padding-top:22px}.ai-import-input.has-draft{grid-template-columns:minmax(300px,.85fr) minmax(420px,1.4fr)}.ai-input-section,.ai-review-section{min-width:0}.ai-section-heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px}.ai-section-heading h2{font-size:16px;font-weight:600}.ai-section-heading span{font-size:13px;color:#646464}.ai-source-input{min-height:220px;height:32vh;resize:vertical;font-family:inherit;font-size:14px;line-height:1.85;background:#fff9;padding:15px}.has-draft .ai-source-input{height:50vh}.ai-source-controls{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin:13px 0}.ai-source-controls p{margin-right:auto;min-width:0;font-size:13px;color:#646464;overflow-wrap:anywhere}.ai-source-picker{font-size:13px;margin-top:18px}.ai-source-picker summary{cursor:pointer}.ai-source-picker label{display:flex;gap:8px;align-items:center;padding:8px 0}.ai-candidate-layout{display:grid;grid-template-columns:minmax(145px,.5fr) minmax(0,1fr);border:1px solid #d4d4d4;border-radius:10px;overflow:hidden;background:#fff7}.ai-candidate-list{padding:8px;border-right:1px solid #d9d9d9;min-width:0}.ai-candidate-list button span{min-width:0}.ai-candidate-list button{display:flex;align-items:flex-start;text-align:left;gap:8px;width:100%;padding:11px 8px;border-radius:7px;font-size:13px;line-height:1.7;overflow-wrap:anywhere}.ai-candidate-list button.selected{background:#e4e4e4;box-shadow:inset 0 0 0 1px #aaa}.ai-candidate-list small{display:block;font-size:13px;color:#646464}.ai-candidate-editor{padding:17px;min-width:0}.ai-field-label{display:block;font-size:13px;font-weight:500;margin:0 0 16px}.ai-field-label>.field{display:block;margin-top:8px}.ai-candidate-description{min-height:170px;line-height:1.8;resize:vertical;font-family:inherit}.ai-check{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:1.7;margin:8px 0 14px}.ai-check input{flex-shrink:0;margin-top:3px}.ai-candidate-topics{border:0;margin:20px 0;padding:0}.ai-candidate-topics legend{font-size:14px;font-weight:600;margin-bottom:6px}.ai-evidence{border-top:1px solid #d9d9d9;padding-top:18px;margin-top:18px;margin-bottom:20px}.ai-evidence h3,.ai-difference h3{font-size:13px;margin-bottom:10px;font-weight:600}.ai-evidence blockquote{margin:8px 0;padding:10px 12px;background:#eee;border-radius:7px;font-size:13px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.ai-evidence blockquote span{display:block;font-size:13px;color:#646464;margin-bottom:5px}.ai-difference{padding:14px;background:#eee;border-radius:8px;font-size:13px;line-height:1.8;overflow-wrap:anywhere;white-space:pre-wrap}.ai-difference h3{margin-top:14px}.ai-difference h3:first-child{margin-top:0}.ai-difference p{margin:7px 0}.ai-adopt-actions{display:flex;align-items:center;justify-content:flex-end;gap:18px;margin-top:18px;padding-top:16px;border-top:1px solid #d4d4d4}.ai-adopted{display:flex;align-items:flex-start;gap:15px;padding:20px;background:#efefef;border:1px solid #b8b8b8;border-radius:10px;margin:20px 0}.ai-adopted-content{min-width:0;flex:1}.ai-result-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.ai-adopted h2{font-size:18px;margin-bottom:7px}.ai-adopted p{font-size:13px;line-height:1.8}.ai-adopted-links{display:flex;flex-wrap:wrap;gap:7px;margin:15px 0}.ai-context-banner{display:flex;align-items:center;flex-wrap:wrap;gap:10px}.ai-context-banner span{flex:1}.ai-context-banner p{flex-basis:100%}.ai-task-status{margin-top:16px}@container import (max-width:1100px){.ai-import-input.has-draft{grid-template-columns:minmax(250px,.75fr) minmax(400px,1.4fr)}.ai-candidate-layout{grid-template-columns:1fr}.ai-candidate-list{display:flex;overflow:auto;border-right:0;border-bottom:1px solid #d9d9d9}.ai-candidate-list button{min-width:140px}}@container import (max-width:760px){.ai-import-input.has-draft{grid-template-columns:1fr}.has-draft .ai-source-input{height:220px;min-height:160px}.ai-workspace-heading{align-items:flex-start}.ai-adopt-actions{flex-wrap:wrap}}
@container import (max-width:520px){.ai-source-controls{flex-wrap:wrap}.ai-candidate-list button{min-width:130px}.ai-adopted{padding:16px}.ai-section-heading{gap:10px}.ai-candidate-editor{padding:14px}}
@media(max-width:950px){.ai-import-workspace{padding:22px}}
@container import (max-width:760px){.ai-workspace-heading{flex-wrap:wrap}.import-mode-actions{width:100%}.folder-heading{gap:8px}.folder-heading strong{margin-left:auto}.folder-files th,.folder-files td{padding:9px 10px}.folder-files th:first-child{width:auto}.folder-files th:nth-child(2){min-width:76px}.folder-files th:last-child{min-width:110px}.folder-actions{justify-content:flex-start}.folder-progress{gap:6px 14px}}
@container import (max-width:520px){.folder-files th,.folder-files td{padding:8px}.folder-files th:nth-child(2){min-width:66px}.folder-files th:last-child{min-width:94px}.folder-row-actions{gap:8px}.import-mode-actions .button{flex:1}.folder-actions .button{flex:1}.folder-heading strong{font-size:14px}}
</style>
