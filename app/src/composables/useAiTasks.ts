import { computed, onBeforeUnmount, ref } from 'vue'
import type { AiEvent, AiRequest, AiResult, AiSettings } from '../domain/ai'
import { providerLabels } from '../domain/ai'
import { channel, errorText, invoke } from '../desktop'

export function useAiTasks() {
  const settings = ref<AiSettings | null>(null)
  const busy = ref(false)
  const error = ref('')
  const phase = ref('')
  const result = ref<AiResult | null>(null)
  const taskId = ref('')
  const sessionId = ref('')
  const request = ref<AiRequest | null>(null)
  const activeConnection = computed(() => settings.value?.connections.find(c => c.provider === settings.value?.activeProvider))
  const activeServiceLabel = computed(() => activeConnection.value ? `${providerLabels[activeConnection.value.provider]} · ${activeConnection.value.model}` : '当前启用的模型服务')
  const requestServiceLabel = ref('')
  const serviceLabel = computed(() => busy.value && requestServiceLabel.value ? requestServiceLabel.value : activeServiceLabel.value)
  let generation = 0
  const phaseLabel = computed(() => busy.value
    ? { extract: '正在整理知识', search: '正在查找知识', answer: '正在生成回答' }[request.value?.action || 'search']
    : { completed: '已完成', complete: '已完成', cancelled: '已取消', failed: '未完成' }[phase.value] || '')
  async function refreshSettings() { try { settings.value = await invoke<AiSettings>('ai_settings') } catch (e) { error.value = errorText(e) } }
  async function start(value: AiRequest) {
    if (busy.value) return
    const epoch = ++generation
    requestServiceLabel.value = activeServiceLabel.value
    busy.value = true; error.value = ''; result.value = null; phase.value = 'queued'; taskId.value = ''; request.value = { ...value, resourceIds: [...value.resourceIds] }
    try {
      const onEvent = channel<AiEvent>((event) => {
        if (generation !== epoch || !busy.value) return
        if (taskId.value && event.taskId !== taskId.value) return
        taskId.value = event.taskId
        phase.value = event.phase
        if (event.error && event.phase !== 'cancelled') { error.value = event.error; busy.value = false; phase.value = 'failed' }
        if (event.result) { result.value = event.result; busy.value = false; phase.value = 'completed'; if (event.result.kind === 'answer') sessionId.value = event.result.sessionId }
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
    busy.value = false; phase.value = 'cancelled'
    if (id) { try { await invoke('ai_cancel', { taskId: id }) } catch (e) { if (generation === epoch) { error.value = errorText(e); phase.value = 'failed' } } }
  }
  function reset() { void cancel(); generation++; result.value = null; error.value = ''; phase.value = ''; sessionId.value = ''; request.value = null }
  function retry() { if (request.value) void start(request.value) }
  onBeforeUnmount(() => { void cancel(); generation++ })
  return { settings, activeConnection, serviceLabel, busy, error, phase, phaseLabel, result, taskId, sessionId, request, refreshSettings, start, cancel, reset, retry }
}
