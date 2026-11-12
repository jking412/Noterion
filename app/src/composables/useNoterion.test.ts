import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, type App } from 'vue'
import { createSeedData } from '../data/seed'
import { readFileSync } from 'node:fs'
import { buildImportPlan, parseImport } from '../domain/import'
import type { ImportSubmission } from '../domain/importHistory'
import type { DemoData, ResourceItem } from '../domain/types'
import { useNoterion } from './useNoterion'

// Mount setup and its disposal hooks without requiring a browser or a DOM package.
const renderer = createRenderer<object, object>({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  insert: () => {},
  remove: () => {},
  setText: () => {},
  setElementText: () => {},
  parentNode: () => null,
  nextSibling: () => null,
  patchProp: () => {},
})
const mountedApps: App[] = []

function mountState(createState: () => ReturnType<typeof useNoterion>) {
  let state!: ReturnType<typeof useNoterion>
  const app = renderer.createApp({
    setup() {
      state = createState()
      return () => null
    },
  })
  app.mount({})
  mountedApps.push(app)
  return state
}

// Keep the existing populated regression scenarios explicit while the app itself starts empty.
function mountNoterion(initialData: DemoData = createSeedData()) {
  return mountState(() => useNoterion(initialData))
}

function mountDefaultNoterion() {
  return mountState(() => useNoterion())
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  mountedApps.splice(0).forEach((app) => app.unmount())
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function submission(source: string, defaultResourceIds?: string[]): ImportSubmission {
  const draft = parseImport(source, 'markdown')
  return { source, format: 'markdown', filename: 'test.md', draft, defaultResourceIds: defaultResourceIds ?? draft.defaultResourceIds }
}
function fixtureSubmission(filename: string): ImportSubmission {
  const source = readFileSync(new URL(`../../public/test-data/${filename}`, import.meta.url), 'utf8')
  const format = filename.endsWith('.csv') ? 'csv' : 'markdown'
  const draft = parseImport(source, format)
  return { source, format, filename, draft, defaultResourceIds: draft.defaultResourceIds }
}
const onePointSource = 'import_id: integration-batch\ndefault_resource_ids: docker-doc\n\n## 新的知识 {#integration-point}\ntopic_ids: docker\n\n原始描述'

describe('空白页面的初始内容与清空行为', () => {
  it('starts each default page empty without reading or writing browser storage', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal('localStorage', storage)
    const first = mountDefaultNoterion()
    expect(first.data.value).toEqual({ points: [], resources: [], positions: {} })
    expect(first.importRecords.value).toEqual([])
    expect(first.graphState.value).toBe('ready')

    first.beginCreate()
    first.savePoint({ ...first.editingPoint.value!, id: 'first-page-point', name: '当前页的知识', description: '仅保存在本次页面' })
    expect(first.data.value.points).toHaveLength(1)
    const second = mountDefaultNoterion()
    expect(second.data.value).toEqual({ points: [], resources: [], positions: {} })
    expect(second.importRecords.value).toEqual([])
    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('clears added knowledge, local resources, positions, import history and duplicate fingerprints on reset', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const state = mountDefaultNoterion()
    state.beginCreate()
    state.savePoint({ ...state.editingPoint.value!, id: 'manual-empty', name: '手动添加', description: '从空白页添加' })
    state.addResources([{ id: 'blank-file', title: '本地资料', kind: 'text', content: '资料正文', filename: 'blank.txt', blobUrl: 'blob:blank-file' }], ['manual-empty'])
    const source = [
      'import_id: empty-page-import',
      '',
      '## 第一个主题 {#first-theme}',
      'is_theme: true',
      '',
      '从空白页面导入的主题。',
      '',
      '## 第一个知识点 {#first-child}',
      'topic_ids: first-theme',
      '',
      '关联到同批导入的主题。',
    ].join('\n')
    const imported = state.recordImport(submission(source))
    expect(imported.status).toBe('success')
    expect(imported.counts.added).toBe(2)
    expect(state.data.value.points).toHaveLength(3)
    expect(state.data.value.points.find((point) => point.id === 'manual-empty')?.resourceIds).toEqual(['blank-file'])
    expect(state.isDuplicateImport(source, 'markdown', [])).toBe(true)

    vi.runAllTimers()
    state.movePoint('manual-empty', { x: 10, y: 20 })
    expect(state.data.value.positions['manual-empty']).toEqual({ x: 10, y: 20 })
    state.query.value = '手动'
    state.selectPoint('manual-empty')
    state.beginEdit('manual-empty')
    state.previewResource.value = state.data.value.resources[0]!
    state.simulateUnavailable()
    state.resetDemo()
    vi.runAllTimers()

    expect(state.data.value).toEqual({ points: [], resources: [], positions: {} })
    expect(state.importRecords.value).toEqual([])
    expect(state.selectedId.value).toBeNull()
    expect(state.focusRequest.value).toBeNull()
    expect(state.query.value).toBe('')
    expect(state.editingPoint.value).toBeNull()
    expect(state.previewResource.value).toBeNull()
    expect(state.graphState.value).toBe('ready')
    expect(state.saveState.value).toBe('saved')
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(['blob:blank-file'])
    expect(state.isDuplicateImport(source, 'markdown', [])).toBe(false)
    expect(state.recordImport(submission(source)).status).toBe('success')
    expect(state.data.value.points).toHaveLength(2)
    mountedApps.pop()!.unmount()
    expect(revoke).toHaveBeenCalledTimes(1)
  })
})

describe('结构化导入的页面提交边界', () => {
  it('leaves committed data and records unchanged during preview, draft edits and cancellation', () => {
    const state = mountNoterion()
    const before = JSON.stringify(state.data.value)
    const input = submission(onePointSource)
    expect(buildImportPlan(input.draft, state.data.value).data).not.toBeNull()
    input.draft.rows[0]!.name = '只在草稿中修正'
    input.draft.rows[0]!.topicIds = ['missing']
    expect(buildImportPlan(input.draft, state.data.value).data).toBeNull()
    // Closing the workspace discards this isolated draft without calling the commit function.
    expect(JSON.stringify(state.data.value)).toBe(before)
    expect(state.importRecords.value).toEqual([])
  })

  it('rejects an invalid batch atomically, records its line errors and accepts a corrected retry', () => {
    const state = mountNoterion()
    const before = JSON.stringify(state.data.value)
    const input = fixtureSubmission('errors/04-validation-errors.csv')
    const failed = state.recordImport(input)
    expect(failed.status).toBe('failed')
    expect(failed.counts).toEqual({ added: 0, updated: 0, existing: 0, topicLinks: 0, resourceLinks: 0 })
    expect(failed.pointIds).toEqual([])
    expect(failed.messages.some((message) => message.startsWith('第 '))).toBe(true)
    expect(JSON.stringify(state.data.value)).toBe(before)
    expect(state.graphState.value).toBe('ready')
    const fixed = state.recordImport(fixtureSubmission('errors/04-validation-fixed.csv'))
    expect(fixed.status).toBe('success')
    expect(fixed.counts.added).toBe(6)
    expect(state.data.value.points).toHaveLength(26)
    expect(state.data.value.points.filter((point) => point.isTheme)).toHaveLength(8)
    expect(state.importRecords.value.map((record) => record.status)).toEqual(['success', 'failed'])
  })

  it('commits the real normal fixture once with contribution counts and a detached record snapshot', () => {
    const state = mountNoterion()
    const input = fixtureSubmission('01-docker-resources.md')
    input.draft.rows.find((row) => row.id === 'container-troubleshoot')!.resolution = 'keep'
    const record = state.recordImport(input)
    expect(record.status).toBe('success')
    expect(record.counts).toEqual({ added: 5, updated: 1, existing: 0, topicLinks: 7, resourceLinks: 8 })
    expect(record.pointIds).toHaveLength(6)
    expect(record.createdAt).toBe(new Date().toISOString())
    expect(state.data.value.points).toHaveLength(25)
    expect(state.data.value.points.filter((point) => point.isTheme)).toHaveLength(6)
    expect(state.data.value.resources).toHaveLength(6)
    expect(state.data.value.points.find((point) => point.id === 'cpu-quota')).toMatchObject({ topicIds: ['container-resources', 'linux'], resourceIds: ['terminal-demo', 'docker-doc'] })
    expect(state.data.value.points.find((point) => point.id === 'container-troubleshoot')?.topicIds).toEqual(['docker', 'linux', 'container-resources'])
    input.draft.rows[0]!.name = '提交之后改草稿'
    expect(record.draft.rows[0]!.name).toBe('容器资源限制')
    expect(state.data.value.points.find((point) => point.id === 'container-resources')?.name).toBe('容器资源限制')
    expect(state.graphState.value).toBe('updating')
    vi.runAllTimers()
    expect(state.graphState.value).toBe('ready')
  })

  it('keeps a failed retry as one pending attempt and links the resolved attempt to its successful result', () => {
    const state = mountNoterion()
    const before = JSON.stringify(state.data.value)
    const invalid = submission(onePointSource.replace('topic_ids: docker', 'topic_ids: missing-theme'))
    invalid.sourceResourceId = 'docker-doc'
    const failed = state.recordImport(invalid, true)
    const createdAt = failed.createdAt
    vi.advanceTimersByTime(1000)

    const stillInvalid = state.recordImport(invalid, false, failed.recordId)
    expect(stillInvalid.recordId).toBe(failed.recordId)
    expect(stillInvalid.createdAt).toBe(createdAt)
    expect(stillInvalid.status).toBe('failed')
    expect(state.importRecords.value).toHaveLength(1)
    expect(JSON.stringify(state.data.value)).toBe(before)

    const corrected = submission(onePointSource)
    corrected.sourceResourceId = 'docker-doc'
    const success = state.recordImport(corrected, false, failed.recordId)
    expect(success.status).toBe('success')
    expect(success.counts.added).toBe(1)
    expect(success.sourceResourceId).toBe('docker-doc')
    expect(state.importRecords.value).toHaveLength(2)
    const resolved = state.importRecords.value.find((record) => record.recordId === failed.recordId)!
    expect(resolved).toMatchObject({ status: 'resolved', resolvedByRecordId: success.recordId, sourceResourceId: 'docker-doc', createdAt })
    expect(resolved.messages.some((message) => message.includes('missing-theme'))).toBe(true)
    expect(resolved.counts.added).toBe(0)
    expect(state.importRecords.value.filter((record) => record.status === 'failed')).toEqual([])
  })

  it('resolves only the chosen failed attempt when a retry is already processed', () => {
    const state = mountNoterion()
    const invalid = submission(onePointSource.replace('topic_ids: docker', 'topic_ids: missing-theme'))
    const failed = state.recordImport(invalid, true)
    const unrelated = state.recordImport(submission(onePointSource.replace('integration-point', 'other-point').replace('topic_ids: docker', 'topic_ids: another-missing')), true)
    state.recordImport(submission(onePointSource))
    const before = JSON.stringify(state.data.value)

    const duplicate = state.recordImport(submission(onePointSource), false, failed.recordId)
    expect(duplicate.status).toBe('duplicate')
    expect(duplicate.counts.added).toBe(0)
    expect(JSON.stringify(state.data.value)).toBe(before)
    expect(state.importRecords.value.find((record) => record.recordId === failed.recordId)).toMatchObject({ status: 'resolved', resolvedByRecordId: duplicate.recordId })
    expect(state.importRecords.value.find((record) => record.recordId === unrelated.recordId)?.status).toBe('failed')
  })

  it('does not replay a successful original source over a later manual edit or resurrect a deleted point', () => {
    const state = mountNoterion()
    expect(state.recordImport(submission(onePointSource)).status).toBe('success')
    vi.runAllTimers()
    state.beginEdit('integration-point')
    state.savePoint({ ...state.editingPoint.value!, name: '后来编辑', description: '后来的描述' })
    const edited = JSON.stringify(state.data.value)
    const duplicateAfterEdit = state.recordImport(submission(onePointSource))
    expect(duplicateAfterEdit.status).toBe('duplicate')
    expect(duplicateAfterEdit.counts).toEqual({ added: 0, updated: 0, existing: 1, topicLinks: 0, resourceLinks: 0 })
    expect(JSON.stringify(state.data.value)).toBe(edited)
    vi.runAllTimers()
    state.requestDelete('integration-point')
    state.confirmDelete()
    expect(state.data.value.points).toHaveLength(20)
    const deleted = JSON.stringify(state.data.value)
    expect(state.recordImport(submission(onePointSource)).status).toBe('duplicate')
    expect(JSON.stringify(state.data.value)).toBe(deleted)
    expect(state.data.value.points.some((point) => point.id === 'integration-point')).toBe(false)
  })

  it('treats changed same-batch input as a supplement, preserving omitted points and associations', () => {
    const state = mountNoterion()
    const first = fixtureSubmission('01-docker-resources.md')
    first.draft.rows.find((row) => row.id === 'container-troubleshoot')!.resolution = 'keep'
    state.recordImport(first)
    const second = fixtureSubmission('02-supplement-same-batch.md')
    expect(second.draft.importId).toBe(first.draft.importId)
    second.draft.rows.find((row) => row.id === 'cpu-quota')!.resolution = 'adopt'
    const record = state.recordImport(second)
    expect(record.status).toBe('success')
    expect(record.counts.added).toBe(1)
    expect(record.counts.updated).toBe(1)
    expect(state.data.value.points).toHaveLength(26)
    expect(state.data.value.points.find((point) => point.id === 'cpu-quota')).toMatchObject({ topicIds: ['container-resources', 'linux'], resourceIds: ['terminal-demo', 'docker-doc'] })
    for (const id of ['memory-limit', 'readonly-filesystem', 'container-healthcheck']) expect(state.data.value.points.some((point) => point.id === id)).toBe(true)
    expect(state.recordImport(first).status).toBe('duplicate')
    expect(state.data.value.points).toHaveLength(26)
  })

  it('allows content import and manual creation while graph service is unavailable, with recovery still explicit', () => {
    const state = mountNoterion()
    state.simulateUnavailable()
    expect(state.recordImport(submission(onePointSource)).status).toBe('success')
    expect(state.graphState.value).toBe('unavailable')
    state.beginCreate()
    expect(state.creatingPoint.value).toBe(true)
    state.savePoint({ ...state.editingPoint.value!, id: 'manual-in-outage', name: '故障期间新建', description: '保留内容可用性', topicIds: ['linux'], resourceIds: ['docker-doc'] })
    expect(state.data.value.points).toHaveLength(22)
    expect(state.editingPoint.value).toBeNull()
    vi.runAllTimers()
    expect(state.saveState.value).toBe('saved')
    expect(state.graphState.value).toBe('unavailable')
    state.query.value = '故障期间新建'
    expect(state.results.value.map((point) => point.id)).toEqual(['manual-in-outage'])
    state.selectPoint('manual-in-outage')
    expect(state.focusRequest.value).toBeNull()
    state.restoreGraph()
    expect(state.graphState.value).toBe('updating')
    vi.runAllTimers()
    expect(state.graphState.value).toBe('ready')
    expect(state.focusRequest.value?.id).toBe('manual-in-outage')
  })

  it('includes explicit default-source choices in replay identity and clears fingerprints on reset', () => {
    const state = mountNoterion()
    state.recordImport(submission(onePointSource))
    const changedDefaults = state.recordImport(submission(onePointSource, ['docker-doc', 'linux-checklist']))
    expect(changedDefaults.status).toBe('success')
    expect(changedDefaults.counts).toMatchObject({ added: 0, updated: 1, resourceLinks: 1 })
    expect(state.data.value.points.find((point) => point.id === 'integration-point')?.resourceIds).toEqual(['docker-doc', 'linux-checklist'])
    expect(state.recordImport(submission(onePointSource, ['linux-checklist', 'docker-doc'])).status).toBe('duplicate')
    state.resetDemo()
    expect(state.importRecords.value).toEqual([])
    expect(state.recordImport(submission(onePointSource)).status).toBe('success')
    expect(state.data.value.points).toHaveLength(21)
  })
})

describe('资料共享和文件生命周期', () => {
  function resource(id: string, blobUrl: string): ResourceItem { return { id, title: id, kind: 'text', content: '本地文件', filename: `${id}.txt`, blobUrl } }

  it('keeps a file usable after preview closes and allows the same resource to be associated to multiple points', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const state = mountNoterion()
    state.addResources([resource('shared-file', 'blob:shared')], ['docker', 'linux'])
    expect(state.data.value.resources).toHaveLength(7)
    state.previewResource.value = state.data.value.resources.find((item) => item.id === 'shared-file')!
    state.previewResource.value = null
    expect(revoke).not.toHaveBeenCalled()
    state.previewResource.value = state.data.value.resources.find((item) => item.id === 'shared-file')!
    expect(state.previewResource.value.blobUrl).toBe('blob:shared')
    state.associateResource('shared-file', ['docker', 'linux', 'mysql'])
    expect(state.data.value.resources).toHaveLength(7)
    for (const id of ['docker', 'linux', 'mysql']) expect(state.data.value.points.find((point) => point.id === id)?.resourceIds).toContain('shared-file')
    state.associateResource('shared-file', ['mysql'])
    expect(state.data.value.points.find((point) => point.id === 'docker')?.resourceIds).not.toContain('shared-file')
    expect(state.data.value.resources.find((item) => item.id === 'shared-file')?.blobUrl).toBe('blob:shared')
    expect(revoke).not.toHaveBeenCalled()
  })

  it('revokes each owned URL once on reset or unmount and clears the corresponding resource state', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const state = mountNoterion()
    state.addResources([resource('first', 'blob:first'), resource('second', 'blob:second')], ['docker'])
    state.resetDemo()
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(['blob:first', 'blob:second'])
    expect(state.data.value.resources).toHaveLength(6)
    expect(state.previewResource.value).toBeNull()
    state.addResources([resource('after-reset', 'blob:after-reset')], [])
    mountedApps.pop()!.unmount()
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(['blob:first', 'blob:second', 'blob:after-reset'])
  })

  it('removes one material and its associations while preserving knowledge, history and other materials', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const state = mountNoterion()
    state.addResources([resource('remove-me', 'blob:remove-me')], ['docker', 'linux'])
    state.addResources([resource('keep-me', 'blob:keep-me')], ['mysql'])
    const imported = state.recordImport(submission(onePointSource, ['remove-me']))
    expect(imported.status).toBe('success')
    vi.runAllTimers()
    state.selectPoint('integration-point')
    state.previewResource.value = state.data.value.resources.find((item) => item.id === 'remove-me')!
    const pointsBefore = state.data.value.points.map((point) => ({ ...point, resourceIds: point.resourceIds.filter((id) => id !== 'remove-me') }))
    const positionsBefore = JSON.stringify(state.data.value.positions)
    const historyBefore = JSON.stringify(state.importRecords.value)
    const otherMaterials = state.data.value.resources.filter((item) => item.id !== 'remove-me')

    state.removeResource('remove-me')

    expect(state.data.value.points).toEqual(pointsBefore)
    expect(state.data.value.points).toHaveLength(21)
    expect(JSON.stringify(state.data.value.positions)).toBe(positionsBefore)
    expect(JSON.stringify(state.importRecords.value)).toBe(historyBefore)
    expect(state.data.value.resources).toEqual(otherMaterials)
    expect(state.selectedId.value).toBe('integration-point')
    expect(state.previewResource.value).toBeNull()
    expect(state.graphState.value).toBe('ready')
    expect(state.saveState.value).toBe('saving')
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(['blob:remove-me'])
    state.removeResource('remove-me')
    expect(revoke).toHaveBeenCalledTimes(1)
    state.resetDemo()
    mountedApps.pop()!.unmount()
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(['blob:remove-me', 'blob:keep-me'])
  })

  it('retains a shared file URL until its last material is removed and leaves unrelated previews open', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const state = mountDefaultNoterion()
    state.addResources([resource('first-reference', 'blob:same-file'), resource('second-reference', 'blob:same-file')], [])
    state.previewResource.value = state.data.value.resources[1]!
    state.removeResource('first-reference')
    expect(state.previewResource.value?.id).toBe('second-reference')
    expect(revoke).not.toHaveBeenCalled()
    state.removeResource('second-reference')
    expect(state.previewResource.value).toBeNull()
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(['blob:same-file'])
    state.resetDemo()
    mountedApps.pop()!.unmount()
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('rejects a duplicate-ID resource batch or invalid association atomically and releases its new files', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const state = mountNoterion()
    const before = JSON.stringify(state.data.value)
    state.addResources([resource('new', 'blob:new'), resource('docker-doc', 'blob:duplicate')], ['docker'])
    expect(JSON.stringify(state.data.value)).toBe(before)
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(['blob:new', 'blob:duplicate'])
    state.addResources([resource('same', 'blob:a'), resource('same', 'blob:b')], [])
    expect(JSON.stringify(state.data.value)).toBe(before)
    expect(revoke).toHaveBeenCalledWith('blob:a')
    expect(revoke).toHaveBeenCalledWith('blob:b')
    state.addResources([resource('orphan', 'blob:orphan')], ['missing-point'])
    expect(JSON.stringify(state.data.value)).toBe(before)
    expect(revoke).toHaveBeenCalledWith('blob:orphan')
    state.resetDemo()
    expect(revoke).toHaveBeenCalledTimes(5)
  })
})

