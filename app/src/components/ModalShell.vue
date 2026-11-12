<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

defineProps<{ title: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = `dialog-title-${Math.random().toString(36).slice(2)}`
let previousFocus: HTMLElement | null = null

function requestClose() {
  emit('close')
}

function onBackdrop(event: MouseEvent) {
  if (event.target !== dialog.value || !dialog.value) return
  const bounds = dialog.value.getBoundingClientRect()
  if (
    event.clientX < bounds.left || event.clientX > bounds.right ||
    event.clientY < bounds.top || event.clientY > bounds.bottom
  ) requestClose()
}

function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !dialog.value) return
  const elements = [...dialog.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getClientRects().length > 0 && !element.closest('[hidden]'))
  const first = elements[0]
  const last = elements.at(-1)
  if (!first || !last) {
    event.preventDefault()
    dialog.value.focus()
  } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value?.showModal()
  await nextTick()
  dialog.value?.querySelector<HTMLElement>('[autofocus]')?.focus()
})

onBeforeUnmount(() => {
  dialog.value?.close()
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <dialog
    ref="dialog"
    class="modal-shell"
    :class="{ 'modal-shell-wide': wide }"
    :aria-labelledby="titleId"
    tabindex="-1"
    @cancel.prevent="requestClose"
    @click="onBackdrop"
    @keydown="trapFocus"
  >
    <header class="modal-header">
      <h2 :id="titleId">{{ title }}</h2>
      <button class="button close-button" type="button" aria-label="关闭弹窗" @click="requestClose">
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
      </button>
    </header>
    <div class="modal-body"><slot /></div>
  </dialog>
</template>

<style scoped>
.modal-shell { box-sizing: border-box; width: min(620px, calc(100vw - 64px)); max-width: none; max-height: min(88dvh, 900px); padding: 0; overflow: hidden; border: 1px solid rgba(255,255,255,.94); border-radius: 16px; background: rgba(249,249,249,.95); color: #202020; box-shadow: 0 28px 90px #0002, inset 0 1px 0 #fff; backdrop-filter: blur(20px); }
.modal-shell[open] { display: flex; flex-direction: column; }
.modal-shell-wide { width: min(960px, calc(100vw - 64px)); }
.modal-shell::backdrop { background: #20202038; backdrop-filter: blur(5px); }
.modal-header { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 24px; border-bottom: 1px solid #d9d9d9; }
.modal-header h2 { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.5; }
.close-button { display: inline-grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; padding: 0; }
.modal-body { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 24px; }
@media (max-width: 700px) { .modal-shell, .modal-shell-wide { width: calc(100vw - 32px); } .modal-header { padding: 16px; } .modal-body { padding: 18px; } }
</style>
