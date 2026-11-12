import { describe, expect, it } from 'vitest'
import { createSeedData } from '../data/seed'
import {
  applyDelete,
  cloneData,
  composeDescription,
  getDeleteImpact,
  getTopicTags,
  parseDescription,
  searchPoints,
  validatePoint,
} from './logic'
import type { DemoData, KnowledgePoint } from './types'

const ids = (points: KnowledgePoint[]) => points.map((point) => point.id)

function point(id: string, topicIds: string[] = [], isTheme = false): KnowledgePoint {
  return {
    id,
    name: id,
    description: `说明 ${id}`,
    topicIds,
    resourceIds: [],
    isTheme,
    color: 'neutral',
  }
}

function deletionFixture(): DemoData {
  const points = [
    point('A', [], true),
    point('B', [], true),
    point('exclusive-theme', ['A'], true),
    point('exclusive-leaf', ['exclusive-theme']),
    point('shared-theme', ['A', 'B'], true),
    point('shared-child', ['shared-theme']),
    point('direct-shared', ['A', 'B']),
    point('independent'),
    point('unrelated', ['B']),
  ]
  points[3]!.resourceIds = ['file']
  points[7]!.resourceIds = ['file']
  return {
    points,
    resources: [{ id: 'file', title: '保留资料', kind: 'text', content: '保留文件内容' }],
    positions: Object.fromEntries(points.map((item, index) => [item.id, { x: index * 10, y: 20 }])),
  }
}

describe('固定演示数据', () => {
  it('uses stable unique knowledge/resource identities with valid references', () => {
    const data = createSeedData()
    expect(data.points).toHaveLength(20)
    expect(data.resources).toHaveLength(6)
    expect(new Set(ids(data.points)).size).toBe(data.points.length)
    expect(new Set(data.resources.map((resource) => resource.id)).size).toBe(data.resources.length)
    for (const item of data.points) {
      expect(validatePoint(item, data.points)).toBeNull()
      expect(data.positions[item.id]).toEqual({ x: expect.any(Number), y: expect.any(Number) })
      expect(item.resourceIds.every((id) => data.resources.some((resource) => resource.id === id))).toBe(true)
    }
  })

  it('provides independent fresh data so layout/editing cannot mutate the next reset', () => {
    const first = createSeedData()
    first.points[0]!.name = '修改过的名称'
    first.points[0]!.topicIds.push('linux')
    first.positions.docker!.x = -99
    first.resources[0]!.content = '修改过的资料'
    const reset = createSeedData()
    expect(reset.points[0]!.name).toBe('Docker')
    expect(reset.points[0]!.topicIds).toEqual([])
    expect(reset.positions.docker!.x).toBe(180)
    expect(reset.resources[0]!.content).not.toBe('修改过的资料')
  })
})

describe('名称与同一份 description 搜索', () => {
  it('finds a command that is absent from the knowledge name', () => {
    const { points } = createSeedData()
    const matches = searchPoints(points, ['docker exec'], 'all')
    expect(ids(matches)).toEqual(['docker-shell'])
    expect(matches[0]!.name).not.toContain('docker exec')
    expect(matches[0]!.description).toContain('docker exec')
  })

  it('preserves phrase spaces and matches English without case sensitivity', () => {
    const { points } = createSeedData()
    expect(ids(searchPoints(points, ['  DOCKER EXEC  '], 'all'))).toEqual(['docker-shell'])
  })

  it('requires all terms to match the same record, not different search results', () => {
    const { points } = createSeedData()
    expect(ids(searchPoints(points, ['锁', 'MySQL'], 'all'))).toEqual(['mysql-lock'])
    expect(searchPoints(points, ['MySQL', '临界区'], 'all')).toEqual([])
  })

  it('matches any term in any mode and keeps results unique', () => {
    const { points } = createSeedData()
    expect(ids(searchPoints(points, ['docker exec', '临界区', 'docker exec'], 'any'))).toEqual([
      'docker-shell',
      'concurrency-lock',
    ])
  })

  it('returns the two different meanings of 锁 as separate identities', () => {
    const { points } = createSeedData()
    const matches = searchPoints(points, ['锁'], 'all')
    expect(ids(matches)).toEqual(['mysql-lock', 'concurrency-lock'])
    expect(matches.map((item) => item.name)).toEqual(['锁', '锁'])
    expect(matches.map((item) => getTopicTags(item, points).map((topic) => topic.name))).toEqual([
      ['MySQL'],
      ['并发编程'],
    ])
  })

  it('does not search attached resources, and treats an empty query as no search', () => {
    const { points, resources } = createSeedData()
    expect(resources.some((resource) => resource.content?.includes('BusyBox'))).toBe(true)
    expect(searchPoints(points, ['BusyBox'], 'any')).toEqual([])
    expect(searchPoints(points, [], 'all')).toEqual([])
    expect(searchPoints(points, [' ', '\n'], 'any')).toEqual([])
  })
})

