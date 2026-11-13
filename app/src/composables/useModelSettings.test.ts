import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderer } from 'vue'
import type { App } from 'vue'
import type { AiSettings } from '../domain/ai'
import { useModelSettings } from './useModelSettings'

const mounted: App[] = []
const initial: AiSettings = {
  activeProvider: 'deepseek',
  connections: [
    { provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', configured: true, keyHint: '••••test' },
    { provider: 'openai', model: 'org/model:v1', baseUrl: 'https://gateway.example/v1', configured: false, keyHint: '' },
    { provider: 'anthropic', model: 'messages-model', baseUrl: 'https://api.anthropic.com/v1', configured: false, keyHint: '' },
  ],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function boundary(handler?: (command: string, args: Record<string, unknown>) => Promise<unknown>) {
  const requests: { command: string; args: Record<string, unknown> }[] = []
  vi.stubGlobal('window', { __TAURI__: { core: { invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'ai_settings') return Promise.resolve(structuredClone(initial))
    requests.push({ command, args })
    return handler?.(command, args) ?? Promise.resolve('连接可用。')
  } } } })
  return requests
}

async function mountSettings() {
  const renderer = createRenderer<object, object>({
    patchProp() {}, insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null,
  })
  const onSaved = vi.fn()
  let state!: ReturnType<typeof useModelSettings>
  const app = renderer.createApp({ setup() { state = useModelSettings(onSaved); return () => null } })
  app.mount({}); mounted.push(app)
  await state.load()
  return { state, app, onSaved }
}

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  vi.unstubAllGlobals()
})

describe('model connection form state', () => {
  it('checks the edited connection without saving and ignores success after an edit', async () => {
    const pending = deferred<string>()
    const requests = boundary(() => pending.promise)
    const { state } = await mountSettings()
    state.selected.value = 'openai'
    state.current.value!.baseUrl = 'https://other.example/v1'
    state.current.value!.model = 'org/model:new'
    state.current.value!.key = 'dedicated-test-key'
    const checking = state.check()
    expect(requests).toEqual([{ command: 'ai_check', args: { input: { provider: 'openai', baseUrl: 'https://other.example/v1', model: 'org/model:new', key: 'dedicated-test-key' } } }])
    state.current.value!.model = 'changed-model'
    expect(state.checkingCurrent.value).toBe(false)
    pending.resolve('旧模型连接成功。')
    await checking
    expect(state.checkFeedback.value).toBe('')
    expect(state.checkError.value).toBe('')
    expect(state.checking.value).toBe(false)
  })

  it.each(['model', 'baseUrl', 'key', 'provider'] as const)('invalidates a successful check when %s changes', async field => {
    boundary()
    const { state } = await mountSettings()
    await state.check()
    expect(state.checkFeedback.value).toBe('连接可用。')
    if (field === 'provider') state.selected.value = 'anthropic'
    else state.current.value![field] += '-changed'
    expect(state.checkFeedback.value).toBe('')
  })

  it('does not show a late check failure against another selected connection', async () => {
    const pending = deferred<string>()
    boundary(() => pending.promise)
    const { state } = await mountSettings()
    const checking = state.check()
    state.selected.value = 'anthropic'
    pending.reject(new Error('上一连接鉴权失败'))
    await checking
    expect(state.checkError.value).toBe('')
    expect(state.savedConnection.value?.provider).toBe('anthropic')
  })

  it('requires a new target key and does not display the original key hint as usable', async () => {
    const requests = boundary()
    const { state } = await mountSettings()
    expect(state.hasSavedKey.value).toBe(true)
    state.current.value!.baseUrl = 'https://new-host.example/v1'
    expect(state.targetChanged.value).toBe(true)
    expect(state.hasSavedKey.value).toBe(false)
    expect(state.canUse.value).toBe(false)
    await state.check()
    expect(requests).toEqual([])
    state.current.value!.key = 'new-target-key'
    expect(state.canUse.value).toBe(true)
    await state.check()
    expect(requests[0]!.args.input).toMatchObject({ baseUrl: 'https://new-host.example/v1', key: 'new-target-key' })
  })

  it('saves and activates one connection while preserving edits in another connection', async () => {
    const updated = structuredClone(initial)
    updated.activeProvider = 'openai'; updated.connections[1]!.configured = true
    const requests = boundary(() => Promise.resolve(updated))
    const { state, onSaved } = await mountSettings()
    state.current.value!.model = 'unsaved-deepseek-model'
    state.selected.value = 'openai'
    state.current.value!.key = 'separate-key'
    await state.save(true)
    expect(requests[0]).toMatchObject({ command: 'ai_configure', args: { input: { provider: 'openai', activate: true, key: 'separate-key' } } })
    expect(state.current.value!.key).toBe('')
    expect(state.settings.value?.activeProvider).toBe('openai')
    expect(state.feedback.value).toBe('配置已保存并启用。')
    expect(onSaved).toHaveBeenCalledWith(updated)
    state.selected.value = 'deepseek'
    expect(state.current.value!.model).toBe('unsaved-deepseek-model')
  })

  it('keeps edited fields and saved configuration after a failed save, and clears the entered key', async () => {
    boundary(() => Promise.reject(new Error('无法写入配置目录，请检查权限。')))
    const { state, onSaved } = await mountSettings()
    state.selected.value = 'anthropic'
    state.current.value!.model = 'edited-model'
    state.current.value!.key = 'temporary-key'
    await state.save(true)
    expect(state.current.value!.model).toBe('edited-model')
    expect(state.current.value!.key).toBe('')
    expect(state.error.value).toBe('无法写入配置目录，请检查权限。')
    expect(state.settings.value?.activeProvider).toBe('deepseek')
    expect(state.feedback.value).toBe('')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('removes only the selected connection key without activating another provider', async () => {
    const updated = structuredClone(initial)
    updated.connections[0]!.configured = false; updated.connections[0]!.keyHint = ''
    const requests = boundary(() => Promise.resolve(updated))
    const { state } = await mountSettings()
    state.current.value!.model = 'unsaved-model-change'
    await state.save(false, true)
    expect(requests[0]!.args.input).toEqual({ provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', key: '', activate: false })
    expect(state.hasSavedKey.value).toBe(false)
    expect(state.current.value!.model).toBe('unsaved-model-change')
  })

  it('clears all entered keys and ignores a check response after leaving the page', async () => {
    const pending = deferred<string>()
    boundary(() => pending.promise)
    const { state, app } = await mountSettings()
    state.current.value!.key = 'first-test-key'
    state.drafts.anthropic!.key = 'second-test-key'
    const checking = state.check()
    app.unmount(); mounted.splice(mounted.indexOf(app), 1)
    expect(Object.values(state.drafts).every(draft => !draft?.key)).toBe(true)
    pending.resolve('不可显示的迟到结果')
    await checking
    expect(state.checkFeedback.value).toBe('')
  })
})
