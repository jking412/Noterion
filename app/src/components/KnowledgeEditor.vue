<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getTopicTags, validatePoint } from '../domain/logic'
import type { KnowledgePoint, ResourceItem } from '../domain/types'
import ModalShell from './ModalShell.vue'

const props = defineProps<{ point: KnowledgePoint; points: KnowledgePoint[]; resources: ResourceItem[]; creating?: boolean }>()
const emit = defineEmits<{ save: [point: KnowledgePoint]; close: [] }>()
const draft = ref<KnowledgePoint>({ ...props.point, topicIds: [...props.point.topicIds], resourceIds: [...props.point.resourceIds] })
const submitted = ref(false)
const themes = computed(() => props.points.filter((point) => point.isTheme && point.id !== draft.value.id))
const validation = computed(() => validatePoint(draft.value, props.points))

watch(() => props.point, (point) => {
  draft.value = { ...point, topicIds: [...point.topicIds], resourceIds: [...point.resourceIds] }
  submitted.value = false
})

function save() {
  submitted.value = true
  if (validation.value) return
  emit('save', { ...draft.value, name: draft.value.name.trim(), topicIds: [...draft.value.topicIds], resourceIds: [...draft.value.resourceIds] })
}
</script>

<template>
  <ModalShell :title="creating ? '新建知识点' : '编辑知识点'" wide @close="emit('close')">
    <form class="editor" novalidate @submit.prevent="save">
      <div class="editor-main">
        <template v-if="creating"><label class="editor-label" for="knowledge-id">知识点 ID</label><input id="knowledge-id" v-model="draft.id" class="field" required autocomplete="off" /><p class="field-help">用于引用这个知识点；同名知识点可使用不同 ID。</p></template>
        <label class="editor-label" for="knowledge-name">名称</label>
        <input id="knowledge-name" v-model="draft.name" class="field" autofocus autocomplete="off" :aria-invalid="submitted && !draft.name.trim()" />
        <label class="check-option" style="margin-top:12px"><input v-model="draft.isTheme" type="checkbox" /><span>可作为主题组织其他知识点</span></label>
        <div class="description-label">
          <label class="editor-label" for="knowledge-description">描述</label>
          <span>Markdown</span>
        </div>
        <textarea id="knowledge-description" v-model="draft.description" class="field description-input" spellcheck="false" aria-describedby="description-help" />
        <p id="description-help" class="field-help">描述、命令与个人理解保存在同一份原文中，可用“## 描述”“## 命令”“## 个人理解”分段。</p>
      </div>
      <div class="editor-side">
        <fieldset>
          <legend>所属主题</legend>
          <p class="field-help">可选择多个主题；不选择时作为独立知识点保留。</p>
          <div class="option-list">
            <label v-for="theme in themes" :key="theme.id" class="check-option">
              <input v-model="draft.topicIds" type="checkbox" :value="theme.id" />
              <span><strong>{{ theme.name }}</strong><span v-if="getTopicTags(theme, points).length" class="theme-ancestors"><span v-for="ancestor in getTopicTags(theme, points)" :key="ancestor.id" class="tag">{{ ancestor.name }}</span></span></span>
            </label>
            <p v-if="!themes.length" class="field-help">暂无其他主题。</p>
          </div>
        </fieldset>
        <fieldset>
          <legend>关联资料</legend>
          <div class="option-list">
            <label v-for="resource in resources" :key="resource.id" class="check-option">
              <input v-model="draft.resourceIds" type="checkbox" :value="resource.id" />
              <span><strong>{{ resource.title }}</strong><small>{{ resource.filename || (resource.kind === 'link' ? '外部链接' : resource.kind.toUpperCase()) }}</small></span>
            </label>
            <p v-if="!resources.length" class="field-help">暂无可关联资料。</p>
          </div>
        </fieldset>
      </div>
      <p v-if="submitted && validation" class="validation-message" role="alert">{{ validation }}</p>
      <footer class="editor-footer">
        <button class="button" type="button" @click="emit('close')">取消</button>
        <button class="button button-primary" type="submit">{{ creating ? '创建知识点' : '保存修改' }}</button>
      </footer>
    </form>
  </ModalShell>
</template>

<style scoped>
.editor { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(230px, 1fr); gap: 24px; }
.editor-main { min-width: 0; }
.editor-label { display: block; margin-bottom: 8px; font-size: 14px; font-weight: 600; }
.editor-main > .field { box-sizing: border-box; width: 100%; }
.description-label { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-top: 20px; }
.description-label > span { color: #646464; font-size: 12px; }
.description-input { display: block; min-height: 345px; resize: vertical; padding: 12px; font-family: 'Cascadia Code', Consolas, 'Microsoft YaHei', monospace; font-size: 13px; line-height: 1.7; }
.field-help { margin: 8px 0 12px; color: #646464; font-size: 12px; line-height: 1.7; }
.editor-side { display: flex; min-width: 0; flex-direction: column; gap: 20px; }
fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
legend { margin-bottom: 8px; padding: 0; font-size: 14px; font-weight: 600; }
.option-list { display: flex; flex-direction: column; gap: 7px; max-height: 210px; overflow-y: auto; padding: 2px; }
.check-option { display: flex; gap: 10px; align-items: flex-start; padding: 9px 10px; border: 1px solid #d9d9d9; border-radius: 8px; background: #ffffff9c; cursor: pointer; }
.check-option:hover { background: #eee; }
.check-option input { flex: 0 0 auto; margin: 4px 0 0; accent-color: #333; }
.check-option span { min-width: 0; }
.check-option strong { display: block; font-size: 13px; font-weight: 500; line-height: 1.6; overflow-wrap: anywhere; }
.check-option small { display: block; color: #646464; font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.theme-ancestors { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.validation-message { grid-column: 1 / -1; margin: 0; padding: 10px 12px; border: 1px solid #777; border-radius: 8px; background: #ececec; font-size: 13px; }
.editor-footer { display: flex; grid-column: 1 / -1; justify-content: flex-end; gap: 10px; padding-top: 18px; border-top: 1px solid #d9d9d9; }
@media (max-width: 760px) { .editor { grid-template-columns: minmax(0, 1fr); } .description-input { min-height: 250px; } }
</style>
