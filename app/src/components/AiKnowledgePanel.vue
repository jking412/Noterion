<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AiRequest, AiResult, AiSource } from '../domain/ai'
import type { KnowledgePoint, ResourceItem } from '../domain/types'
import MarkdownText from './MarkdownText.vue'
import Icon from './Icon.vue'
const props = defineProps<{ points: KnowledgePoint[]; resources: ResourceItem[]; busy: boolean; blocked?: boolean; error: string; phase: string; result: AiResult | null; sessionId: string; configured: boolean; serviceLabel: string }>()
const emit = defineEmits<{ start: [request: AiRequest]; cancel: []; reset: []; settings: []; showTask: []; locate: [id: string]; preview: [resource: ResourceItem] }>()
const question = ref(''); const action = ref<'search' | 'answer'>('search'); const supplement = ref(false); const selectedResources = ref<string[]>([])
const history = ref<{ question: string; result: AiResult }[]>([])
const lastQuestion = ref('')
const output = ref<Exclude<AiResult, { kind: 'extract' }> | null>(null)
watch(() => props.result, value => { if (value && value.kind !== 'extract') output.value = value })
const hits = computed(() => output.value?.kind === 'search' ? output.value.hits.map(hit => ({ ...hit, point: props.points.find(p => p.id === hit.pointId) })).filter(hit => hit.point) : [])
function submit() {
  if (!question.value.trim() || props.busy || props.blocked) return
  if (output.value && lastQuestion.value) history.value.push({ question: lastQuestion.value, result: JSON.parse(JSON.stringify(output.value)) })
  output.value = null
  lastQuestion.value = question.value.trim()
  emit('start', { action: action.value, text: question.value.trim(), resourceIds: selectedResources.value.filter(id => props.resources.some(r => r.id === id)), sessionId: props.sessionId || undefined, allowSupplement: supplement.value })
}
function reset() { emit('reset'); history.value = []; output.value = null; lastQuestion.value = ''; question.value = '' }
function sourceAvailable(source: AiSource) { if (source.pointId && !props.points.some(p => p.id === source.pointId)) return false; return source.resourceId ? props.resources.some(r => r.id === source.resourceId) : !!source.pointId }
function openSource(source: AiSource) { if (source.resourceId) { const resource = props.resources.find(r => r.id === source.resourceId); if (resource) emit('preview', resource) } else if (source.pointId) emit('locate', source.pointId) }
const textResources = computed(() => props.resources.filter(r => ['text', 'markdown'].includes(r.kind)))
</script>

