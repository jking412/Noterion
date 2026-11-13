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
  const requests: { channel: { onmessage: (event: AiEvent) => void }; id: string }[] = []
  const cancellations: string[] = []
  class Channel<T> { onmessage = (_event: T) => {} }
  vi.stubGlobal('window', { __TAURI__: { core: {
    Channel,
    invoke: (command: string, args: Record<string, unknown>) => {
      if (command === 'ai_cancel') { cancellations.push(String(args.taskId)); return options.cancelResponse ?? Promise.resolve() }
      if (command !== 'ai_start') throw new Error(`Unexpected command: ${command}`)
      const id = `task-${requests.length + 1}`
      requests.push({ channel: args.onEvent as typeof requests[number]['channel'], id })
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
