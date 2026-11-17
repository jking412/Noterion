<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Space } from '../composables/useNoterion'
import { errorText } from '../desktop'
import Icon from './Icon.vue'
import ModalShell from './ModalShell.vue'
const props = defineProps<{ spaces: Space[]; currentId: string; busy: boolean; switchSpace: (id: string) => Promise<boolean>; createSpace: (name: string) => Promise<boolean>; renameSpace: (id: string, name: string) => Promise<boolean> }>()
const dialog = ref<'manage' | 'create' | 'rename' | null>(null)
const name = ref('')
const error = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const spaceSelect = ref<HTMLSelectElement | null>(null)
const current = computed(() => props.spaces.find(space => space.id === props.currentId))
const dialogTitle = computed(() => dialog.value === 'create' ? '新建空间' : dialog.value === 'rename' ? '重命名空间' : '知识空间')
watch(() => props.currentId, () => { dialog.value = null })
async function open(mode: 'manage' | 'create' | 'rename') {
  dialog.value = mode
  name.value = mode === 'rename' ? current.value?.name ?? '' : ''
  error.value = ''
  await nextTick()
  if (mode === 'manage') spaceSelect.value?.focus()
  else nameInput.value?.focus()
}
async function save() {
  if (!name.value.trim()) { error.value = '请输入空间名称。'; return }
  try {
    const ok = dialog.value === 'create' ? await props.createSpace(name.value.trim()) : await props.renameSpace(props.currentId, name.value.trim())
    if (ok) dialog.value = null
    else error.value = '空间未保存，请重试。'
  } catch (e) { error.value = errorText(e) }
}
async function select(event: Event) {
  const input = event.target as HTMLSelectElement
  const id = input.value
  input.value = props.currentId
  if (id === props.currentId) return
  error.value = ''
  try {
    if (await props.switchSpace(id)) dialog.value = null
    else error.value = '未切换空间，请重试。'
  } catch (e) { error.value = errorText(e) }
}
</script>
<template>
  <section class="space-switcher" aria-label="当前空间" data-testid="space-switcher">
    <button class="space-menu" type="button" :aria-label="'当前空间：' + (current?.name || '尚未读取')" aria-haspopup="dialog" :aria-expanded="!!dialog" :disabled="busy || !current" :data-current-space="current?.name || ''" data-testid="space-menu" @click="open('manage')">
      <Icon name="layers" :size="20" />
      <span class="space-menu-name">{{ current?.name || '尚未读取' }}</span>
      <Icon class="space-menu-chevron" name="chevron" :size="16" />
    </button>
    <ModalShell v-if="dialog" :title="dialogTitle" @close="!busy && (dialog = null)">
      <template v-if="dialog === 'manage'">
        <label class="space-label" for="current-space">当前空间</label>
        <select id="current-space" ref="spaceSelect" autofocus class="field space-select" :value="currentId" :disabled="busy || !spaces.length" data-testid="space-select" @change="select"><option v-for="space in spaces" :key="space.id" :value="space.id">{{ space.name }}</option></select>
        <p v-if="error" class="space-error" role="alert">{{ error }}</p>
        <div class="space-actions"><button class="button button-primary" :disabled="busy || !current" data-testid="space-create" @click="open('create')"><Icon name="plus" :size="17" />新建空间</button><button class="button" :disabled="busy || !current" data-testid="space-rename" @click="open('rename')"><Icon name="edit" :size="17" />重命名</button></div>
      </template>
      <form v-else @submit.prevent="save"><label class="space-label" for="space-name">空间名称</label><input id="space-name" ref="nameInput" v-model="name" autofocus class="field space-name" maxlength="100" :disabled="busy" data-testid="space-name" placeholder="例如：计算机网络" /><p v-if="error" class="space-error" role="alert">{{ error }}</p><footer class="space-dialog-actions"><button type="button" class="button" :disabled="busy" @click="open('manage')">取消</button><button type="submit" class="button button-primary" :disabled="busy || !name.trim()" data-testid="space-save">{{ busy ? '正在保存…' : '保存' }}</button></footer></form>
    </ModalShell>
  </section>
</template>
<style scoped>
.space-switcher { width:100%; min-width:0; }
.space-menu { display:flex; align-items:center; gap:9px; width:100%; min-width:0; min-height:48px; padding:11px 12px; border:1px solid #d1d1d1; border-radius:9px; background:#f7f7f7; text-align:left; }
.space-menu:hover:not(:disabled) { background:#fff; border-color:#b7b7b7; }
.space-menu>.ui-icon { flex-shrink:0; }
.space-menu-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; font-weight:600; }
.space-menu-chevron { color:#646464; }
.space-label { display:block; font-size:14px; font-weight:600; }
.space-select,.space-name { display:block; width:100%; min-width:0; max-width:100%; margin:10px 0 20px; text-overflow:ellipsis; }
.space-actions,.space-dialog-actions { display:flex; flex-wrap:wrap; gap:10px; }
.space-actions { margin-top:20px; }
.space-dialog-actions { justify-content:flex-end; padding-top:18px; border-top:1px solid #d9d9d9; }
.space-error { margin:12px 0; color:#8f3c2d; font-size:14px; line-height:1.6; overflow-wrap:anywhere; }
:global(.navigation-collapsed .space-switcher .space-menu-name),:global(.navigation-collapsed .space-switcher .space-menu-chevron) { display:none; }
:global(.navigation-collapsed .space-switcher .space-menu) { justify-content:center; padding:12px; }
@media(max-width:850px) {
  .space-menu-name,.space-menu-chevron { display:none; }
  .space-menu { justify-content:center; padding:12px; }
}
</style>
