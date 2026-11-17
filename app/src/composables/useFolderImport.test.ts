import { describe, expect, it } from 'vitest'
import { useFolderImport } from './useFolderImport'
import type { FolderGateway, FolderScan } from '../domain/folder'

const inventory: FolderScan = {
  scanId: 'scan-1',
  files: [
    { id: 'one', relativePath: 'first.md', size: 10 },
    { id: 'two', relativePath: 'nested/first.TXT', size: 20 },
    { id: 'three', relativePath: 'broken.md', size: 30, error: '无法读取文件，请检查权限后重试。' },
  ],
  warnings: [],
}

function gateway(overrides: Partial<FolderGateway> = {}): FolderGateway {
  return {
    scan: async () => inventory,
    prepare: async (_scan, id) => ({ text: id === 'one' ? 'Docker 是容器平台。' : 'Linux 是操作系统。', sourceName: id === 'one' ? 'first.md' : 'nested/first.TXT', sourceResourceId: `source-${id}`, snapshot: {} as never }),
    discard: async () => {},
    cancelScan: async () => {},
    ...overrides,
  }
}

describe('folder import task', () => {
  it('keeps each relative path and accounts for saved, skipped and failed files', async () => {
    const folder = useFolderImport(() => ({ spaceId: 'learning', epoch: 1 }), gateway())
    await folder.scan('C:/notes')
    expect(folder.files.value.map(file => file.relativePath)).toEqual(['first.md', 'nested/first.TXT', 'broken.md'])
    const first = await folder.readNext()
    expect(first?.text).toBe('Docker 是容器平台。')
    folder.processing()
    folder.review()
    folder.saved(false)
    await folder.readNext()
    folder.skip()
    expect(folder.counts.value).toMatchObject({ saved: 1, skipped: 1, failed: 1, pending: 0, total: 3, completed: 3 })
  })
  it('can skip a file from the scanned list without reading or losing another result', async () => {
    const folder = useFolderImport(() => ({ spaceId: 'learning', epoch: 1 }), gateway())
    await folder.scan('C:/notes')
    folder.skip('two')
    expect(folder.files.value.find(file => file.id === 'two')?.status).toBe('skipped')
    expect(folder.counts.value).toMatchObject({ pending: 1, skipped: 1, failed: 1, completed: 2 })
  })
  it('preserves saved work and rejects a file that finishes reading after cancellation', async () => {
    let finish!: (value: Awaited<ReturnType<FolderGateway['prepare']>>) => void
    const folder = useFolderImport(() => ({ spaceId: 'learning', epoch: 1 }), gateway({
      prepare: (_scan, id) => id === 'one'
        ? Promise.resolve({ text: 'Docker', sourceName: 'first.md', sourceResourceId: 'source-one', snapshot: {} as never })
        : new Promise(resolve => { finish = resolve }),
    }))
    await folder.scan('C:/notes')
    await folder.readNext(); folder.processing(); folder.review(); folder.saved(false)
    const reading = folder.readNext()
    folder.cancel()
    finish({ text: 'Late result', sourceName: 'nested/first.TXT', sourceResourceId: 'source-two', snapshot: {} as never })
    expect(await reading).toBeNull()
    expect(folder.counts.value).toMatchObject({ saved: 1, cancelled: 1, failed: 1, pending: 0, completed: 3 })
    folder.retry()
    expect(folder.counts.value).toMatchObject({ saved: 1, pending: 2, cancelled: 0, failed: 0 })
  })
  it('does not publish an old scan after leaving and returning to the same space', async () => {
    let finish!: (value: FolderScan) => void
    const discarded: string[] = []
    let epoch = 1
    const folder = useFolderImport(() => ({ spaceId: 'learning', epoch }), gateway({
      scan: () => new Promise(resolve => { finish = resolve }),
      discard: async id => { discarded.push(id) },
    }))
    const scanning = folder.scan('C:/notes')
    epoch = 3
    finish(inventory)
    expect(await scanning).toBe(false)
    expect(folder.files.value).toEqual([])
    expect(discarded).toEqual(['scan-1'])
  })
  it('keeps a failed file available for retry without falsely marking it saved', async () => {
    let attempts = 0
    const folder = useFolderImport(() => ({ spaceId: 'learning', epoch: 1 }), gateway({
      prepare: async () => {
        if (++attempts === 1) throw new Error('文件不是 UTF-8 文本，请转换编码后重试。')
        return { text: '已修正的文本', sourceName: 'first.md', sourceResourceId: 'source-one', snapshot: {} as never }
      },
    }))
    await folder.scan('C:/notes')
    expect(await folder.readNext('one')).toBeNull()
    expect(folder.current.value).toMatchObject({ status: 'failed', error: '文件不是 UTF-8 文本，请转换编码后重试。' })
    expect((await folder.readNext('one'))?.text).toBe('已修正的文本')
    expect(folder.current.value).toMatchObject({ status: 'reading', error: undefined })
    expect(folder.counts.value.saved).toBe(0)
  })
  it('reports a failed reparse of edited source and keeps the file retryable', async () => {
    const folder = useFolderImport(() => ({ spaceId: 'learning', epoch: 1 }), gateway())
    await folder.scan('C:/notes'); await folder.readNext('one'); folder.processing(); folder.review()
    folder.processing(); folder.failed('模型连接失败，请重试。')
    expect(folder.current.value).toMatchObject({ status: 'failed', error: '模型连接失败，请重试。' })
    expect(folder.counts.value).toMatchObject({ review: 0, processing: 0, failed: 2, saved: 0 })
  })
  it('cancels native scanning immediately and allows a new scan before the old one returns', async () => {
    const scans: { id: string; finish: (value: FolderScan) => void }[] = []
    const cancelled: string[] = []
    const folder = useFolderImport(() => ({ spaceId: 'learning', epoch: 1 }), gateway({
      scan: (_path, _context, id) => new Promise(resolve => { scans.push({ id, finish: resolve }) }),
      cancelScan: async id => { cancelled.push(id) },
    }))
    const oldScan = folder.scan('C:/old-notes')
    folder.cancel()
    expect(folder.scanning.value).toBe(false)
    expect(cancelled).toEqual([scans[0]!.id])
    const newScan = folder.scan('C:/new-notes')
    scans[0]!.finish(inventory)
    expect(await oldScan).toBe(false)
    expect(folder.scanning.value).toBe(true)
    scans[1]!.finish({ scanId: 'new-scan', files: [{ id: 'new-file', relativePath: 'new.md', size: 12 }], warnings: [] })
    expect(await newScan).toBe(true)
    expect(folder.files.value.map(file => file.relativePath)).toEqual(['new.md'])
    expect(folder.stopped.value).toBe(false)
  })
})