describe('主题归属展示', () => {
  it('derives root-to-leaf tags from the actual nested relationships', () => {
    const { points } = createSeedData()
    const shell = points.find((item) => item.id === 'docker-shell')!
    expect(ids(getTopicTags(shell, points))).toEqual(['docker', 'container-ops'])
  })

  it('uses one shared point and two topic references', () => {
    const { points } = createSeedData()
    const shared = points.find((item) => item.id === 'container-troubleshoot')!
    expect(points.filter((item) => item.id === shared.id)).toHaveLength(1)
    expect(ids(getTopicTags(shared, points))).toEqual(['docker', 'linux'])
  })

  it('deduplicates shared ancestors and never adds the point itself', () => {
    const root = point('root', [], true)
    const left = point('left', ['root'], true)
    const right = point('right', ['root'], true)
    const leaf = point('leaf', ['left', 'right'])
    expect(ids(getTopicTags(leaf, [root, left, right, leaf]))).toEqual(['root', 'left', 'right'])
    expect(getTopicTags(root, [root, left, right, leaf])).toEqual([])
  })
})

describe('description 单一原文的分区投影', () => {
  it('round-trips description, multiline commands and personal understanding', () => {
    const sections = {
      description: '第一段。\n\n第二段。',
      command: 'docker exec -it <容器名> /bin/bash\npwd',
      understanding: '这是我自己的理解。',
    }
    expect(parseDescription(composeDescription(sections))).toEqual(sections)
  })

  it('treats a plain unstructured note as description without losing text', () => {
    expect(parseDescription('一段普通笔记。\n\n## 其他标题\n仍然保留。')).toEqual({
      description: '一段普通笔记。\n\n## 其他标题\n仍然保留。',
      command: '',
      understanding: '',
    })
  })

  it('does not mistake headings inside code for description-section boundaries', () => {
    const command = 'printf "hello"\n## 描述\nprintf "world"'
    expect(parseDescription(composeDescription({ description: '正文', command, understanding: '理解' }))).toEqual({
      description: '正文', command, understanding: '理解',
    })
  })

  it('handles CRLF notes, language fences and a command containing triple backticks', () => {
    expect(parseDescription('## 描述\r\n正文\r\n## 命令\r\n```sql\r\nSELECT 1;\r\n```\r\n## 个人理解\r\n理解').command).toBe('SELECT 1;')
    const command = 'echo "```"\nls'
    expect(parseDescription(composeDescription({ description: '', command, understanding: '' })).command).toBe(command)
  })
})

