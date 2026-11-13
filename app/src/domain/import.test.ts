import { describe, expect, it } from 'vitest'
import type { DemoData, KnowledgePoint } from './types'
import { CSV_HEADER, buildImportPlan, csvTemplate, fingerprintImport, markdownTemplate, parseImport } from './import'

function point(id: string, options: Partial<KnowledgePoint> = {}): KnowledgePoint {
  return { id, name: id, description: '', isTheme: false, topicIds: [], resourceIds: [], color: 'neutral', ...options }
}
function fixture(): DemoData {
  return {
    points: [point('docker', { isTheme: true }), point('linux', { isTheme: true }), point('shared', { name: '排障', description: '原始说明', topicIds: ['docker'], resourceIds: ['guide'] }), point('untouched')],
    resources: [{ id: 'guide', title: '速查', kind: 'text', content: 'original' }, { id: 'manual', title: '手册', kind: 'link', url: 'https://example.com/' }],
    positions: { shared: { x: 12, y: 34 } },
  }
}
function md(body: string, defaults = '') { return `import_id: batch-a\ndefault_resource_ids: ${defaults}\n\n# 学习资料\n\n${body}` }

describe('Markdown 固定模板读取', () => {
  it('reads the provided template and allows empty descriptions, topics and resources', () => {
    const draft = parseImport(markdownTemplate, 'markdown')
    expect(draft.issues).toEqual([])
    expect(buildImportPlan(draft, fixture()).data?.points).toHaveLength(6)
    const empty = parseImport(md('## 独立点 {#a}\n\n'), 'markdown')
    expect(empty.rows[0]).toMatchObject({ description: '', isTheme: false, topicIds: [], resourceIds: [] })
    expect(buildImportPlan(empty, fixture()).issues).toEqual([])
  })

  it('preserves one Markdown description, ignores headings in fences and records source line ranges', () => {
    const source = '\uFEFF' + md('## CPU 配额 {#cpu}\nis_theme: false\ntopic_ids: docker;linux;docker\nresource_ids: guide\n\n## 描述\n  保留缩进\n\n```markdown\n## 伪条目 {#fake}\n```\n## 命令\ndocker run --cpus=1.5 nginx\n\n## 主题 {#new-theme}\nis_theme: true\n\n主题说明').replace(/\n/g, '\r\n')
    const draft = parseImport(source, 'markdown')
    expect(draft.issues).toEqual([])
    expect(draft.rows.map((row) => row.id)).toEqual(['cpu', 'new-theme'])
    expect(draft.rows[0]).toMatchObject({ line: 6, endLine: 19, topicIds: ['docker', 'linux'], resourceIds: ['guide'] })
    expect(draft.rows[0]?.description).toBe('## 描述\n  保留缩进\n\n```markdown\n## 伪条目 {#fake}\n```\n## 命令\ndocker run --cpus=1.5 nginx\n')
  })

  it('does not turn headings inside longer or tilde fences into knowledge points', () => {
    const draft = parseImport(md('## A {#a}\n\n````md\n```\n## Fake {#fake}\n````\n~~~md\n## Fake2 {#fake2}\n~~~~\n## B {#b}\n\n'), 'markdown')
    expect(draft.rows.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('reports malformed metadata and unsupported front fields with source locations', () => {
    const draft = parseImport('import_id: a\nunknown: value\n## A {#a}\nis_theme: yes\nresource_ids: guide\nresource_ids: manual\n没有分隔空行', 'markdown')
    expect(draft.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: 2, field: 'source' }),
      expect.objectContaining({ line: 4, field: 'isTheme', rowId: 'a' }),
      expect.objectContaining({ line: 6, field: 'resource_ids', rowId: 'a' }),
      expect.objectContaining({ line: 7, field: 'source', rowId: 'a' }),
    ]))
    expect(buildImportPlan(draft, fixture()).data).toBeNull()
  })

  it('requires an explicit batch and at least one knowledge point', () => {
    expect(parseImport('## A {#a}\n\n', 'markdown').issues).toContainEqual(expect.objectContaining({ field: 'importId' }))
    expect(parseImport('import_id: a\n', 'markdown').issues).toContainEqual(expect.objectContaining({ field: 'source' }))
  })
})

