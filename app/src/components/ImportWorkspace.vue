<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AiAdoptInput, AiCandidate, AiChoice, AiDraft, AiImportRecord, AiRequest, AiResult } from '../domain/ai'
import type { KnowledgePoint, ResourceItem } from '../domain/types'
import { errorText, invoke } from '../desktop'
import Icon from './Icon.vue'
import MarkdownText from './MarkdownText.vue'
const props = defineProps<{ points: KnowledgePoint[]; resources: ResourceItem[]; sourceResource: ResourceItem | null; originalRecord: AiImportRecord | null; result: AiResult | null; busy: boolean; adopting: boolean; error: string; phase: string; detail: string; configured: boolean; adopted: AiImportRecord | null; duplicate: boolean; enabled: boolean }>()
const emit = defineEmits<{ start: [request: AiRequest]; cancel: []; adopt: [input: AiAdoptInput]; settings: []; locate: [id: string]; records: []; clearAdoption: []; fresh: [] }>()
const source = ref(''); const sourceName = ref('粘贴的学习笔记'); const sourceAtRequest = ref(''); const resourceIds = ref<string[]>([])
const draft = ref<AiDraft | null>(null); const choices = ref<AiChoice[]>([]); const selectedIndex = ref(0); const localError = ref(''); const reading = ref(false); const fileInput = ref<HTMLInputElement | null>(null); const operationId = ref(crypto.randomUUID())
const selected = computed(() => choices.value[selectedIndex.value])
const candidate = computed<AiCandidate | undefined>(() => draft.value?.points[selectedIndex.value])
const target = computed(() => props.points.find(p => p.id === selected.value?.targetId))
const themes = computed(() => {
  const all = new Map(props.points.filter(p => p.isTheme).map(p => [p.id, p]))
  choices.value.filter(c => c.point.isTheme && c.action !== 'skip').forEach(c => all.set(c.point.id, c.point))
  return [...all.values()].filter(p => p.id !== selected.value?.point.id)
})
const adoptCount = computed(() => choices.value.filter(c => c.action !== 'skip').length)
const counts = computed(() => ({ create: choices.value.filter(c => c.action === 'create').length, reuse: choices.value.filter(c => c.action === 'reuse').length, update: choices.value.filter(c => c.action === 'update').length }))
const ready = computed(() => {
  if (!draft.value || props.busy || source.value !== sourceAtRequest.value) return false
  if (draft.value.duplicateRecordId) return true
  return adoptCount.value > 0 && !choices.value.some(c => c.action !== 'skip' && (!c.point.name.trim() || (['reuse','update'].includes(c.action) && !c.targetId)))
})
const textReady = computed(() => props.sourceResource && ['text', 'markdown'].includes(props.sourceResource.kind))
watch(() => props.result, value => {
  if (value?.kind !== 'extract') return
  draft.value = value.draft; choices.value = value.draft.points.map(c => ({ candidateId: c.point.id, point: JSON.parse(JSON.stringify(c.point)), action: 'create' as const })); selectedIndex.value = 0; localError.value = ''; operationId.value = crypto.randomUUID()
})
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
watch(() => props.originalRecord, (record, previous) => {
  if (!record && !previous) return
  resourceIds.value = record ? record.sourceResourceIds.filter(id => props.resources.some(r => r.id === id)) : []
  sourceName.value = record?.sourceName || '粘贴的学习笔记'
  draft.value = null; choices.value = []; source.value = ''; sourceAtRequest.value = ''; localError.value = ''
})
async function readFile(file?: File) {
  if (!file) return
  localError.value = ''; reading.value = true
  try {
    if (!/\.(txt|md|markdown)$/i.test(file.name)) throw new Error('请选择 Markdown 或 TXT 纯文本。PDF、图片和视频可作为关联资料，暂不转换正文。')
    if (file.size > 256 * 1024) throw new Error('这份文本超过单次 256 KB 的范围，请拆为较小文本后整理。长文本会在本次范围内自动分段。')
    source.value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).replace(/^\uFEFF/, ''); sourceName.value = file.name; draft.value = null; choices.value = []; emit('clearAdoption')
  } catch (e) { localError.value = errorText(e) } finally { reading.value = false; if (fileInput.value) fileInput.value.value = '' }
}
async function readResource() {
  if (!props.sourceResource) return
  reading.value = true; localError.value = ''
  try { source.value = await invoke<string>('ai_read_text', { resourceId: props.sourceResource.id }); draft.value = null; choices.value = []; emit('clearAdoption') }
  catch (e) { localError.value = errorText(e) } finally { reading.value = false }
}
function submit() {
  if (!source.value.trim() || props.busy || reading.value || !props.enabled) return
  if (new TextEncoder().encode(source.value).byteLength > 256 * 1024) { localError.value = '这份文本超过单次 256 KB 的范围，请拆为较小文本后整理。'; return }
  sourceAtRequest.value = source.value; emit('clearAdoption'); draft.value = null; choices.value = []; localError.value = ''
  emit('start', { action: 'extract', text: source.value, sourceName: sourceName.value, resourceIds: [...resourceIds.value], originalRecordId: props.originalRecord?.id, allowSupplement: false })
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
</script>
<template>
  <section class="ai-import-workspace glass-panel" aria-label="AI 知识整理">
    <header class="ai-workspace-heading"><div><h1>从学习笔记整理知识</h1><p>普通文字即可。先核对原文和知识点，再保存到本机图谱。</p></div><button class="button" @click="emit('records')"><Icon name="clock" :size="16" />导入记录</button></header>
    <p v-if="originalRecord" class="ai-context-banner">正在更新“{{originalRecord.sourceName}}”的原记录。请重新提供修改后的文本；省略内容不会删除已有知识。</p>
    <div v-if="sourceResource" class="ai-context-banner"><Icon name="book" :size="17" /><span>来源资料：{{sourceResource.title}}</span><button v-if="textReady" class="button compact-button" :disabled="reading || busy || adopting" @click="readResource">{{reading?'正在读取…':'读取这份文本'}}</button><p v-else>这份资料仅作为关联来源。请粘贴或选择已取得的纯文本，当前不提供 PDF、图片或视频转文字。</p></div>
    <div v-if="!enabled" class="ai-error" role="alert">请先打开本机数据目录，才能整理并采用知识。</div>
    <div v-if="localError || error" class="ai-error" role="alert" data-testid="ai-import-error">{{localError || error}}</div>
    <div v-if="busy" class="ai-task-status" role="status"><span class="spinner small" />{{phase}}<span>{{detail}}</span><button class="button compact-button" data-testid="ai-import-cancel" @click="emit('cancel')">取消解析</button></div>
    <p v-else-if="phase==='已取消'" class="ai-help" role="status">解析已取消，输入已保留。你可以修改后重试。</p>
    <div v-if="adopted" class="ai-adopted" role="status" data-testid="ai-adopted"><Icon name="check" :size="23" /><div><h2>{{duplicate?'这份输入已经采用':'知识已保存到本机'}}</h2><p>{{duplicate?'本次没有重复写入，也不会恢复已删除的知识。':`新增 ${adopted.added} 个、更新 ${adopted.updated} 个、复用 ${adopted.reused} 个知识点。`}}</p><div class="ai-adopted-links"><button v-for="id in adopted.pointIds.filter(id=>points.some(p=>p.id===id))" :key="id" class="tag tag-button" @click="emit('locate',id)">{{points.find(p=>p.id===id)?.name}}</button></div><button class="button" @click="emit('records')">查看导入记录</button><button class="text-button" @click="newInput">整理新的文本</button></div></div>
    <div class="ai-import-input" :class="{'has-draft':draft}">
      <section class="ai-input-section"><div class="ai-section-heading"><h2>{{draft?'本次原文':'学习文本'}}</h2><button class="button compact-button" :disabled="busy || reading || adopting" @click="fileInput?.click()">选择 TXT / Markdown</button><input ref="fileInput" class="sr-only" type="file" accept=".txt,.md,.markdown" aria-label="选择学习文本" @change="readFile(($event.target as HTMLInputElement).files?.[0])" /></div><textarea v-model="source" class="field ai-source-input" :disabled="busy || adopting" aria-label="学习文本" data-testid="ai-source" placeholder="粘贴你的学习笔记，不需要标题模板或固定字段。" /><div class="ai-source-controls"><p>{{sourceName}} · {{source.length.toLocaleString()}} 字符</p><button v-if="!configured" class="button" @click="emit('settings')">配置 DeepSeek</button><button class="button button-primary" :disabled="busy || adopting || reading || !source.trim() || !enabled" data-testid="ai-extract" @click="submit">{{draft?'重新解析原文':'AI 整理知识'}}</button></div><p class="ai-help">本次发送：上方全文、选中资料的信息及必要的已有知识候选。按独立可复用知识整理，步骤放入描述；额外主题建议会标识为结构推断。</p><details class="ai-source-picker"><summary>本批关联来源（{{resourceIds.length}}）</summary><label v-for="resource in resources" :key="resource.id"><input v-model="resourceIds" type="checkbox" :value="resource.id" :disabled="busy || adopting || !!draft" />{{resource.title}}</label><p v-if="!resources.length" class="ai-help">暂无资料，可不关联来源。</p></details></section>
      <section v-if="draft" class="ai-review-section" aria-label="AI 候选预览"><div class="ai-section-heading"><h2>{{draft.duplicateRecordId?'已有采用记录':'核对候选知识'}} <span v-if="!draft.duplicateRecordId">{{choices.length}}</span></h2><span v-if="!draft.duplicateRecordId">{{counts.create}} 新建 · {{counts.reuse}} 复用 · {{counts.update}} 更新</span></div><p v-if="source !== sourceAtRequest" class="ai-error" role="alert">原文已修改，请重新解析后再采用，避免保存与当前文本不一致的候选。</p><p v-if="draft.duplicateRecordId" class="ai-context-banner" data-testid="ai-duplicate">这份输入已经处理过。本机已有采用记录，本次未请求模型；查看结果时会核对已有记录，不重复写入。</p><p v-for="(warning,index) in draft.warnings" :key="index" class="ai-help">{{warning}}</p><div v-if="choices.length" class="ai-candidate-layout"><nav class="ai-candidate-list" aria-label="候选知识点"><button v-for="(choice,index) in choices" :key="choice.candidateId" :class="{selected:index===selectedIndex}" :aria-pressed="index===selectedIndex" @click="selectedIndex=index"><Icon :name="choice.point.isTheme?'layers':'file'" :size="15" /><span>{{choice.point.name || '未命名知识点'}}<small>{{{create:'新建',reuse:'复用已有',update:'更新已有',skip:'跳过'}[choice.action]}}</small></span></button></nav><div v-if="selected" class="ai-candidate-editor"><label class="ai-field-label">名称<input v-model="selected.point.name" class="field" aria-label="候选知识点名称" :disabled="adopting" /></label><label class="ai-check"><input v-model="selected.point.isTheme" type="checkbox" :disabled="adopting" />可作为主题</label><label class="ai-field-label">描述<textarea v-model="selected.point.description" class="field ai-candidate-description" aria-label="候选知识点描述" :disabled="adopting" /></label><details><summary class="ai-help">查看描述效果</summary><MarkdownText :text="selected.point.description" /></details><fieldset class="ai-candidate-topics"><legend>所属主题</legend><label v-for="theme in themes" :key="theme.id" class="ai-check"><input v-model="selected.point.topicIds" type="checkbox" :value="theme.id" :disabled="adopting" />{{theme.name}}</label><p v-if="!selected.point.topicIds.length" class="ai-help">独立知识点</p><label v-for="id in selected.point.topicIds.filter(id=>!themes.some(t=>t.id===id))" :key="id" class="ai-check"><input v-model="selected.point.topicIds" type="checkbox" :value="id" :disabled="adopting" />已移除或已跳过的主题（取消关联）</label></fieldset><fieldset class="ai-candidate-topics"><legend>关联资料</legend><p class="ai-help">采用时在本机关联，不会因此发送资料正文。</p><label v-for="resource in resources" :key="resource.id" class="ai-check"><input v-model="selected.point.resourceIds" type="checkbox" :value="resource.id" :disabled="adopting" />{{resource.title}}</label><label v-for="id in selected.point.resourceIds.filter(id=>!resources.some(r=>r.id===id))" :key="id" class="ai-check"><input v-model="selected.point.resourceIds" type="checkbox" :value="id" :disabled="adopting" />资料已移除（取消关联）</label><p v-if="!resources.length" class="ai-help">暂无资料。</p></fieldset><section class="ai-evidence"><h3>原文依据</h3><p v-if="!candidate?.evidence.length" class="ai-help">未提供可核对的原文片段，请检查后决定是否采用。</p><blockquote v-for="(evidence,index) in candidate?.evidence" :key="index"><span>{{evidence.inferred?'结构推断，需核对':'来自原文'}}</span><p>{{evidence.quote || sourceAtRequest.slice(evidence.start,evidence.end)}}</p></blockquote></section><label class="ai-field-label">采用方式<select v-model="selected.action" class="field" aria-label="候选采用方式" :disabled="adopting"><option value="create">新建独立知识点</option><option value="reuse">复用已有知识点，保留名称与描述</option><option value="update">明确更新已有知识点</option><option value="skip">跳过这个候选</option></select></label><template v-if="selected.action==='reuse' || selected.action==='update'"><label class="ai-field-label">选择已有知识点<select v-model="selected.targetId" class="field" aria-label="选择已有知识点" :disabled="adopting"><option :value="undefined">请选择要复用或更新的知识点</option><option v-for="point in [...points].sort((a,b)=>Number(isSuggested(b.id))-Number(isSuggested(a.id)))" :key="point.id" :value="point.id">{{isSuggested(point.id)?'建议核对：':''}}{{disambiguate(point)}}</option></select></label><div v-if="target" class="ai-difference"><h3>已有内容</h3><strong>{{target.name}}</strong><p>{{target.description || '暂无描述'}}</p><p>已有主题：{{target.topicIds.map(nameOf).join('、') || '无'}}</p><h3>{{selected.action==='update'?'将更新为':'复用后保留'}}</h3><strong>{{selected.action==='update'?selected.point.name:target.name}}</strong><p>{{selected.action==='update'?selected.point.description:target.description}}</p><small>所属主题与资料只会补充，不因缺项移除。修改共享知识点会同时影响所有所属主题中的同一节点。</small></div></template><p v-else-if="candidate?.matches.length && selected.action==='create'" class="ai-help">已有可能相关的知识点。本次新建会保留独立身份，不会按名称自动合并。</p></div></div><div v-else-if="draft.duplicateRecordId" class="ai-help">可查看之前保存的成果与导入记录。已删除的知识不会恢复。</div><div v-else class="ai-help">没有提取到可采用的知识点，请补充学习文本后重试。</div><footer class="ai-adopt-actions"><p>{{draft.duplicateRecordId?'核对已有采用记录，知识与资料保持当前状态。':'核对后整批保存；任一引用或关系校验失败，整批不写入。'}}</p><button class="button button-primary" :disabled="!ready || busy || adopting || !!adopted" data-testid="ai-adopt" @click="adopt">{{adopting?(draft.duplicateRecordId?'正在核对本机记录…':'正在保存到本机…'):draft.duplicateRecordId?'查看已有采用结果':`采用 ${adoptCount} 个候选`}}</button></footer></section>
    </div>
  </section>
</template>
<style scoped>
.ai-import-workspace{margin:8px 16px 16px;min-height:0;flex:1;display:flex;flex-direction:column;overflow:auto;padding:26px 30px}.ai-workspace-heading{display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:22px;border-bottom:1px solid #d9d9d9}.ai-workspace-heading h1{font-size:25px;font-weight:600}.ai-workspace-heading p{font-size:13px;line-height:1.8;color:#646464;margin-top:9px}.ai-import-input{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;min-height:0;padding-top:22px}.ai-import-input.has-draft{grid-template-columns:minmax(300px,.85fr) minmax(420px,1.4fr)}.ai-input-section,.ai-review-section{min-width:0}.ai-section-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px}.ai-section-heading h2{font-size:16px;font-weight:600}.ai-section-heading span{font-size:12px;color:#646464}.ai-source-input{min-height:280px;height:36vh;resize:vertical;font:13px/1.85 Consolas,'Microsoft YaHei',monospace;background:#fff9;padding:15px}.has-draft .ai-source-input{height:50vh}.ai-source-controls{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin:13px 0}.ai-source-controls p{flex:1;font-size:12px;color:#646464;overflow-wrap:anywhere}.ai-source-picker{font-size:13px;margin-top:18px}.ai-source-picker summary{cursor:pointer}.ai-source-picker label{display:flex;gap:8px;align-items:center;padding:8px 0}.ai-candidate-layout{display:grid;grid-template-columns:minmax(145px,.5fr) minmax(0,1fr);border:1px solid #d4d4d4;border-radius:10px;overflow:hidden;background:#fff7}.ai-candidate-list{padding:8px;border-right:1px solid #d9d9d9;min-width:0}.ai-candidate-list button{display:flex;align-items:flex-start;text-align:left;gap:8px;width:100%;padding:11px 8px;border-radius:7px;font-size:13px;line-height:1.7;overflow-wrap:anywhere}.ai-candidate-list button.selected{background:#e4e4e4;box-shadow:inset 0 0 0 1px #aaa}.ai-candidate-list small{display:block;font-size:11px;color:#646464}.ai-candidate-editor{padding:17px;min-width:0}.ai-field-label{display:block;font-size:13px;font-weight:500;margin:0 0 16px}.ai-field-label>.field{display:block;margin-top:8px}.ai-candidate-description{min-height:170px;line-height:1.8;resize:vertical;font-family:Consolas,'Microsoft YaHei',monospace}.ai-check{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:1.7;margin:8px 0 14px}.ai-check input{flex-shrink:0;margin-top:3px}.ai-candidate-topics{border:0;margin:20px 0;padding:0}.ai-candidate-topics legend{font-size:14px;font-weight:600;margin-bottom:6px}.ai-evidence{border-top:1px solid #d9d9d9;padding-top:18px;margin-top:18px;margin-bottom:20px}.ai-evidence h3,.ai-difference h3{font-size:13px;margin-bottom:10px;font-weight:600}.ai-evidence blockquote{margin:8px 0;padding:10px 12px;background:#eee;border-radius:7px;font-size:13px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.ai-evidence blockquote span{display:block;font-size:11px;color:#646464;margin-bottom:5px}.ai-difference{padding:14px;background:#eee;border-radius:8px;font-size:13px;line-height:1.8;overflow-wrap:anywhere;white-space:pre-wrap}.ai-difference h3{margin-top:14px}.ai-difference h3:first-child{margin-top:0}.ai-difference p{margin:7px 0}.ai-difference small{display:block;color:#646464;margin-top:14px;font-size:12px}.ai-adopt-actions{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:18px;padding-top:16px;border-top:1px solid #d4d4d4}.ai-adopt-actions p{font-size:12px;line-height:1.8;color:#646464}.ai-adopted{display:flex;align-items:flex-start;gap:15px;padding:20px;background:#efefef;border:1px solid #b8b8b8;border-radius:10px;margin:20px 0}.ai-adopted h2{font-size:18px;margin-bottom:7px}.ai-adopted p{font-size:13px;line-height:1.8}.ai-adopted-links{display:flex;flex-wrap:wrap;gap:7px;margin:15px 0}.ai-adopted .text-button{margin-left:15px}.ai-context-banner{display:flex;align-items:center;flex-wrap:wrap;gap:10px}.ai-context-banner span{flex:1}.ai-context-banner p{flex-basis:100%}.ai-task-status{margin-top:16px}@media(max-width:1250px){.ai-import-input.has-draft{grid-template-columns:minmax(250px,.75fr) minmax(400px,1.4fr)}.ai-candidate-layout{grid-template-columns:1fr}.ai-candidate-list{display:flex;overflow:auto;border-right:0;border-bottom:1px solid #d9d9d9}.ai-candidate-list button{min-width:140px}}@media(max-width:950px){.ai-import-input.has-draft{grid-template-columns:1fr}.has-draft .ai-source-input{height:220px;min-height:160px}.ai-import-workspace{padding:22px}.ai-workspace-heading{align-items:flex-start}.ai-adopt-actions{flex-wrap:wrap}}
</style>
