import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { AiConnectionInput, AiProvider, AiSettings } from '../domain/ai'
import { errorText, invoke } from '../desktop'

interface ConnectionDraft { model: string; baseUrl: string; key: string }

function normalizedTarget(value: string) {
  try { return new URL(value.trim()).href.replace(/\/+$/, '') }
  catch { return value.trim().replace(/\/+$/, '') }
}

export function useModelSettings(onSaved: (settings: AiSettings) => void) {
  const settings = ref<AiSettings | null>(null)
  const selected = ref<AiProvider>('deepseek')
  const drafts = reactive<Partial<Record<AiProvider, ConnectionDraft>>>({})
  const loading = ref(false)
  const saving = ref<'save' | 'activate' | 'remove' | null>(null)
  const checking = ref(false)
  const error = ref('')
  const feedback = ref('')
  const checkFeedback = ref('')
  const checkError = ref('')
  const revision = ref(0)
  const checkingRevision = ref(-1)
  let disposed = false

  const current = computed(() => drafts[selected.value])
  const savedConnection = computed(() => settings.value?.connections.find(c => c.provider === selected.value))
  const targetChanged = computed(() => !!current.value && !!savedConnection.value && normalizedTarget(current.value.baseUrl) !== normalizedTarget(savedConnection.value.baseUrl))
  const hasSavedKey = computed(() => !!savedConnection.value?.configured && !targetChanged.value)
  const canUse = computed(() => !!current.value?.model.trim() && !!current.value.baseUrl.trim() && (!!current.value.key.trim() || hasSavedKey.value))
  const dirty = computed(() => !!current.value && !!savedConnection.value && (current.value.model !== savedConnection.value.model || current.value.baseUrl !== savedConnection.value.baseUrl || !!current.value.key))
  const checkingCurrent = computed(() => checking.value && checkingRevision.value === revision.value)

  watch(() => [selected.value, current.value?.model, current.value?.baseUrl, current.value?.key], () => {
    revision.value++
    checkFeedback.value = ''; checkError.value = ''; feedback.value = ''; error.value = ''
  }, { flush: 'sync' })

  function apply(value: AiSettings, replace?: AiProvider) {
    settings.value = value
    for (const connection of value.connections) {
      if (!drafts[connection.provider] || replace === connection.provider) {
        drafts[connection.provider] = { model: connection.model, baseUrl: connection.baseUrl, key: '' }
      }
    }
  }

  async function load() {
    loading.value = true; error.value = ''
    try {
      const value = await invoke<AiSettings>('ai_settings')
      if (disposed) return
      apply(value); selected.value = value.activeProvider
    } catch (e) { if (!disposed) error.value = errorText(e) }
    finally { if (!disposed) loading.value = false }
  }

  function input(): AiConnectionInput | undefined {
    const draft = current.value
    if (!draft) return
    return { provider: selected.value, model: draft.model.trim(), baseUrl: draft.baseUrl.trim(), ...(draft.key.trim() ? { key: draft.key.trim() } : {}) }
  }

  async function save(activate = false, remove = false) {
    if (saving.value || loading.value || checking.value) return
    const saved = savedConnection.value
    const value = remove && saved
      ? { provider: saved.provider, model: saved.model, baseUrl: saved.baseUrl }
      : input()
    if (!value) return
    saving.value = remove ? 'remove' : activate ? 'activate' : 'save'
    checkFeedback.value = ''; checkError.value = ''; error.value = ''; feedback.value = ''
    try {
      const response = await invoke<AiSettings>('ai_configure', { input: { ...value, ...(remove ? { key: '' } : {}), activate } })
      if (disposed) return
      apply(response, remove ? undefined : value.provider)
      if (drafts[value.provider]) drafts[value.provider]!.key = ''
      onSaved(response)
      feedback.value = remove ? '已移除这个连接的密钥。' : activate ? '配置已保存并启用。' : '配置已保存。'
    } catch (e) {
      if (drafts[value.provider]) drafts[value.provider]!.key = ''
      if (!disposed) error.value = errorText(e)
    }
    finally {
      // Secrets live only in this form while being entered, never in UI settings.
      if (drafts[value.provider]) drafts[value.provider]!.key = ''
      if (!disposed) saving.value = null
    }
  }

  async function check() {
    if (saving.value || loading.value || checking.value || !canUse.value) return
    const value = input()
    if (!value) return
    const checkedRevision = revision.value
    checkingRevision.value = checkedRevision
    checking.value = true; checkFeedback.value = ''; checkError.value = ''; error.value = ''; feedback.value = ''
    try {
      const message = await invoke<string>('ai_check', { input: value })
      if (!disposed && revision.value === checkedRevision) checkFeedback.value = message
    } catch (e) { if (!disposed && revision.value === checkedRevision) checkError.value = errorText(e) }
    finally { if (!disposed) checking.value = false }
  }

  onBeforeUnmount(() => {
    disposed = true; revision.value++
    for (const draft of Object.values(drafts)) if (draft) draft.key = ''
  })
  return { settings, selected, drafts, current, savedConnection, targetChanged, hasSavedKey, canUse, dirty, loading, saving, checking, checkingCurrent, error, feedback, checkFeedback, checkError, load, save, check }
}