describe('仅处理本次受影响后代的删除', () => {
  it('recursively removes orphaned descendants but retains shared themes and their children', () => {
    const data = deletionFixture()
    expect(getDeleteImpact(data.points, 'A')).toEqual({
      deletedIds: ['A', 'exclusive-theme', 'exclusive-leaf'],
      retainedIds: ['shared-theme', 'shared-child', 'direct-shared'],
    })
    const after = applyDelete(data, 'A')
    expect(ids(after.points)).toEqual(['B', 'shared-theme', 'shared-child', 'direct-shared', 'independent', 'unrelated'])
    expect(after.points.find((item) => item.id === 'shared-theme')!.topicIds).toEqual(['B'])
    expect(after.points.find((item) => item.id === 'shared-child')!.topicIds).toEqual(['shared-theme'])
    expect(after.points.find((item) => item.id === 'direct-shared')!.topicIds).toEqual(['B'])
  })

  it('does not depend on parents appearing before descendants in the array', () => {
    const data = deletionFixture()
    const impact = getDeleteImpact([...data.points].reverse(), 'A')
    expect(new Set(impact.deletedIds)).toEqual(new Set(['A', 'exclusive-theme', 'exclusive-leaf']))
  })

  it('retains original independent points and every resource record, even when an owner disappears', () => {
    const data = deletionFixture()
    const before = cloneData(data)
    const after = applyDelete(data, 'A')
    expect(after.points.some((item) => item.id === 'independent')).toBe(true)
    expect(after.resources).toEqual(before.resources)
    expect(after.positions.independent).toEqual(before.positions.independent)
    expect(after.positions['exclusive-leaf']).toBeUndefined()
    expect(data).toEqual(before)
  })

  it('deletes an explicitly selected independent point without touching other independent points', () => {
    const data = deletionFixture()
    data.points.push(point('another-independent'))
    const after = applyDelete(data, 'independent')
    expect(after.points.some((item) => item.id === 'independent')).toBe(false)
    expect(after.points.some((item) => item.id === 'another-independent')).toBe(true)
    expect(after.points.some((item) => item.id === 'A')).toBe(true)
    expect(after.resources).toEqual(data.resources)
  })

  it('demonstrates Docker deletion while the Linux-shared troubleshooting record survives', () => {
    const data = createSeedData()
    const after = applyDelete(data, 'docker')
    expect(after.points.some((item) => item.id === 'container-ops')).toBe(false)
    expect(after.points.some((item) => item.id === 'docker-shell')).toBe(false)
    expect(after.points.find((item) => item.id === 'container-troubleshoot')!.topicIds).toEqual(['linux'])
    expect(after.points.some((item) => item.id === 'incident-template')).toBe(true)
    expect(after.resources).toEqual(data.resources)
  })

  it('leaves data intact for an unknown target', () => {
    const data = createSeedData()
    expect(getDeleteImpact(data.points, 'does-not-exist')).toEqual({ deletedIds: [], retainedIds: [] })
    expect(applyDelete(data, 'does-not-exist')).toEqual(data)
  })
})

describe('编辑校验', () => {
  it('rejects a blank name, self-membership and an invalid/non-theme parent', () => {
    const { points } = createSeedData()
    const shell = points.find((item) => item.id === 'docker-shell')!
    expect(validatePoint({ ...shell, name: '  ' }, points)).toContain('名称')
    expect(validatePoint({ ...shell, topicIds: [shell.id] }, points)).toContain('自己')
    expect(validatePoint({ ...shell, topicIds: ['missing'] }, points)).toContain('有效')
    expect(validatePoint({ ...shell, topicIds: ['mysql-lock'] }, points)).toContain('有效')
  })

  it('rejects nested cycles even when another valid parent is also present', () => {
    const root = point('root', [], true)
    const nested = point('nested', ['root'], true)
    const deepest = point('deepest', ['nested'], true)
    const other = point('other', [], true)
    expect(validatePoint({ ...root, topicIds: ['other', 'deepest'] }, [root, nested, deepest, other])).toContain('循环')
  })

  it('permits identical names for distinct identities and permits independent points', () => {
    const { points } = createSeedData()
    const databaseLock = points.find((item) => item.id === 'mysql-lock')!
    expect(validatePoint(databaseLock, points)).toBeNull()
    expect(validatePoint({ ...databaseLock, topicIds: [] }, points)).toBeNull()
  })
})