describe('CSV 固定模板读取', () => {
  it('reads provided template with fixed eight columns', () => {
    const draft = parseImport(csvTemplate, 'csv')
    expect(draft.issues).toEqual([])
    expect(draft.rows).toHaveLength(2)
    expect(buildImportPlan(draft, fixture()).data?.points).toHaveLength(6)
  })

  it('handles Chinese, escaped quotes, commas and multiline cells with physical row numbers', () => {
    const source = `${CSV_HEADER}\nbatch,guide,a,"引号 ""与"" 逗号, 名称",false,docker;linux,,"第一行, 值\n第二行 ""命令"""\nbatch,guide,b,第二条,false,,,`
    const draft = parseImport(source, 'csv')
    expect(draft.issues).toEqual([])
    expect(draft.rows[0]).toMatchObject({ id: 'a', name: '引号 "与" 逗号, 名称', description: '第一行, 值\n第二行 "命令"', line: 2, endLine: 3 })
    expect(draft.rows[1]).toMatchObject({ line: 4, description: '' })
    expect(draft.defaultResourceIds).toEqual(['guide'])
  })

  it('rejects incomplete quotes, wrong column count, stray quotes and changing batch metadata', () => {
    expect(parseImport(`${CSV_HEADER}\nbatch,,a,A,false,,,"未结束`, 'csv').issues).toContainEqual(expect.objectContaining({ line: 2, message: 'CSV 双引号未闭合。' }))
    expect(parseImport(`${CSV_HEADER}\nbatch,,a,A,false`, 'csv').issues).toContainEqual(expect.objectContaining({ line: 2, message: 'CSV 此行有 5 列，需要 8 列。' }))
    expect(parseImport(`${CSV_HEADER}\nbatch,,a,A"bad,false,,,`, 'csv').issues).toContainEqual(expect.objectContaining({ line: 2, field: 'source' }))
    expect(parseImport(`${CSV_HEADER}\nbatch,,a,A,false,,,\nother,,b,B,false,,,`, 'csv').issues).toContainEqual(expect.objectContaining({ line: 3, field: 'importId' }))
    expect(parseImport('id,name\na,A', 'csv').issues).toContainEqual(expect.objectContaining({ line: 1, field: 'source' }))
  })
})

