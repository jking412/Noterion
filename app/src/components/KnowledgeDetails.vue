<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from './Icon.vue'
import MarkdownText from './MarkdownText.vue'
import { getTopicTags, parseDescription } from '../domain/logic'
import type { KnowledgePoint, ResourceItem } from '../domain/types'
const props = defineProps<{ point: KnowledgePoint | null; points: KnowledgePoint[]; resources: ResourceItem[]; deleteDisabled: boolean }>()
const emit = defineEmits<{ select: [id: string]; edit: [id: string]; delete: [id: string]; preview: [resource: ResourceItem]; close: [] }>()
const sections = computed(() => parseDescription(props.point?.description || ''))
const topics = computed(() => props.point ? getTopicTags(props.point, props.points) : [])
const attached = computed(() => props.resources.filter((r) => props.point?.resourceIds.includes(r.id)))
const copied = ref(false)
const menuOpen = ref(false)
const menuTrigger = ref<HTMLButtonElement | null>(null)
const menuElement = ref<HTMLDivElement | null>(null)
const menuPosition = ref({ x: 0, y: 0 })
let copiedTimer: ReturnType<typeof setTimeout> | undefined
watch(() => [props.point?.id, props.deleteDisabled], () => { menuOpen.value = false; copied.value = false; clearTimeout(copiedTimer) })
function closePointMenu() { menuOpen.value = false; menuTrigger.value?.focus() }
async function togglePointMenu() {
  if (menuOpen.value) { closePointMenu(); return }
  const bounds = menuTrigger.value?.getBoundingClientRect()
  if (!bounds) return
  menuPosition.value = { x: Math.max(8, Math.min(window.innerWidth - 190, bounds.right - 174)), y: bounds.bottom + 108 < window.innerHeight ? bounds.bottom + 8 : Math.max(8, bounds.top - 100) }
  menuOpen.value = true
  await nextTick()
  menuElement.value?.querySelector('button')?.focus()
}
function menuAction(action: 'edit' | 'delete') {
  if (action === 'delete' && props.deleteDisabled) return
  closePointMenu()
  if (props.point) {
    if (action === 'edit') emit('edit', props.point.id)
    else emit('delete', props.point.id)
  }
}
async function copyCommand() {
  if (!sections.value.command) return
  try { await navigator.clipboard.writeText(sections.value.command) }
  catch {
    const textarea = document.createElement('textarea')
    textarea.value = sections.value.command; textarea.style.position = 'fixed'; textarea.style.opacity = '0'
    document.body.appendChild(textarea); textarea.select(); document.execCommand('copy'); textarea.remove()
  }
  copied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => { copied.value = false }, 1800)
}
onBeforeUnmount(() => clearTimeout(copiedTimer))
</script>
<template>
  <section class="details-panel glass-panel" :class="{ 'is-empty': !point }" aria-label="知识详情" data-testid="knowledge-details">
    <div v-if="!point" class="details-idle"><Icon name="book" :size="18" /><span>知识详情</span><span class="idle-caption">选择一个知识点，找回你的理解。</span></div>
    <template v-else>
      <header class="details-header">
        <div class="details-heading"><h1>{{ point.name }}</h1>
        <div class="details-actions">
          <button class="button" data-testid="edit-point" title="编辑知识点" @click="emit('edit', point.id)"><span>编辑</span></button>
          <div class="action-menu-wrap" @keydown.esc="menuOpen = false">
            <button ref="menuTrigger" class="icon-button" data-testid="point-menu" aria-label="知识点操作" :aria-expanded="menuOpen" aria-haspopup="menu" @click="togglePointMenu"><Icon name="more" /></button>
            <Teleport to="body"><template v-if="menuOpen"><button class="menu-scrim point-menu-scrim" tabindex="-1" aria-label="关闭操作菜单" @click="closePointMenu" /><div ref="menuElement" class="popover-menu point-actions" role="menu" :style="{ left: menuPosition.x + 'px', top: menuPosition.y + 'px' }" @keydown.esc.stop.prevent="closePointMenu"><button role="menuitem" @click="menuAction('edit')"><Icon name="edit" />编辑知识点</button><button data-testid="delete-point" role="menuitem" :disabled="deleteDisabled" :title="deleteDisabled ? '图谱就绪后可删除' : undefined" @click="menuAction('delete')"><Icon name="trash" />{{ point.isTheme ? '删除主题' : '删除知识点' }}</button></div></template></Teleport>
          </div>
          <button class="icon-button" aria-label="关闭知识详情" @click="emit('close')"><Icon name="close" /></button>
        </div>
        </div>
        <div class="detail-topics"><button v-for="topic in topics" :key="topic.id" class="tag tag-button" @click="emit('select', topic.id)">{{ topic.name }}</button><span v-if="point.isTheme && !topics.length" class="tag">主题</span></div>
      </header>
      <div class="details-scroll" :key="point.id">
        <section class="detail-section description-column">
          <h2>描述</h2><div class="prose-text"><MarkdownText :text="sections.description || '还没有描述，编辑后写下你的理解。'" /></div>
        </section>
        <section class="detail-section command-column">
          <div class="column-heading"><h2>命令与步骤</h2><button v-if="sections.command" class="button compact-button" @click="copyCommand"><Icon :name="copied ? 'check' : 'copy'" :size="15" />{{ copied ? '已复制' : '复制' }}</button></div>
          <pre v-if="sections.command" class="command-box"><code>{{ sections.command }}</code></pre><p v-else class="empty-column">这个知识点没有命令或步骤。</p>
          <span class="sr-only" role="status">{{ copied ? '命令已复制' : '' }}</span>
        </section>
        <section v-if="sections.understanding" class="detail-section understanding-column"><h2>个人理解</h2><p class="prose-text">{{ sections.understanding }}</p></section>
        <section class="detail-section resources-column"><div class="column-heading"><h2>关联资料 <span class="count">{{ attached.length }}</span></h2></div><div class="resource-list">
          <template v-for="resource in attached" :key="resource.id">
            <button class="resource-row" @click="emit('preview', resource)"><Icon name="file" :size="18" /><span class="resource-title">{{ resource.title }}</span><span class="resource-action">{{ resource.kind === 'link' ? '查看链接' : '预览' }}</span></button>
          </template>
          <p v-if="!attached.length" class="empty-column">还没有关联资料。</p>
        </div></section>
      </div>
    </template>
  </section>
</template>
