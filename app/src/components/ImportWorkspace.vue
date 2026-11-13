<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { buildImportPlan, csvTemplate, markdownTemplate, parseImport, type ImportDraft, type ImportRow } from '../domain/import'
import type { DemoData, ResourceItem } from '../domain/types'
import type { ImportRecord, ImportSubmission } from '../domain/importHistory'
import { mergePreviewDefaults, type ImportWorkspaceRequest } from '../domain/importSource'

const props = defineProps<{ data: DemoData; request?: ImportWorkspaceRequest | null; result: ImportRecord | null; sourceResource?: ResourceItem | null; returnLabel?: string; checkDuplicate: (source: string, format: 'markdown' | 'csv', defaults: string[]) => boolean }>()
const emit = defineEmits<{ submit: [value: ImportSubmission]; invalid: [value: ImportSubmission]; draftChange: [value: ImportSubmission]; dirtyChange: [dirty: boolean]; cancel: []; records: []; locate: [id: string]; preview: [resource: ResourceItem] }>()
const step = ref<1 | 2 | 3>(1)
const source = ref('')
const format = ref<'markdown' | 'csv'>('markdown')
const filename = ref('粘贴的 Markdown')
const draft = ref<ImportDraft>(parseImport('', 'markdown'))
const defaultIds = ref<string[]>([])
const selectedIndex = ref(0)
const fileInput = ref<HTMLInputElement | null>(null)
const sourcePane = ref<HTMLDivElement | null>(null)
const inputError = ref('')
const reading = ref(false)
const dragging = ref(false)
const showDefaults = ref(false)
const showTopics = ref(false)
const showResources = ref(false)
const lastPreviewSource = ref<string | null>(null)
const lastPreviewFormat = ref<'markdown' | 'csv'>('markdown')
const parsedBaseline = ref('')
let previousDeclaredDefaults: string[] = []
const hasCorrections = computed(() => Boolean(parsedBaseline.value) && parsedBaseline.value !== JSON.stringify(draft.value))
const plan = computed(() => buildImportPlan(draft.value, props.data, defaultIds.value))
const duplicateInput = computed(() => props.checkDuplicate(source.value, format.value, defaultIds.value))
const selected = computed(() => draft.value.rows[selectedIndex.value])
const topicText = ref('')
const resourceText = ref('')
const splitIds = (value: string) => [...new Set(value.split(';').map((id) => id.trim()).filter(Boolean))]
watch(selected, (row) => { topicText.value = row?.topicIds.join('; ') || ''; resourceText.value = row?.resourceIds.join('; ') || '' }, { immediate: true })
watch(() => selected.value?.topicIds.join(';'), (ids) => { if (splitIds(topicText.value).join(';') !== ids) topicText.value = selected.value?.topicIds.join('; ') || '' })
watch(() => selected.value?.resourceIds.join(';'), (ids) => { if (splitIds(resourceText.value).join(';') !== ids) resourceText.value = selected.value?.resourceIds.join('; ') || '' })
const existing = computed(() => props.data.points.find((p) => p.id === selected.value?.id))
const themes = computed(() => {
  const byId = new Map(props.data.points.filter((p) => p.isTheme).map((p) => [p.id, { id: p.id, name: p.name }]))
  draft.value.rows.filter((r) => r.isTheme).forEach((r) => byId.set(r.id, { id: r.id, name: r.name }))
  return [...byId.values()].filter((p) => p.id !== selected.value?.id)
})
const hasConflict = computed(() => existing.value && selected.value && (existing.value.name !== selected.value.name.trim() || existing.value.description !== selected.value.description))
const rowErrors = computed(() => selected.value ? plan.value.issues.filter((i) => i.rowId === selected.value!.id || (!i.rowId && i.line >= selected.value!.line && i.line <= selected.value!.endLine)) : [])
const sourceLines = computed(() => source.value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n'))
const summary = computed(() => duplicateInput.value ? { added: 0, existing: draft.value.rows.length, pending: 0 } : ({ added: draft.value.rows.filter((r) => !props.data.points.some((p) => p.id === r.id)).length, existing: draft.value.rows.filter((r) => props.data.points.some((p) => p.id === r.id)).length, pending: new Set(plan.value.issues.map((i) => i.rowId || 'line:' + i.line)).size }))
const statusText: Record<string, string> = { new: '新增', updated: '补充', existing: '已存在', conflict: '待选择', error: '待修正' }
const submission = (): ImportSubmission => ({ source: source.value, format: format.value, filename: filename.value, draft: JSON.parse(JSON.stringify(draft.value)), defaultResourceIds: [...defaultIds.value], sourceResourceId: props.sourceResource?.id })
watch([draft, defaultIds], () => { if (step.value === 2) emit('draftChange', submission()) }, { deep: true })
watch([source, draft, step, defaultIds], () => emit('dirtyChange', step.value !== 3 && Boolean(source.value.trim() || draft.value.rows.length)), { deep: true, immediate: true })
watch(() => props.request, (value) => {
  if (!value) return
  source.value = value.source; format.value = value.format; filename.value = value.filename
  draft.value = value.draft ? JSON.parse(JSON.stringify(value.draft)) : parseImport(value.source, value.format)
  defaultIds.value = [...new Set([...value.defaultResourceIds, ...(props.sourceResource ? [props.sourceResource.id] : [])])]
  previousDeclaredDefaults = value.draft ? [...draft.value.defaultResourceIds] : []
  selectedIndex.value = 0; inputError.value = value.error || ''
  if (value.preview) {
    if (!value.draft) defaultIds.value = mergePreviewDefaults(defaultIds.value, [], draft.value.defaultResourceIds, props.sourceResource?.id)
    previousDeclaredDefaults = [...draft.value.defaultResourceIds]
    lastPreviewSource.value = source.value; lastPreviewFormat.value = format.value; parsedBaseline.value = JSON.stringify(draft.value)
    step.value = 2
    if (plan.value.issues.length && !duplicateInput.value) emit('invalid', submission())
  } else step.value = 1
}, { immediate: true })
watch(() => props.result, (value) => { if (value) step.value = value.status === 'failed' ? 2 : 3 })
watch(selectedIndex, async () => {
  showTopics.value = false; showResources.value = false
  await nextTick()
  const pane = sourcePane.value
  const line = pane?.querySelector('.is-source-selected')
  if (pane && line) pane.scrollTo({ top: line.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 16, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
})
function preview() {
  if (!source.value.trim()) { inputError.value = '请选择文件或粘贴模板内容。'; return }
  if (lastPreviewSource.value !== source.value || lastPreviewFormat.value !== format.value) {
    draft.value = parseImport(source.value, format.value)
    defaultIds.value = mergePreviewDefaults(defaultIds.value, previousDeclaredDefaults, draft.value.defaultResourceIds, props.sourceResource?.id)
    previousDeclaredDefaults = [...draft.value.defaultResourceIds]
    lastPreviewSource.value = source.value; lastPreviewFormat.value = format.value; parsedBaseline.value = JSON.stringify(draft.value)
  }
  selectedIndex.value = 0; inputError.value = ''; step.value = 2
  if (plan.value.issues.length && !duplicateInput.value) emit('invalid', submission())
}
async function readFile(file?: File) {
  if (!file) return
  if (!/\.(md|markdown|csv)$/i.test(file.name)) { inputError.value = '请选择 .md、.markdown 或 .csv 模板文件。'; return }
  if (file.size > 5 * 1024 * 1024) { inputError.value = '知识导入文件需小于 5 MB。'; return }
  reading.value = true; inputError.value = ''
  try {
    source.value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
    format.value = /\.csv$/i.test(file.name) ? 'csv' : 'markdown'; filename.value = file.name
  } catch { inputError.value = '无法读取文件，请保存为 UTF-8 后重试。' }
  finally { reading.value = false; if (fileInput.value) fileInput.value.value = '' }
}
function drop(event: DragEvent) { dragging.value = false; void readFile(event.dataTransfer?.files[0]) }
async function sample() {
  reading.value = true; inputError.value = ''
  try {
    const response = await fetch('./test-data/00-empty-start.md')
    if (!response.ok) throw new Error()
    source.value = await response.text(); format.value = 'markdown'; filename.value = '00-empty-start.md'
    preview()
  } catch { inputError.value = '示例读取失败，请从测试数据包选择文件。' }
  finally { reading.value = false }
}
function downloadTemplate(kind: 'markdown' | 'csv') {
  const value = kind === 'csv' ? csvTemplate : markdownTemplate
  const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = 'noterion-template.' + (kind === 'csv' ? 'csv' : 'md'); a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function setIds(row: ImportRow, field: 'topicIds' | 'resourceIds', event: Event) {
  row[field] = splitIds((event.target as HTMLInputElement).value)
}
function rowAtLine(line: number) { return draft.value.rows.findIndex((r) => line >= r.line && line <= r.endLine) }
function startAnother() { source.value = ''; draft.value = parseImport('', format.value); step.value = 1; defaultIds.value = props.sourceResource ? [props.sourceResource.id] : []; previousDeclaredDefaults = []; lastPreviewSource.value = null; parsedBaseline.value = ''; inputError.value = ''; showDefaults.value = false }
</script>

<template>
  <section class="import-workspace glass-panel">
    <div class="workspace-heading"><div><span class="eyebrow">KNOWLEDGE IMPORT</span><h1>导入知识</h1></div><ol class="import-stepper" aria-label="导入步骤"><li v-for="(label, index) in ['选择内容', '预览修正', '导入结果']" :key="label" :class="{ active: step === index + 1, complete: step > index + 1 }"><span>{{ step > index + 1 ? '✓' : index + 1 }}</span>{{ label }}</li></ol></div>
    <div v-if="sourceResource" class="import-source-context"><Icon name="book" :size="19" /><div><strong>{{ sourceResource.title }}</strong><p>从这份资料导入 · 自动关联本批知识点</p></div><button class="button" @click="emit('preview', sourceResource)">查看来源资料</button></div>

    <div v-if="step === 1" class="import-input-layout">
      <section class="input-card"><div class="section-heading"><h2>选择导入内容</h2><span class="muted">Markdown / CSV</span></div>
        <div class="dropzone" :class="{ dragging }" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="drop"><Icon name="file" :size="30" /><strong>{{ reading ? '正在读取文件…' : '将知识文件拖到这里' }}</strong><p>使用 UTF-8 编码的 Markdown 或 CSV 模板，最大 5 MB</p><button class="button" :disabled="reading" @click="fileInput?.click()">选择文件</button><input ref="fileInput" class="sr-only" type="file" accept=".md,.markdown,.csv" aria-label="选择知识导入文件" @change="readFile(($event.target as HTMLInputElement).files?.[0])" /></div>
        <div class="source-input-heading"><label for="raw-import">或粘贴模板内容</label><select v-model="format" class="field format-select" aria-label="导入格式" @change="filename = format === 'csv' ? '粘贴的 CSV' : '粘贴的 Markdown'"><option value="markdown">Markdown</option><option value="csv">CSV</option></select></div>
        <textarea id="raw-import" v-model="source" class="field source-input" spellcheck="false" placeholder="import_id: my-knowledge-v1&#10;default_resource_ids:&#10;&#10;## 我的知识点 {#my-point}&#10;is_theme: false&#10;topic_ids:&#10;resource_ids:&#10;&#10;在这里记录描述、命令与个人理解。" />
        <p v-if="hasCorrections" class="source-edit-note">原文未改时会保留右侧修正；修改原文或格式后重新预览，将按新原文重新整理条目。</p>
        <p v-if="sourceResource && !source" class="source-edit-note">当前资料已作为来源。请选择整理好的知识模板文件，或粘贴知识内容；普通文档不会自动拆分为知识点。</p>
        <p v-if="inputError" class="inline-error" role="alert"><Icon name="alert" :size="15" />{{ inputError }}</p>
      </section>
      <aside class="import-guide"><Icon name="layers" :size="26" /><h2>从整理好的知识开始</h2><p>每条知识使用独立 ID，可以引用多个主题和多份资料。描述保留为完整的 Markdown 原文。</p><div class="guide-downloads"><button class="button" @click="downloadTemplate('markdown')"><Icon name="file" />Markdown 模板<Icon name="arrow" :size="14" class="download-arrow" /></button><button class="button" @click="downloadTemplate('csv')"><Icon name="file" />CSV 模板<Icon name="arrow" :size="14" class="download-arrow" /></button></div><div class="guide-divider" /><h3>先体验一次完整导入</h3><p>示例可从空白图谱直接导入，包含 2 个主题和 3 个知识点。</p><button class="button" :disabled="reading" @click="sample">载入示例<Icon name="arrow" :size="14" class="forward-arrow" /></button><a class="guide-link" href="./test-data/README.md" target="_blank" rel="noopener">测试数据与使用说明 ↗</a><a class="guide-link" href="./test-data/noterion-test-data.zip" download>下载完整测试数据包 ↓</a><div class="guide-note"><Icon name="file" :size="18" /><p>PDF、Word、图片等学习文档请从「资料库」添加，再关联知识点。</p></div></aside>
    </div>

    <template v-else-if="step === 2">
      <div class="import-summary"><div class="source-file"><Icon name="file" :size="21" /><div><strong :title="filename">{{ filename }}</strong><small>{{ draft.importId || '批次 ID 待修正' }}</small></div><button class="text-button" @click="step = 1">更换 / 修改原文</button></div><div class="default-source-picker"><button class="default-source-button" :aria-expanded="showDefaults" @click="showDefaults = !showDefaults"><Icon name="book" :size="16" /><span>默认来源</span><strong>{{ defaultIds.length ? defaultIds.map((id) => data.resources.find((r) => r.id === id)?.title || id).join('、') : '未选择' }}</strong><Icon name="chevron" :size="13" /></button><div v-if="showDefaults" class="picker-dropdown"><h3>应用于本批所有知识点</h3><p v-if="!data.resources.length" class="muted">暂无资料，可先不关联来源完成导入。</p><label v-for="resource in data.resources" :key="resource.id"><input v-model="defaultIds" type="checkbox" :value="resource.id" :disabled="resource.id === sourceResource?.id" /><span>{{ resource.title }}<small>{{ resource.id === sourceResource?.id ? '本次来源 · 自动关联' : resource.id }}</small></span></label><label v-for="id in defaultIds.filter((id) => !data.resources.some((r) => r.id === id))" :key="id"><input v-model="defaultIds" type="checkbox" :value="id" /><span>无效来源：{{ id }}（取消选择以修正）</span></label><button class="button compact-button" @click="showDefaults = false">完成</button></div></div><div class="summary-counts"><strong>{{ draft.rows.length }}<small>知识点</small></strong><strong>{{ summary.added }}<small>新增</small></strong><strong>{{ summary.existing }}<small>已有</small></strong><strong :class="{ 'pending-count': summary.pending }">{{ summary.pending }}<small>待处理</small></strong></div></div>
      <div class="compare-layout">
        <section class="source-panel inner-panel"><div class="section-heading"><h2>原文</h2><span>{{ format === 'csv' ? 'CSV' : 'Markdown' }} · {{ sourceLines.length }} 行</span></div><div ref="sourcePane" class="source-code" tabindex="0" aria-label="输入原文"><div v-for="(line, index) in sourceLines" :key="index" class="source-line" :class="{ 'is-source-selected': selected && index + 1 >= selected.line && index + 1 <= selected.endLine }" @click="rowAtLine(index + 1) >= 0 && (selectedIndex = rowAtLine(index + 1))"><span class="line-number">{{ index + 1 }}</span><code>{{ line || ' ' }}</code></div></div></section>
        <section class="result-panel inner-panel"><div class="section-heading"><h2>整理结果</h2><span>选择条目，检查并修正</span></div><div class="result-body">
          <div v-if="duplicateInput" class="import-alert"><Icon name="copy" :size="16" /><div><strong>这个批次和输入已处理</strong><p>确认后记录为重复输入；不会覆盖后续编辑或恢复已删除的知识点。</p></div></div><div v-else-if="plan.issues.length" class="import-alert" role="status"><Icon name="alert" :size="16" /><div><strong>还有 {{ plan.issues.length }} 项需要处理</strong><p v-for="(issue, index) in plan.issues" :key="index"><button @click="issue.rowId && (selectedIndex = Math.max(0, draft.rows.findIndex((r) => r.id === issue.rowId)))">第 {{ issue.line }} 行 · {{ issue.message }}</button></p></div></div>
          <div v-if="draft.rows.length" class="structure-overview"><div class="outline-list" aria-label="知识条目"><button v-for="(row, index) in draft.rows" :key="index" :class="{ selected: selectedIndex === index }" @click="selectedIndex = index"><Icon :name="row.isTheme ? 'layers' : 'file'" :size="14" /><span>{{ row.name || '未命名知识点' }}</span><small>{{ duplicateInput ? '已处理' : statusText[plan.rows[index]?.status || 'new'] }}</small></button></div><div class="point-preview"><span class="eyebrow">所属主题预览</span><strong>{{ selected?.name || '未命名知识点' }}</strong><div class="topic-preview-tags"><span v-for="id in [...new Set([...(existing?.topicIds || []), ...(selected?.topicIds || [])])]" :key="id" class="tag">{{ themes.find((t) => t.id === id)?.name || id }}</span><span v-if="!existing?.topicIds.length && !selected?.topicIds.length" class="muted">独立知识点</span></div><small>{{ selected?.isTheme ? '主题知识点' : '知识点' }} · {{ selected?.id }}</small></div></div>
          <div v-if="selected" class="inline-point-editor"><div class="section-heading"><h3>修正所选知识点</h3><span>原文第 {{ selected.line }}–{{ selected.endLine }} 行</span></div>
            <div class="editor-two-fields"><label>名称<input v-model="selected.name" class="field" aria-label="导入知识点名称" /></label><label>ID<input v-model="selected.id" class="field mono" aria-label="导入知识点 ID" /></label></div><label class="inline-check"><input v-model="selected.isTheme" type="checkbox" />可作为主题</label>
            <label class="import-description-label">描述 <small>Markdown 原文</small><textarea v-model="selected.description" class="field import-description" spellcheck="false" aria-label="导入知识点描述" /></label>
            <div v-if="hasConflict" class="conflict-box"><strong><Icon name="alert" :size="14" />与已有名称或描述不同</strong><p class="existing-content"><b>已有：{{ existing?.name }}</b>{{ existing?.description }}</p><label><input v-model="selected.resolution" type="radio" value="keep" :name="'resolve-' + selectedIndex" />保留已有名称和描述</label><label><input v-model="selected.resolution" type="radio" value="adopt" :name="'resolve-' + selectedIndex" />采用本次导入的名称和描述</label><small>所属主题与资料关联会合并保留。</small></div>
            <div class="association-editor"><div><label>所属主题 ID<input class="field mono" v-model="topicText" placeholder="可空；多个 ID 用 ; 分隔" aria-label="所属主题 ID" @input="setIds(selected, 'topicIds', $event)" /></label><button class="text-button" :aria-expanded="showTopics" @click="showTopics = !showTopics">{{ showTopics ? '收起主题' : '从主题中选择' }}</button><div v-if="showTopics" class="inline-options"><label v-for="theme in themes" :key="theme.id"><input v-model="selected.topicIds" type="checkbox" :value="theme.id" /><span>{{ theme.name }}<small>{{ theme.id }}</small></span></label></div></div><div><label>资料 ID<input class="field mono" v-model="resourceText" placeholder="可空；多个 ID 用 ; 分隔" aria-label="资料 ID" @input="setIds(selected, 'resourceIds', $event)" /></label><button class="text-button" :aria-expanded="showResources" @click="showResources = !showResources">{{ showResources ? '收起资料' : '从资料库选择' }}</button><div v-if="showResources" class="inline-options"><label v-for="resource in data.resources" :key="resource.id"><input v-model="selected.resourceIds" type="checkbox" :value="resource.id" /><span>{{ resource.title }}<small>{{ resource.id }}</small></span></label></div></div></div>
            <p v-for="issue in rowErrors" :key="issue.message" class="inline-error"><Icon name="alert" :size="14" />{{ issue.message }}</p>
          </div><div v-else class="empty-workspace"><Icon name="file" :size="30" /><h3>尚未找到知识条目</h3><p>返回上一步，按模板修正原文后重新预览。</p><button class="button" @click="step = 1">修改原文</button></div>
        </div></section>
      </div>
    </template>

    <div v-else class="import-complete"><span class="complete-icon"><Icon name="circleCheck" :size="40" /></span><span class="eyebrow">{{ result?.status === 'duplicate' ? 'ALREADY PROCESSED' : 'IMPORT COMPLETE' }}</span><h2>{{ result?.status === 'duplicate' ? '这个输入已处理' : '知识已导入' }}</h2><p>{{ result?.status === 'duplicate' ? '未重复写入，也不会覆盖后续编辑或恢复已删除的知识点。' : '内容已保存在当前页面，可以回到图谱检索和查看。' }}</p><div class="result-stat-cards"><div><strong>{{ result?.counts.added || 0 }}</strong><span>新增知识点</span></div><div><strong>{{ result?.counts.updated || 0 }}</strong><span>补充知识点</span></div><div><strong>{{ result?.counts.topicLinks || 0 }}</strong><span>新增主题关系</span></div><div><strong>{{ result?.counts.resourceLinks || 0 }}</strong><span>新增资料关联</span></div></div><div class="result-contributions"><button v-for="id in result?.pointIds || []" :key="id" @click="emit('locate', id)"><Icon name="file" :size="15" />{{ data.points.find((p) => p.id === id)?.name || id }}<Icon name="external" :size="12" /></button></div><div class="complete-actions"><button class="button" @click="startAnother">继续导入</button><button class="button" @click="emit('records')">查看导入记录</button><button class="button button-primary" @click="emit('cancel')">{{ returnLabel || '返回图谱' }}</button></div></div>

    <footer v-if="step !== 3" class="workspace-footer"><button class="button" @click="emit('cancel')">{{ returnLabel || '返回图谱' }}</button><button v-if="step === 2" class="button" @click="step = 1">上一步</button><button v-if="step === 1" class="button button-primary" :disabled="reading || !source.trim()" @click="preview">预览并修正<Icon name="arrow" :size="15" class="forward-arrow" /></button><button v-else class="button button-primary" :disabled="!duplicateInput && (!plan.data || plan.issues.length > 0)" @click="emit('submit', submission())">{{ duplicateInput ? '跳过重复并查看结果' : plan.issues.length ? '处理 ' + plan.issues.length + ' 项后导入' : '确认导入 ' + draft.rows.length + ' 条知识' }}</button></footer>
  </section>
</template>