describe('正式内容与图状态相互独立的页面内存演示', () => {
  it('keeps an open editor and saves searchable content while the graph remains unavailable', () => {
    const state = mountNoterion()
    state.beginEdit('docker-shell')
    const draft = state.editingPoint.value!
    state.simulateUnavailable()
    expect(state.editingPoint.value).toBe(draft)

    draft.name = '离线修改容器终端'
    draft.description = '图服务不可用时仍可保存的一段描述'
    state.savePoint(draft)
    expect(state.editingPoint.value).toBeNull()
    expect(state.graphState.value).toBe('unavailable')
    expect(state.graphReady.value).toBe(false)
    vi.advanceTimersByTime(400)
    expect(state.saveState.value).toBe('saved')
    expect(state.graphState.value).toBe('unavailable')

    state.query.value = '仍可保存'
    expect(state.results.value.map((point) => point.id)).toEqual(['docker-shell'])
    state.selectPoint('docker-shell')
    expect(state.selectedPoint.value?.name).toBe('离线修改容器终端')
    expect(state.selectedPoint.value?.resourceIds).toContain('terminal-demo')
    expect(state.focusRequest.value).toBeNull()
  })

  it('allows another content save during graph updating and reports saving separately', () => {
    const state = mountNoterion()
    state.graphUpdate(5000)
    state.beginEdit('docker-shell')
    const draft = state.editingPoint.value!
    draft.name = '更新期间保存的知识点'
    state.savePoint(draft)
    expect(state.data.value.points.find((point) => point.id === draft.id)?.name).toBe(draft.name)
    expect(state.graphState.value).toBe('updating')
    vi.advanceTimersByTime(400)
    expect(state.saveState.value).toBe('saved')
    expect(state.graphReady.value).toBe(false)
    vi.runAllTimers()
    expect(state.graphState.value).toBe('ready')
  })

  it('blocks graph deletion and movement until explicit recovery has caught up', () => {
    const state = mountNoterion()
    const before = createSeedData()
    state.requestDelete('docker')
    expect(state.deletingId.value).toBe('docker')
    state.simulateUnavailable()
    expect(state.deletingId.value).toBeNull()
    state.requestDelete('docker')
    state.confirmDelete()
    state.movePoint('docker', { x: -100, y: -100 })
    expect(state.deletingId.value).toBeNull()
    expect(state.data.value).toEqual(before)

    state.graphUpdate(1)
    vi.runAllTimers()
    expect(state.graphState.value).toBe('unavailable')
    state.selectPoint('linux')
    state.restoreGraph()
    expect(state.graphState.value).toBe('updating')
    state.requestDelete('docker')
    state.movePoint('docker', { x: -100, y: -100 })
    expect(state.deletingId.value).toBeNull()
    expect(state.data.value).toEqual(before)
    vi.runAllTimers()
    expect(state.graphReady.value).toBe(true)
    expect(state.focusRequest.value?.id).toBe('linux')

    state.requestDelete('docker')
    state.confirmDelete()
    expect(state.data.value.points).toHaveLength(15)
    expect(state.data.value.points.find((point) => point.id === 'container-troubleshoot')?.topicIds).toEqual(['linux'])
    expect(state.data.value.resources).toEqual(before.resources)
  })

  it('does not let a pending graph timer recover a later outage', () => {
    const state = mountNoterion()
    state.graphUpdate(1000)
    state.simulateUnavailable()
    state.beginEdit('docker-shell')
    state.savePoint({ ...state.editingPoint.value!, name: '故障后保存' })
    vi.runAllTimers()
    expect(state.graphState.value).toBe('unavailable')
    expect(state.data.value.points.find((point) => point.id === 'docker-shell')?.name).toBe('故障后保存')
  })

  it('starts a new page instance from seed without reading or writing browser storage', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal('localStorage', storage)
    const first = mountNoterion()
    first.beginEdit('docker-shell')
    first.savePoint({ ...first.editingPoint.value!, name: '仅在当前页面的名称' })
    vi.runAllTimers()
    first.movePoint('docker', { x: 999, y: 999 })
    const second = mountNoterion()
    expect(second.data.value).toEqual(createSeedData())
    expect(first.data.value.points.find((point) => point.id === 'docker-shell')?.name).toBe('仅在当前页面的名称')
    first.resetDemo()
    expect(first.data.value).toEqual(createSeedData())
    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('resets content, selection and pending state together without a late timer changing them', () => {
    const state = mountNoterion()
    state.selectPoint('docker-shell')
    state.beginEdit('docker-shell')
    state.savePoint({ ...state.editingPoint.value!, name: '待重置的修改' })
    state.query.value = '修改'
    state.resetDemo()
    vi.runAllTimers()
    expect(state.data.value).toEqual(createSeedData())
    expect(state.graphState.value).toBe('ready')
    expect(state.saveState.value).toBe('saved')
    expect(state.selectedId.value).toBeNull()
    expect(state.focusRequest.value).toBeNull()
    expect(state.query.value).toBe('')
    expect(state.editingPoint.value).toBeNull()
  })
})