describe('批次预览、合并与校验', () => {
  it('preserves omissions, shares explicit identities, keeps same-name different-ID nodes and unions all associations', () => {
    const original = fixture()
    const draft = parseImport(md('## 排障 {#shared}\ntopic_ids: linux\nresource_ids: manual\n\n新描述\n\n## 排障 {#same-name}\ntopic_ids: linux\n\n独立身份', 'guide'), 'markdown')
    draft.rows[0]!.resolution = 'keep'
    const plan = buildImportPlan(draft, original)
    expect(plan.issues).toEqual([])
    expect(plan.data?.points).toHaveLength(5)
    expect(plan.data?.points.find((item) => item.id === 'shared')).toMatchObject({ name: '排障', description: '原始说明', topicIds: ['docker', 'linux'], resourceIds: ['guide', 'manual'] })
    expect(plan.data?.points.find((item) => item.id === 'same-name')).toMatchObject({ name: '排障', topicIds: ['linux'], resourceIds: ['guide'] })
    expect(plan.data?.points.find((item) => item.id === 'untouched')).toEqual(original.points[3])
    expect(plan.data?.resources).toEqual(original.resources)
    expect(plan.data?.positions).toEqual(original.positions)
    expect(original.points[2]?.topicIds).toEqual(['docker'])
    expect(plan.counts).toEqual({ added: 1, updated: 1, existing: 0, topicLinks: 2, resourceLinks: 2 })
  })

  it('requires explicit resolution for name or description changes and supports adopting the single full description', () => {
    const draft = parseImport(md('## 排障新名 {#shared}\n\n新的 Markdown\n## 命令\n`docker ps`'), 'markdown')
    const unresolved = buildImportPlan(draft, fixture())
    expect(unresolved.data).toBeNull()
    expect(unresolved.rows[0]?.status).toBe('conflict')
    draft.rows[0]!.resolution = 'adopt'
    const resolved = buildImportPlan(draft, fixture())
    expect(resolved.data?.points.find((item) => item.id === 'shared')).toMatchObject({ name: '排障新名', description: '新的 Markdown\n## 命令\n`docker ps`', topicIds: ['docker'], resourceIds: ['guide'] })
    expect(resolved.rows[0]?.status).toBe('updated')
  })

  it('reports unchanged explicit IDs as existing rather than added', () => {
    const draft = parseImport(md('## 排障 {#shared}\n\n原始说明'), 'markdown')
    const plan = buildImportPlan(draft, fixture())
    expect(plan.issues).toEqual([])
    expect(plan.counts).toEqual({ added: 0, updated: 0, existing: 1, topicLinks: 0, resourceLinks: 0 })
    expect(plan.rows[0]?.status).toBe('existing')
  })

  it('blocks changes to existing theme identity even if content is explicitly adopted', () => {
    const draft = parseImport(md('## docker {#docker}\nis_theme: false\n\n'), 'markdown')
    draft.rows[0]!.resolution = 'adopt'
    const plan = buildImportPlan(draft, fixture())
    expect(plan.data).toBeNull()
    expect(plan.issues).toContainEqual(expect.objectContaining({ rowId: 'docker', field: 'isTheme' }))
  })

  it('validates cross-row themes regardless of input order and includes all defaults on every imported point', () => {
    const draft = parseImport(md('## 先写子项 {#child}\ntopic_ids: new-theme;linux\n\n\n## 后写主题 {#new-theme}\nis_theme: true\ntopic_ids: docker\n\n', 'manual;guide'), 'markdown')
    const plan = buildImportPlan(draft, fixture())
    expect(plan.issues).toEqual([])
    for (const id of ['child', 'new-theme']) expect(plan.data?.points.find((item) => item.id === id)?.resourceIds).toEqual(['manual', 'guide'])
  })

  it('blocks unknown themes and resources, self links, non-theme references, missing names and duplicate IDs atomically', () => {
    const original = fixture()
    const before = JSON.stringify(original)
    const draft = parseImport(md('##  {#a}\ntopic_ids: missing;shared;a\nresource_ids: missing-resource\n\n\n## Duplicate {#a}\n\n', 'unknown-default'), 'markdown')
    const plan = buildImportPlan(draft, original)
    expect(plan.data).toBeNull()
    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'name' }), expect.objectContaining({ field: 'id' }), expect.objectContaining({ field: 'resourceIds' }),
    ]))
    expect(JSON.stringify(original)).toBe(before)
    const refs = buildImportPlan(parseImport(md('## A {#a}\ntopic_ids: missing;shared;a\nresource_ids: missing-resource\n\n'), 'markdown'), original)
    expect(refs.issues.filter((issue) => issue.field === 'topicIds')).toHaveLength(3)
    expect(refs.issues.filter((issue) => issue.field === 'resourceIds')).toHaveLength(1)
  })

  it('detects cycles across imported rows and cycles completed through preexisting knowledge points', () => {
    const direct = buildImportPlan(parseImport(md('## A {#a}\nis_theme: true\ntopic_ids: b\n\n\n## B {#b}\nis_theme: true\ntopic_ids: a\n\n'), 'markdown'), fixture())
    expect(direct.data).toBeNull()
    expect(direct.issues.filter((issue) => issue.field === 'topicIds')).toHaveLength(2)
    const original = fixture()
    original.points.push(point('old-child', { isTheme: true, topicIds: ['docker'] }))
    const draft = parseImport(md('## docker {#docker}\nis_theme: true\ntopic_ids: old-child\n\n'), 'markdown')
    expect(buildImportPlan(draft, original).issues).toContainEqual(expect.objectContaining({ rowId: 'docker', field: 'topicIds' }))
  })

  it('allows an explicit reference correction or independent point without silently dropping invalid references', () => {
    const draft = parseImport(md('## A {#a}\ntopic_ids: bad\n\n'), 'markdown')
    expect(buildImportPlan(draft, fixture()).data).toBeNull()
    draft.rows[0]!.topicIds = []
    expect(buildImportPlan(draft, fixture()).data?.points.find((item) => item.id === 'a')?.topicIds).toEqual([])
  })
})

describe('成功输入指纹', () => {
  it('normalizes only the BOM and newlines, while including format and explicit default-source configuration', () => {
    const original = md('## A {#a}\n\n  command  \n')
    expect(fingerprintImport(original, 'markdown', ['manual', 'guide'])).toBe(fingerprintImport('\uFEFF' + original.replace(/\n/g, '\r\n'), 'markdown', ['guide', 'manual', 'guide']))
    expect(fingerprintImport(original, 'markdown')).not.toBe(fingerprintImport(original.trim(), 'markdown'))
    expect(fingerprintImport(original, 'markdown')).not.toBe(fingerprintImport(original, 'markdown', ['guide']))
    expect(fingerprintImport(original, 'markdown')).not.toBe(fingerprintImport(original, 'csv'))
  })
})
