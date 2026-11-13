<script setup lang="ts">
import { computed } from 'vue'
import { getTopicTags } from '../domain/logic'
import type { DeleteImpact, KnowledgePoint, ResourceItem } from '../domain/types'
import ModalShell from './ModalShell.vue'

const props = defineProps<{ point: KnowledgePoint; points: KnowledgePoint[]; resources: ResourceItem[]; impact: DeleteImpact; busy?: boolean; operationError?: string }>()
const emit = defineEmits<{ confirm: []; close: [] }>()
const deletedPoints = computed(() => props.points.filter(point => props.impact.deletedIds.includes(point.id)))
const retainedPoints = computed(() => props.points.filter(point => props.impact.retainedIds.includes(point.id)))
const remainingPoints = computed(() => props.points.filter(point => !props.impact.deletedIds.includes(point.id)))
</script>

<template>
  <ModalShell title="确认从图谱删除" wide @close="emit('close')">
    <p class="delete-intro">删除“<strong>{{ point.name }}</strong>”后，以下变化将立即生效。</p>
    <div class="impact-columns">
      <section class="impact-section">
        <h3>将删除 <span>{{ deletedPoints.length }}</span></h3>
        <p class="impact-help">包括所选知识点，以及因此失去全部所属主题的受影响下属点。</p>
        <ul class="point-list">
          <li v-for="item in deletedPoints" :key="item.id">
            <div class="point-line"><strong>{{ item.name }}</strong><span class="point-type">{{ item.isTheme ? '主题' : '知识点' }}</span></div>
            <div v-if="getTopicTags(item, points).length" class="topic-tags"><span v-for="theme in getTopicTags(item, points)" :key="theme.id" class="tag">{{ theme.name }}</span></div>
          </li>
        </ul>
      </section>
      <section class="impact-section">
        <h3>将保留 <span>{{ retainedPoints.length }}</span></h3>
        <p class="impact-help">仍有其他主题归属的共享点及其下属保留；无关独立点不受影响。</p>
        <ul v-if="retainedPoints.length" class="point-list">
          <li v-for="item in retainedPoints" :key="item.id">
            <div class="point-line"><strong>{{ item.name }}</strong><span class="point-type">{{ item.isTheme ? '主题' : '知识点' }}</span></div>
            <div v-if="getTopicTags(item, remainingPoints).length" class="topic-tags"><span v-for="theme in getTopicTags(item, remainingPoints)" :key="theme.id" class="tag">{{ theme.name }}</span></div>
          </li>
        </ul>
        <p v-else class="empty-list">此次删除没有需要保留的受影响下属点。</p>
      </section>
    </div>
    <div class="delete-note">
      <p>全部 {{ resources.length }} 份资料及其文件均保留。</p>
      <p>不提供回收站，删除后无法撤销。</p>
    </div>
    <footer class="delete-footer">
      <p v-if="operationError" role="alert">{{ operationError }}</p>
      <button class="button" type="button" :disabled="busy" autofocus @click="emit('close')">取消</button>
      <button class="button button-primary" type="button" :disabled="busy || !deletedPoints.length" @click="emit('confirm')">确认删除 {{ deletedPoints.length }} 个知识点</button>
    </footer>
  </ModalShell>
</template>

<style scoped>
.delete-intro { margin: 0 0 22px; font-size: 15px; line-height: 1.7; overflow-wrap: anywhere; }
.impact-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 22px; }
.impact-section { min-width: 0; }
.impact-section h3 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; font-weight: 600; }
.impact-section h3 > span { display: inline-grid; place-items: center; min-width: 24px; height: 24px; padding: 0 4px; border-radius: 6px; background: #e3e3e3; font-size: 13px; }
.impact-help { min-height: 42px; margin: 9px 0 12px; color: #646464; font-size: 13px; line-height: 1.75; }
.point-list { display: flex; flex-direction: column; gap: 8px; max-height: 310px; margin: 0; padding: 2px; overflow-y: auto; list-style: none; }
.point-list li { padding: 11px 12px; border: 1px solid #d9d9d9; border-radius: 9px; background: #ffffffa8; }
.point-line { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.point-line strong { font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.point-type { flex: 0 0 auto; color: #646464; font-size: 13px; }
.topic-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.empty-list { margin: 0; padding: 18px 14px; border: 1px dashed #cecece; border-radius: 9px; color: #646464; font-size: 13px; line-height: 1.7; }
.delete-note { margin-top: 22px; padding: 13px 15px; border: 1px solid #cecece; border-radius: 9px; background: #ecececa8; }
.delete-note p { margin: 0; font-size: 13px; line-height: 1.8; }
.delete-note p + p { color: #646464; }
.delete-footer>p { flex-basis:100%; color:#813b2f; line-height:1.8; overflow-wrap:anywhere; }.delete-footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; margin-top: 22px; padding-top: 18px; border-top: 1px solid #d9d9d9; }
@media (max-width: 700px) { .impact-columns { grid-template-columns: minmax(0,1fr); } .impact-help { min-height: 0; } }
</style>
