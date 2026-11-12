import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSeedData } from '../data/seed'
import { buildImportPlan, parseImport } from '../domain/import'
import type { KnowledgePoint, Point } from '../domain/types'
import { completePositions } from './layout'

// The actual SVG's node/label extents at its 16px world font; layout leaves additional margin.
function bounds(point: KnowledgePoint, at: Point) {
  const radius = point.isTheme ? 22 : 11.5
  const width = Array.from(point.name).reduce((sum, char) => sum + (/[^\u0000-\u007f]/.test(char) ? 16.5 : 8.8), 0)
  let x = at.x + radius + 10, baseline = at.y + 5.5
  if (['docker', 'mysql', 'concurrency'].includes(point.id)) x = at.x - radius - 12 - width
  if (point.id === 'linux') { x = at.x - width / 2; baseline = at.y + radius + 25 }
  return { left: Math.min(at.x - radius - 12, x - 8), right: Math.max(at.x + radius + 12, x + width + 8), top: Math.min(at.y - radius - 12, baseline - 16 * .98 - 3), bottom: Math.max(at.y + radius + 12, baseline + 16 * .4 + 3) }
}
function point(id: string, topicIds: string[] = [], isTheme = false): KnowledgePoint {
  return { id, name: id, description: '', topicIds, isTheme, resourceIds: [], color: 'neutral' }
}

describe('仅补充新知识点的布局', () => {
  it('places every new normal-fixture node and its full label clear of saved nodes and other new labels', () => {
    const seed = createSeedData()
    const source = readFileSync(new URL('../../public/test-data/01-docker-resources.md', import.meta.url), 'utf8')
    const draft = parseImport(source, 'markdown')
    draft.rows.find((row) => row.id === 'container-troubleshoot')!.resolution = 'keep'
    const imported = buildImportPlan(draft, seed).data!
    const before = JSON.stringify(seed)
    const positions = completePositions(imported.points, seed.positions)
    expect(Object.keys(positions)).toHaveLength(25)
    for (const saved of seed.points) expect(positions[saved.id]).toEqual(seed.positions[saved.id])
    const added = imported.points.filter((item) => !seed.positions[item.id])
    expect(added).toHaveLength(5)
    for (const item of added) {
      const first = bounds(item, positions[item.id]!)
      for (const other of imported.points.filter((candidate) => candidate.id !== item.id)) {
        const second = bounds(other, positions[other.id]!)
        const separated = first.right + 12 <= second.left || second.right + 12 <= first.left || first.bottom + 12 <= second.top || second.bottom + 12 <= first.top
        expect(separated, `${item.id} overlaps ${other.id}`).toBe(true)
      }
    }
    expect(JSON.stringify(seed)).toBe(before)
    expect(completePositions(imported.points, seed.positions)).toEqual(positions)
    // Calling again after the graph has retained these coordinates never moves them.
    expect(completePositions(imported.points, positions)).toEqual(positions)
  })

  it('places a new child near its actual parent even when the child appears first, while preserving distant saved coordinates', () => {
    const points = [point('child', ['new-theme']), point('new-theme', ['existing-theme'], true), point('existing-theme', [], true)]
    const saved = { 'existing-theme': { x: 4500, y: -1800 } }
    const before = JSON.stringify(points)
    const positions = completePositions(points, saved)
    expect(positions['existing-theme']).toEqual(saved['existing-theme'])
    expect(Math.hypot(positions['new-theme']!.x - 4500, positions['new-theme']!.y + 1800)).toBeLessThan(240)
    expect(Math.hypot(positions.child!.x - positions['new-theme']!.x, positions.child!.y - positions['new-theme']!.y)).toBeLessThan(240)
    expect(JSON.stringify(points)).toBe(before)
    expect(saved).toEqual({ 'existing-theme': { x: 4500, y: -1800 } })
    expect(completePositions([...points].reverse(), saved)).toEqual(positions)
  })

  it('keeps a dragged position unchanged and replaces only invalid or missing coordinates', () => {
    const points = [point('saved'), point('missing'), point('invalid')]
    const saved = { saved: { x: -150, y: 920 }, invalid: { x: NaN, y: 7 } }
    const result = completePositions(points, saved)
    expect(result.saved).toEqual({ x: -150, y: 920 })
    expect(result.saved).not.toBe(saved.saved)
    expect(Number.isFinite(result.missing!.x)).toBe(true)
    expect(Number.isFinite(result.invalid!.x)).toBe(true)
    expect(Number.isNaN(saved.invalid.x)).toBe(true)
  })
})
