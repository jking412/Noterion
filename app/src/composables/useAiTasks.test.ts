import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderer } from 'vue'
import type { App } from 'vue'
import type { AiEvent, AiRequest } from '../domain/ai'
import { useAiTasks } from './useAiTasks'

const mounted: App[] = []

function mountTasks() {
  const renderer = createRenderer<object, object>({
    patchProp() {}, insert() {}, remove() {},
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null,
  })
  let tasks!: ReturnType<typeof useAiTasks>
  const app = renderer.createApp({ setup() { tasks = useAiTasks(); return () => null } })
  app.mount({})
  mounted.push(app)
  return tasks
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function nativeBoundary(options: { cancelResponse?: Promise<void>; startResponse?: (id: string) => Promise<string> } = {}) {
  const requests: { channel: { onmessage: (event: AiEvent) => void }; id: string; input: AiRequest }[] = []
  const cancellations: string[] = []
  class Channel<T> { onmessage = (_event: T) => {} }
  vi.stubGlobal('window', { __TAURI__: { core: {
    Channel,
    invoke: (command: string, args: Record<string, unknown>) => {
      if (command === 'ai_cancel') { cancellations.push(String(args.taskId)); return options.cancelResponse ?? Promise.resolve() }
      if (command !== 'ai_start') throw new Error(`Unexpected command: ${command}`)
      const id = `task-${requests.length + 1}`
      requests.push({ channel: args.onEvent as typeof requests[number]['channel'], id, input: args.request as AiRequest })
      return options.startResponse?.(id) ?? Promise.resolve(id)
    },
  } } })
  return { requests, cancellations }
}

const question: AiRequest = { action: 'search', text: '进入容器终端', resourceIds: [], allowSupplement: false }

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  vi.unstubAllGlobals()
})