<template>
  <section class="ai-knowledge-panel" aria-label="AI 知识助手">
    <div class="ai-mode-row" role="group" aria-label="AI 操作">
      <button class="button compact-button" :class="{'button-primary':action==='search'}" :aria-pressed="action==='search'" :disabled="busy || blocked" @click="action='search'">查找知识</button>
      <button class="button compact-button" :class="{'button-primary':action==='answer'}" :aria-pressed="action==='answer'" :disabled="busy || blocked" @click="action='answer'">回答问题</button>
      <button class="text-button ai-new-session" :disabled="busy || blocked" @click="reset">新会话</button>
    </div>
    <div v-if="blocked" class="ai-context-banner ai-other-task" role="status"><span>正在整理学习文本</span><button class="text-button" data-testid="ai-view-task" @click="emit('showTask')">查看任务</button></div>
    <form @submit.prevent="submit">
      <label class="ai-question-label" for="ai-question">{{action==='search'?'想找什么知识？':'你的问题'}}</label>
      <textarea id="ai-question" v-model="question" class="field ai-question" :readonly="busy || blocked" aria-label="自然语言问题" data-testid="ai-question" :placeholder="action==='search'?'例如：进入 Docker 容器终端，但我忘了命令':'例如：怎么进入运行中的 Docker 容器？'" rows="3" @keydown.ctrl.enter.prevent="submit" />
      <details v-if="textResources.length" class="ai-text-context">
        <summary>附加文本资料<span v-if="selectedResources.length">（{{selectedResources.length}}）</span></summary>
        <p>所选正文会随问题发送至 {{ serviceLabel }}。</p>
        <label v-for="resource in textResources" :key="resource.id"><input v-model="selectedResources" type="checkbox" :value="resource.id" :disabled="busy || blocked" />{{resource.title}}</label>
      </details>
      <label v-if="action==='answer'" class="ai-check"><input v-model="supplement" type="checkbox" :disabled="busy || blocked" aria-label="允许 AI 补充通用知识" />允许 AI 补充通用知识</label>
      <div class="ai-submit-row">
        <button v-if="busy" class="button" type="button" data-testid="ai-cancel" @click="emit('cancel')">取消</button>
        <button v-else-if="!configured" class="button" type="button" @click="emit('settings')">配置模型</button>
        <button class="button button-primary" type="submit" :disabled="busy || blocked || !configured || !question.trim()" data-testid="ai-submit"><Icon name="search" :size="15" />{{action==='search'?'自动查找':'检索并回答'}}</button>
      </div>
    </form>
    <p v-if="busy" role="status" class="ai-task-status"><span class="spinner small" />{{phase}}</p>
    <p v-else-if="phase === '已取消'" class="ai-help" role="status">已取消，可修改问题后再试。</p>
    <div v-if="error" class="ai-error" role="alert" data-testid="ai-error">{{error}}<button class="text-button" :disabled="busy || blocked" @click="submit">重试</button></div>
    <div v-if="history.length" class="ai-conversation-history">
      <details v-for="(turn,index) in history" :key="index">
        <summary>{{turn.question}}</summary>
        <template v-if="turn.result.kind==='answer'">
          <section v-for="(block,i) in turn.result.blocks" :key="i" class="ai-answer-block">
            <p class="ai-basis">{{{personal:'已有知识依据',inference:'结构推断',supplement:'AI 补充'}[block.basis]}}</p>
            <MarkdownText :text="block.markdown" />
            <div class="ai-source-list"><button v-for="source in turn.result.sources.filter(s=>block.sourceHandles.includes(s.handle))" :key="source.handle" class="ai-source" :disabled="!sourceAvailable(source)" :title="source.excerpt" @click="openSource(source)">{{source.title}}<small>{{!sourceAvailable(source)?'已移除':source.kind==='associated'?'关联资料，未读取全文':'查看依据'}}</small></button></div>
          </section>
        </template>
        <template v-else-if="turn.result.kind==='search'"><button v-for="hit in turn.result.hits" :key="hit.pointId" class="result-item" :disabled="!points.some(p=>p.id===hit.pointId)" @click="emit('locate',hit.pointId)">{{points.find(p=>p.id===hit.pointId)?.name || '知识点已移除'}}</button></template>
      </details>
    </div>
    <div v-if="output" class="ai-output" data-testid="ai-output">
      <p class="ai-output-question">{{lastQuestion}}</p>
      <template v-if="output.kind==='search'">
        <p v-if="!hits.length" class="ai-help">没有找到相关知识，换个问法再试。</p>
        <button v-for="hit in hits" :key="hit.pointId" class="result-item" @click="emit('locate',hit.pointId)"><strong class="result-name">{{hit.point!.name}}</strong><span class="result-description">{{hit.reason}}</span><span class="ai-result-action">在图谱中查看</span></button>
      </template>
      <template v-else-if="output.kind==='answer'">
        <section v-for="(block,index) in output.blocks" :key="index" class="ai-answer-block">
          <p class="ai-basis">{{ {personal:'已有知识依据',inference:'结构推断',supplement:'AI 补充'}[block.basis] }}</p>
          <MarkdownText :text="block.markdown" />
          <div class="ai-source-list"><button v-for="source in output.sources.filter(s=>block.sourceHandles.includes(s.handle))" :key="source.handle" class="ai-source" :disabled="!sourceAvailable(source)" :title="source.excerpt" @click="openSource(source)"><Icon :name="source.resourceId?'book':'layers'" :size="13" />{{source.title}}<small>{{!sourceAvailable(source)?'已移除':source.kind==='associated'?'关联资料，未读取全文':'查看依据'}}</small></button></div>
        </section>
        <button class="text-button" :disabled="busy || blocked" @click="action='answer'; question=''">继续追问</button>
      </template>
      <p v-if="output.note" class="ai-help">{{output.note}}</p>
    </div>
  </section>
</template>

<style scoped>
.ai-knowledge-panel{padding:16px;min-width:0}
.ai-mode-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:18px}
.ai-new-session{margin-left:auto;white-space:nowrap}
.ai-question-label{display:block;font-size:13px;font-weight:600;margin-bottom:9px}
.ai-question{resize:vertical;min-height:104px;font-size:14px;line-height:1.8}
.ai-question::placeholder{color:var(--muted)}
.ai-submit-row{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-top:14px}
.ai-check{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.8;margin:14px 0}
.ai-check input{flex-shrink:0;margin-top:3px}
.ai-text-context{font-size:13px;color:#555;line-height:1.8;margin:14px 0}
.ai-text-context summary{cursor:pointer}
.ai-text-context p{color:var(--muted);margin:8px 0}
.ai-text-context label{display:flex;gap:8px;align-items:flex-start;padding:6px 0;overflow-wrap:anywhere}
.ai-text-context input{flex-shrink:0;margin-top:4px}
.ai-other-task{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ai-other-task .text-button{margin-left:auto}
.ai-output{padding-top:18px;margin-top:18px;border-top:1px solid #d1d1d1}
.ai-output-question{font-size:14px;font-weight:600;line-height:1.8;margin-bottom:14px;overflow-wrap:anywhere}
.ai-answer-block{padding:14px 0;border-bottom:1px solid #ddd}
.ai-basis{font-size:13px;color:#555;margin-bottom:9px}
.ai-source-list{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.ai-source{display:flex;flex-wrap:wrap;gap:5px;align-items:center;text-align:left;padding:8px 10px;border:1px solid #ccc;border-radius:6px;background:#fff8;font-size:13px;overflow-wrap:anywhere;max-width:100%}
.ai-source small{font-size:12px;color:var(--muted)}
.ai-source:hover:not(:disabled){background:#fff}
.ai-result-action{display:block;margin-top:8px;font-size:13px;color:#555}
.result-description{display:block;font-size:14px;color:var(--muted);line-height:1.8;margin-top:8px;overflow-wrap:anywhere}
.ai-conversation-history{margin-top:18px;font-size:13px;line-height:1.8}
.ai-conversation-history details{border-top:1px solid #ddd;padding:12px 0}
.ai-conversation-history summary{cursor:pointer;overflow-wrap:anywhere}
</style>
