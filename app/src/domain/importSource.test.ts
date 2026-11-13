import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergePreviewDefaults, prepareResourceImport } from './importSource'

afterEach(() => vi.unstubAllGlobals())
describe('从资料发起知识导入', () => {
  it('keeps ordinary documents as an automatic source without claiming extraction', async () => {
    const input = await prepareResourceImport({ id: 'notes', title: '学习资料', kind: 'text', content: '普通正文' })
    expect(input.source).toBe('')
    expect(input.defaultResourceIds).toEqual(['notes'])
    expect(input.preview).toBeUndefined()
  })
  it('loads structured Markdown directly but leaves ordinary Markdown available for reading', async () => {
    const base = { id: 'notes', title: '笔记', kind: 'markdown' as const }
    expect((await prepareResourceImport({ ...base, content: '# 普通笔记\n说明' })).source).toBe('')
    const source = 'import_id: batch\n\n## 知识 {#point}\n\n说明'
    expect(await prepareResourceImport({ ...base, content: source })).toMatchObject({ source, preview: true, format: 'markdown', defaultResourceIds: ['notes'] })
  })
  it('reads uploaded CSV locally and never fetches a web link', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('import_id,default_resource_ids,id,name,is_theme,topic_ids,resource_ids,description\nbatch,,p,知识,false,,,正文'))
    vi.stubGlobal('fetch', fetcher)
    expect(await prepareResourceImport({ id: 'csv', title: '数据', kind: 'file', filename: 'input.csv', blobUrl: 'blob:local' })).toMatchObject({ format: 'csv', preview: true, defaultResourceIds: ['csv'] })
    await prepareResourceImport({ id: 'web', title: '网页', kind: 'link', url: 'https://example.com/data.csv' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('blob:local')
  })
  it('keeps the source and gives a recoverable message for oversized or unreadable structured files', async () => {
    const base = { id: 'csv', title: '数据', kind: 'file' as const, filename: 'input.csv', blobUrl: 'blob:local' }
    expect((await prepareResourceImport({ ...base, size: 6 * 1024 * 1024 })).error).toContain('5 MB')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error()))
    expect(await prepareResourceImport(base)).toMatchObject({ source: '', defaultResourceIds: ['csv'], error: expect.stringContaining('UTF-8') })
  })
  it('preserves selected and deselected defaults on Back, adds new declarations and always retains the originating material', () => {
    expect(mergePreviewDefaults(['chosen'], ['removed'], ['removed'], 'origin')).toEqual(['chosen', 'origin'])
    expect(mergePreviewDefaults(['chosen'], ['old'], ['old', 'new'], 'origin')).toEqual(['chosen', 'new', 'origin'])
  })
})