describe('AI task interaction state', () => {
  it('keeps the submitted learning text and source identity when the caller edits its input', async () => {
    const native = nativeBoundary()
    const tasks = mountTasks()
    const input: AiRequest = { action: 'extract', text: 'Docker 用于运行容器。', resourceIds: ['notes'], allowSupplement: false }
    await tasks.start(input)
    input.text = '修改后的学习笔记'
    input.resourceIds.push('other-notes')
    expect(native.requests[0]!.input).toEqual({ action: 'extract', text: 'Docker 用于运行容器。', resourceIds: ['notes'], allowSupplement: false })
    expect(tasks.request.value).toEqual(native.requests[0]!.input)
  })

  it('keeps the running task service label when another connection is enabled', async () => {
    const native = nativeBoundary()
    const tasks = mountTasks()
    tasks.settings.value = {
      activeProvider: 'deepseek',
      connections: [
        { provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', configured: true, keyHint: '已保存' },
        { provider: 'anthropic', model: 'messages-model', baseUrl: 'https://api.anthropic.com/v1', configured: true, keyHint: '已保存' },
      ],
    }
    await tasks.start(question)
    tasks.settings.value.activeProvider = 'anthropic'
    expect(tasks.serviceLabel.value).toBe('DeepSeek · deepseek-flash')
    const request = native.requests[0]!
    request.channel.onmessage({ taskId: request.id, phase: 'complete', result: { kind: 'search', hits: [], note: '', sources: [] } })
    expect(tasks.serviceLabel.value).toBe('Anthropic 兼容 · messages-model')
  })

  it.each(['extract', 'search', 'answer'] as const)('keeps one waiting state for %s while internal events arrive', async action => {
    const native = nativeBoundary()
    const tasks = mountTasks()
    await tasks.start({ ...question, action })
    const waiting = tasks.phaseLabel.value
    native.requests[0]!.channel.onmessage({ taskId: native.requests[0]!.id, phase: 'receiving', detail: '模型接收 320 字', delta: '{"internal":"handle"}' })
    expect(tasks.busy.value).toBe(true)
    expect(tasks.phaseLabel.value).toBe(waiting)
    expect(tasks.result.value).toBeNull()
    expect(tasks.error.value).toBe('')
    native.requests[0]!.channel.onmessage({ taskId: native.requests[0]!.id, phase: 'validating', detail: '内部关系校验' })
    expect(tasks.phaseLabel.value).toBe(waiting)
  })

  it('keeps a newer completed result when cancellation of the previous task fails late', async () => {
    const cancelled = deferred<void>()
    const native = nativeBoundary({ cancelResponse: cancelled.promise })
    const tasks = mountTasks()
    await tasks.start(question)
    const cancellation = tasks.cancel()
    await tasks.start({ ...question, text: '容器中的工作目录' })
    const result = { kind: 'search' as const, hits: [], note: '没有匹配的知识', sources: [] }
    native.requests[1]!.channel.onmessage({ taskId: native.requests[1]!.id, phase: 'complete', result })
    cancelled.reject(new Error('上一任务的取消通道已关闭'))
    await cancellation
    expect(tasks.error.value).toBe('')
    expect(tasks.phase.value).toBe('completed')
    expect(tasks.result.value).toEqual(result)
    expect(tasks.busy.value).toBe(false)
  })

  it('ignores results and failures from a cancelled task after a new request starts', async () => {
    const native = nativeBoundary()
    const tasks = mountTasks()
    await tasks.start(question)
    await tasks.cancel()
    await tasks.start({ ...question, text: '新问题' })
    const old = native.requests[0]!
    old.channel.onmessage({ taskId: old.id, phase: 'complete', result: { kind: 'search', hits: [], sources: [], note: '旧结果' } })
    old.channel.onmessage({ taskId: old.id, phase: 'failed', error: '旧错误' })
    expect(tasks.result.value).toBeNull()
    expect(tasks.error.value).toBe('')
    expect(tasks.busy.value).toBe(true)
    expect(tasks.request.value?.text).toBe('新问题')
  })

  it('cancels the actual native task when the start response arrives after the user cancels', async () => {
    const started = deferred<string>()
    const native = nativeBoundary({ startResponse: () => started.promise })
    const tasks = mountTasks()
    const opening = tasks.start(question)
    await tasks.cancel()
    started.resolve('native-task-late')
    await opening
    expect(native.cancellations).toEqual(['native-task-late'])
    expect(tasks.busy.value).toBe(false)
    expect(tasks.phaseLabel.value).toBe('已取消')
    expect(tasks.result.value).toBeNull()
  })

  it('discards a previous context draft and ignores its late extraction events after reset', async () => {
    const native = nativeBoundary()
    const tasks = mountTasks()
    await tasks.start({ ...question, action: 'extract', text: '原目录的笔记' })
    const previous = native.requests[0]!
    const oldDraft: AiEvent = { taskId: previous.id, phase: 'complete', result: { kind: 'extract', draft: { id: 'old-draft', points: [], sourceName: '原目录的笔记', sourceResourceIds: [], warnings: [] } } }
    previous.channel.onmessage(oldDraft)
    expect(tasks.result.value?.kind).toBe('extract')
    tasks.reset()
    expect(tasks.request.value).toBeNull()
    expect(tasks.result.value).toBeNull()
    await tasks.start({ ...question, action: 'extract', text: '新目录的笔记' })
    previous.channel.onmessage(oldDraft)
    previous.channel.onmessage({ taskId: previous.id, phase: 'failed', error: '旧目录错误' })
    expect(tasks.busy.value).toBe(true)
    expect(tasks.result.value).toBeNull()
    expect(tasks.error.value).toBe('')
    const current = native.requests[1]!
    current.channel.onmessage({ ...oldDraft, taskId: current.id, result: { kind: 'extract', draft: { id: 'new-draft', points: [], sourceName: '新目录的笔记', sourceResourceIds: [], warnings: [] } } })
    expect(tasks.result.value?.kind === 'extract' && tasks.result.value.draft.id).toBe('new-draft')
  })

  it('reports a native cancellation failure without claiming cancellation succeeded', async () => {
    const cancelled = deferred<void>()
    nativeBoundary({ cancelResponse: cancelled.promise })
    const tasks = mountTasks()
    await tasks.start(question)
    const cancellation = tasks.cancel()
    cancelled.reject(new Error('无法取消，请重新打开 Noterion'))
    await cancellation
    expect(tasks.error.value).toBe('无法取消，请重新打开 Noterion')
    expect(tasks.phaseLabel.value).toBe('未完成')
    expect(tasks.busy.value).toBe(false)
  })

  it('keeps a failed question available for retry and clears the error when the new request completes', async () => {
    const native = nativeBoundary()
    const tasks = mountTasks()
    await tasks.start(question)
    const first = native.requests[0]!
    first.channel.onmessage({ taskId: first.id, phase: 'failed', error: '请求受限，请稍后重试' })
    expect(tasks.busy.value).toBe(false)
    expect(tasks.request.value?.text).toBe(question.text)
    tasks.retry()
    await Promise.resolve()
    expect(tasks.error.value).toBe('')
    expect(tasks.busy.value).toBe(true)
    const second = native.requests[1]!
    const result = { kind: 'search' as const, hits: [], sources: [], note: '重试结果' }
    second.channel.onmessage({ taskId: second.id, phase: 'complete', result })
    expect(tasks.result.value).toEqual(result)
    expect(tasks.busy.value).toBe(false)
  })
})
