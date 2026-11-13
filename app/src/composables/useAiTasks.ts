import { computed, onBeforeUnmount, ref } from 'vue'
import type { AiEvent, AiRequest, AiResult, AiSettings } from '../domain/ai'
import { channel, errorText, invoke } from '../desktop'

export function useAiTasks() {
  const settings = ref<AiSettings | null>(null)
  const busy = ref(false)
  const error = ref('')
  const phase = ref('')
  const detail = ref('')
  const partial = ref('')
  const result = ref<AiResult | null>(null)
  const taskId = ref('')
  const sessionId = ref('')
  const request = ref<AiRequest | null>(null)
  let generation = 0
  const phaseLabel = computed(() => busy.value
    ? { extract: '正在整理知识', search: '正在查找知识', answer: '正在生成回答' }[request.value?.action || 'search']
    : { completed: '已完成', complete: '已完成', cancelled: '已取消', failed: '未完成' }[phase.value] || '')
  async function refreshSettings() { try { settings.value = await invoke<AiSettings>('ai_settings') } catch (e) { error.value = errorText(e) } }
  async function start(value: AiRequest) {
    if (busy.value) return
    const epoch = ++generation
    busy.value = true; error.value = ''; partial.value = ''; result.value = null; phase.value = 'queued'; detail.value = ''; taskId.value = ''; request.value = { ...value, resourceIds: [...value.resourceIds] }
    try {
      const onEvent = channel<AiEvent>((event) => {
        if (generation !== epoch || !busy.value) return
        if (taskId.value && event.taskId !== taskId.value) return
        taskId.value = event.taskId
        phase.value = event.phase
        if (event.error && event.phase !== 'cancelled') { error.value = event.error; busy.value = false; phase.value = 'failed' }
        if (event.result) { result.value = event.result; busy.value = false; phase.value = 'completed'; partial.value = ''; if (event.result.kind === 'answer') sessionId.value = event.result.sessionId }
        if (['cancelled', 'failed', 'completed', 'complete'].includes(event.phase)) busy.value = false
      })
      const id = await invoke<string>('ai_start', { request: value, onEvent })
      if (generation !== epoch) { void invoke('ai_cancel', { taskId: id }).catch(() => {}); return }
      taskId.value = id
    } catch (e) { if (generation === epoch && busy.value) { error.value = errorText(e); busy.value = false; phase.value = 'failed' } }
  }
  async function cancel() {
    if (!busy.value) return
    const id = taskId.value
    const epoch = ++generation
    busy.value = false; phase.value = 'cancelled'; detail.value = ''; partial.value = ''
    if (id) { try { await invoke('ai_cancel', { taskId: id }) } catch (e) { if (generation === epoch) { error.value = errorText(e); phase.value = 'failed' } } }
  }
  function reset() { void cancel(); generation++; result.value = null; error.value = ''; phase.value = ''; partial.value = ''; sessionId.value = ''; request.value = null }
  function retry() { if (request.value) void start(request.value) }
  onBeforeUnmount(() => { void cancel(); generation++ })
  return { settings, busy, error, phase, phaseLabel, detail, partial, result, taskId, sessionId, request, refreshSettings, start, cancel, reset, retry }
}
