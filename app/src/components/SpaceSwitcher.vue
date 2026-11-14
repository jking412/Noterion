<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Space } from '../composables/useNoterion'
import ModalShell from './ModalShell.vue'
const props = defineProps<{ spaces: Space[]; currentId: string; busy: boolean; switchSpace: (id: string) => Promise<boolean>; createSpace: (name: string) => Promise<boolean>; renameSpace: (id: string, name: string) => Promise<boolean> }>()
const dialog = ref<'create' | 'rename' | null>(null)
const name = ref('')
const error = ref('')
const current = computed(() => props.spaces.find(space => space.id === props.currentId))
watch(() => props.currentId, () => { dialog.value = null })
function open(mode: 'create' | 'rename') { dialog.value = mode; name.value = mode === 'rename' ? current.value?.name ?? '' : ''; error.value = '' }
async function save() {
  if (!name.value.trim()) { error.value = '请输入空间名称。'; return }
  const ok = dialog.value === 'create' ? await props.createSpace(name.value.trim()) : await props.renameSpace(props.currentId, name.value.trim())
  if (ok) dialog.value = null
  else error.value = '未保存空间，请查看错误信息后重试。'
}
async function select(event: Event) { const input = event.target as HTMLSelectElement; const id = input.value; input.value = props.currentId; await props.switchSpace(id) }
</script>
<template>
  <section class="space-switcher" aria-label="当前空间" data-testid="space-switcher">
    <label for="current-space">空间</label>
    <select id="current-space" class="field" :value="currentId" :disabled="busy || !spaces.length" data-testid="space-select" @change="select"><option v-for="space in spaces" :key="space.id" :value="space.id">{{ space.name }}</option></select>
    <div class="space-actions"><button class="button" :disabled="busy || !current" data-testid="space-create" @click="open('create')">新建空间</button><button class="button" :disabled="busy || !current" data-testid="space-rename" @click="open('rename')">重命名</button></div>
    <ModalShell v-if="dialog" :title="dialog === 'create' ? '新建空间' : '重命名空间'" @close="!busy && (dialog = null)">
      <form @submit.prevent="save"><label for="space-name">空间名称</label><input id="space-name" v-model="name" autofocus class="field space-name" maxlength="100" :disabled="busy" data-testid="space-name" placeholder="例如：计算机网络" /><p v-if="error" class="space-error" role="alert">{{ error }}</p><footer class="dialog-actions"><button type="button" class="button" :disabled="busy" @click="dialog = null">取消</button><button type="submit" class="button button-primary" :disabled="busy || !name.trim()" data-testid="space-save">{{ busy ? '正在保存…' : '保存' }}</button></footer></form>
    </ModalShell>
  </section>
</template>
<style scoped>
.space-switcher { display:flex; align-items:center; gap:10px; min-width:0; padding:8px 16px; }
.space-switcher>label { font-weight:600; flex-shrink:0; }
.space-switcher>select { min-width:120px; width:min(320px,35vw); max-width:100%; text-overflow:ellipsis; }
.space-actions { display:flex; gap:8px; flex-shrink:0; }
.space-name { display:block; width:100%; margin:10px 0 20px; }
.space-error { margin:12px 0; color:#8f3c2d; }
</style>
