import { describe, expect, it } from 'vitest'
import { colorPalette, isPointColor } from './colors'
import { completePositions } from '../graph/layout'
import type { KnowledgePoint } from './types'

describe('用户节点颜色', () => {
  it('keeps existing preset colors compatible and accepts full RGB hex colors', () => {
    for (const color of ['docker', 'linux', 'mysql', 'concurrency', 'neutral', '#000000', '#FFFFFF', '#cf4267']) {
      expect(isPointColor(color)).toBe(true)
    }
    for (const color of ['', '#abc', '#1234567', 'red', 'url(https://example.org)', '#zzzzzz']) {
      expect(isPointColor(color)).toBe(false)
    }
    expect(colorPalette('#CF4267').stroke).toBe('#cf4267')
  })

  it('lays out a custom-colored independent node without moving saved nodes', () => {
    const point: KnowledgePoint = { id: 'custom', name: '自定义颜色', description: '', topicIds: [], resourceIds: [], isTheme: false, color: '#cf4267' }
    const placed = completePositions([point], {})
    expect(Number.isFinite(placed.custom?.x)).toBe(true)
    expect(Number.isFinite(placed.custom?.y)).toBe(true)
    expect(completePositions([point], placed)).toEqual(placed)
  })
})
