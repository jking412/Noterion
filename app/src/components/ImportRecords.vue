<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import type { ImportRecord } from '../domain/importHistory'
import type { KnowledgePoint } from '../domain/types'

const props = defineProps<{ records: ImportRecord[]; points: KnowledgePoint[] }>()
const emit = defineEmits<{ retry: [record: ImportRecord]; locate: [id: string]; create: [] }>()
const filter = ref('all')
const selectedId = ref<string | null>(null)
const filtered = computed(() => props.records.filter((record) => filter.value === 'all' || record.status === filter.value))
const selected = computed(() => filtered.value.find((record) => record.recordId === selectedId.value) || filtered.value[0])
const resolution = computed(() => props.records.find((record) => record.recordId === selected.value?.resolvedByRecordId))
const labels = { success: '导入完成', failed: '待修正', duplicate: '重复输入 · 已跳过', resolved: '问题已修正' }
const filters = [
  { id: 'all', title: '全部记录' },
  { id: 'success', title: '已完成' },
  { id: 'failed', title: '待修正' },
  { id: 'resolved', title: '已解决' },
  { id: 'duplicate', title: '已跳过' },
]
function clearFilter() { filter.value = 'all'; selectedId.value = null }
function showResolution() {
  if (!resolution.value) return
  selectedId.value = resolution.value.recordId
  filter.value = 'all'
}
function date(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date(value))
}
</script>

<template>
  <section class="records-workspace glass-panel">
    <div class="workspace-heading">
      <h1>导入记录 <small>{{ records.length }}</small></h1>
      <button class="button" @click="emit('create')"><Icon name="plus" />新建导入</button>
    </div>
    <div class="records-filter" aria-label="筛选导入记录">
      <button v-for="option in filters" :key="option.id" class="button" :class="{ 'button-selected': filter === option.id }" :aria-pressed="filter === option.id" @click="filter = option.id; selectedId = null">{{ option.title }}</button>
    </div>
    <div v-if="!filtered.length" class="empty-workspace">
      <Icon name="layers" :size="36" />
      <h2>{{ records.length ? '没有这类记录' : '还没有导入记录' }}</h2>
      <p>{{ records.length ? '当前筛选没有结果，可以查看全部记录。' : '从资料库中的资料发起知识导入，完成后在这里查看处理结果。' }}</p>
      <button v-if="records.length" class="button" @click="clearFilter">查看全部记录</button>
      <template v-else>
        <button class="button" @click="emit('create')">导入知识文件</button>
        <a class="guide-link" href="./test-data/noterion-test-data.zip" download>下载测试数据包 ↓</a>
      </template>
    </div>
    <div v-else class="history-layout">
      <div class="history-list">
        <button v-for="record in filtered" :key="record.recordId" class="history-row" :class="{ selected: selected?.recordId === record.recordId }" :aria-pressed="selected?.recordId === record.recordId" @click="selectedId = record.recordId">
          <Icon :name="record.status === 'failed' ? 'alert' : record.status === 'duplicate' ? 'copy' : 'circleCheck'" :size="21" />
          <div><strong>{{ record.filename }}</strong><small>{{ date(record.createdAt) }} · {{ record.draft.importId || '批次 ID 缺失' }}</small><span>{{ labels[record.status] }}</span></div>
          <Icon name="chevron" :size="15" class="history-chevron" />
        </button>
      </div>
      <section v-if="selected" class="history-details inner-panel">
        <div class="section-heading"><h2>{{ labels[selected.status] }}</h2><span>{{ date(selected.createdAt) }}</span></div>
        <div class="history-details-content">
          <h3>{{ selected.filename }}</h3>
          <p class="mono muted">{{ selected.draft.importId }}</p>
          <div class="result-stat-cards">
            <div><strong>{{ selected.counts.added }}</strong><span>新增知识点</span></div>
            <div><strong>{{ selected.counts.updated }}</strong><span>补充知识点</span></div>
            <div><strong>{{ selected.counts.topicLinks }}</strong><span>新增主题关系</span></div>
            <div><strong>{{ selected.counts.resourceLinks }}</strong><span>新增资料关联</span></div>
          </div>
          <p v-if="selected.status === 'success'" class="history-note">同一知识点沿用原有身份，未在输入中出现的内容与关联继续保留。</p>
          <p v-if="selected.status === 'resolved'" class="history-note">这次尝试未写入知识，问题已在后续处理时解决。</p>
          <div v-if="selected.messages.length" class="history-messages">
            <h4 v-if="selected.status === 'resolved'">当时的校验提示</h4>
            <p v-for="(message, index) in selected.messages" :key="index">{{ message }}</p>
          </div>
          <h4 v-if="selected.pointIds.length">本次知识点</h4>
          <div class="result-contributions">
            <button v-for="id in selected.pointIds" :key="id" :disabled="!points.some((point) => point.id === id)" @click="emit('locate', id)"><Icon name="file" :size="15" />{{ points.find((point) => point.id === id)?.name || id + '（已移除）' }}<Icon name="external" :size="12" /></button>
          </div>
          <button v-if="selected.status === 'failed'" class="button button-primary" @click="emit('retry', selected)">返回修正并重试<Icon name="arrow" class="forward-arrow" :size="15" /></button>
          <button v-if="selected.status === 'resolved' && resolution" class="button" @click="showResolution">查看后续处理结果<Icon name="chevron" :size="15" /></button>
          <p v-if="selected.status === 'duplicate'" class="history-note">该批输入此前已经成功处理；本次未修改任何内容。</p>
        </div>
      </section>
    </div>
  </section>
</template>
