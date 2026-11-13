import type { KnowledgePoint, Point, PresetColor } from '../domain/types'
import { isPresetColor } from '../domain/colors'

const anchors: Record<PresetColor, Point> = {
  docker: { x: 280, y: 170 },
  linux: { x: 850, y: 180 },
  mysql: { x: 280, y: 470 },
  concurrency: { x: 870, y: 470 },
  neutral: { x: 580, y: 340 },
}

function hash(value: string) {
  let result = 2166136261
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619)
  return result >>> 0
}

interface Bounds { left: number; right: number; top: number; bottom: number }

/** Mirror GraphCanvas's world-space label placement, including the node's focus ring. */
function visualBounds(point: KnowledgePoint, at: Point): Bounds {
  const radius = point.isTheme ? 22 : 11.5
  // Reserve some extra text width for the minimum-screen-size labels when fitting the map.
  const fontSize = 16 * 1.2
  const width = Array.from(point.name).reduce((sum, char) => sum + (/[^\u0000-\u007f]/.test(char) ? 16.5 : 8.8), 0) * 1.2
  let labelLeft = at.x + radius + 10
  let baseline = at.y + 5.5
  if (['docker', 'mysql', 'concurrency'].includes(point.id)) labelLeft = at.x - radius - 12 - width
  if (point.id === 'linux') { labelLeft = at.x - width / 2; baseline = at.y + radius + 25 }
  return {
    left: Math.min(at.x - radius - 12, labelLeft - 8),
    right: Math.max(at.x + radius + 12, labelLeft + width + 8),
    top: Math.min(at.y - radius - 12, baseline - fontSize * .98 - 3),
    bottom: Math.max(at.y + radius + 12, baseline + fontSize * .4 + 3),
  }
}

function overlaps(first: Bounds, second: Bounds) {
  const gap = 14
  return first.left < second.right + gap && first.right + gap > second.left
    && first.top < second.bottom + gap && first.bottom + gap > second.top
}

/** Add only missing positions. Saved nodes and canonical knowledge objects never enter a simulation. */
export function completePositions(
  points: KnowledgePoint[],
  existing: Record<string, Point>,
): Record<string, Point> {
  const result: Record<string, Point> = {}
  const occupied: Bounds[] = []
  const pointIds = new Set(points.map((point) => point.id))
  const missing: KnowledgePoint[] = []
  for (const point of points) {
    const saved = existing[point.id]
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      result[point.id] = { ...saved }
      occupied.push(visualBounds(point, saved))
    } else missing.push(point)
  }
  // Stable ordering also lets a file list a child before its new parent theme.
  missing.sort((a, b) => Number(b.isTheme) - Number(a.isTheme) || a.id.localeCompare(b.id, 'en'))
  while (missing.length) {
    const ready = missing.findIndex((point) => point.topicIds.every((id) => !pointIds.has(id) || result[id]))
    const [point] = missing.splice(ready === -1 ? 0 : ready, 1)
    if (!point) break
    const parents = point.topicIds.map((id) => result[id]).filter((at): at is Point => Boolean(at))
    const anchor = parents.length ? {
      x: parents.reduce((sum, at) => sum + at.x, 0) / parents.length,
      y: parents.reduce((sum, at) => sum + at.y, 0) / parents.length,
    } : anchors[isPresetColor(point.color) ? point.color : 'neutral']
    const phase = (hash(point.id) % 360) * Math.PI / 180
    let placed: Point | null = null
    // Search the closest free ring first. Rectangles reserve both circles and complete labels;
    // a radius-only force allows a new label to run through an otherwise well-spaced old node.
    for (let ring = 0; !placed; ring++) {
      const distance = 72 + ring * 24
      for (let step = 0; step < 64; step++) {
        const angle = phase + step * Math.PI / 32
        const at = { x: anchor.x + Math.cos(angle) * distance, y: anchor.y + Math.sin(angle) * distance }
        const bounds = visualBounds(point, at)
        if (!occupied.some((other) => overlaps(bounds, other))) { placed = at; occupied.push(bounds); break }
      }
    }
    result[point.id] = placed
  }
  return result
}

