import type {
  DeleteImpact,
  DemoData,
  DescriptionSections,
  KnowledgePoint,
  MatchMode,
} from './types'

/** Search the knowledge record itself, never its attached resource files. */
export function searchPoints(
  points: KnowledgePoint[],
  terms: string[],
  mode: MatchMode,
): KnowledgePoint[] {
  const needles = [...new Set(terms.map((term) => term.trim().toLowerCase()).filter(Boolean))]
  if (needles.length === 0) return []

  return points.filter((point) => {
    const content = `${point.name}\n${point.description}`.toLowerCase()
    return mode === 'all'
      ? needles.every((needle) => content.includes(needle))
      : needles.some((needle) => content.includes(needle))
  })
}

/** Derive the visible topic chain from relationships, with each ancestor shown once. */
export function getTopicTags(point: KnowledgePoint, points: KnowledgePoint[]): KnowledgePoint[] {
  const byId = new Map(points.map((item) => [item.id, item]))
  const visited = new Set<string>([point.id])
  const tags: KnowledgePoint[] = []

  function visit(id: string) {
    if (visited.has(id)) return
    visited.add(id)
    const topic = byId.get(id)
    if (!topic || !topic.isTheme) return
    topic.topicIds.forEach(visit)
    tags.push(topic)
  }

  point.topicIds.forEach(visit)
  return tags
}

function withoutOuterFence(value: string): string {
  const lines = value.trim().split('\n')
  const opening = lines[0]?.match(/^(`{3,}|~{3,})[^`~]*$/)?.[1]
  if (opening && lines.length >= 2 && lines.at(-1)?.trim() === opening) {
    return lines.slice(1, -1).join('\n').trim()
  }
  return value.trim()
}

/** One Markdown source remains the truth; these sections are a display projection. */
export function parseDescription(raw: string): DescriptionSections {
  const sections: Record<keyof DescriptionSections, string[]> = {
    description: [],
    command: [],
    understanding: [],
  }
  const headingKeys: Record<string, keyof DescriptionSections> = {
    描述: 'description',
    命令: 'command',
    个人理解: 'understanding',
  }
  let current: keyof DescriptionSections = 'description'
  let fence: string | null = null

  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const fenceMatch = line.trim().match(/^(`{3,}|~{3,})/)
    if (fenceMatch) {
      const delimiter = fenceMatch[1]!
      if (fence === null) fence = delimiter
      else if (line.trim() === fence) fence = null
      sections[current].push(line)
      continue
    }

    const heading = fence === null ? line.match(/^##\s+(描述|命令|个人理解)\s*$/) : null
    if (heading) current = headingKeys[heading[1]!]!
    else sections[current].push(line)
  }

  return {
    description: sections.description.join('\n').trim(),
    command: withoutOuterFence(sections.command.join('\n')),
    understanding: sections.understanding.join('\n').trim(),
  }
}

export function composeDescription(sections: DescriptionSections): string {
  const command = sections.command.trim()
  // A longer fence preserves a command that itself contains Markdown backticks.
  const fence = command.includes('```') ? '````' : '```'
  const commandBlock = command ? `${fence}\n${command}\n${fence}` : ''
  return [
    `## 描述\n${sections.description.trim()}`,
    `## 命令\n${commandBlock}`,
    `## 个人理解\n${sections.understanding.trim()}`,
  ].join('\n\n')
}

/** Compute only this deletion's affected descendant subgraph, never a global orphan sweep. */
export function getDeleteImpact(points: KnowledgePoint[], targetId: string): DeleteImpact {
  if (!points.some((point) => point.id === targetId)) {
    return { deletedIds: [], retainedIds: [] }
  }

  const children = new Map<string, string[]>()
  for (const point of points) {
    for (const topicId of point.topicIds) {
      const list = children.get(topicId) ?? []
      list.push(point.id)
      children.set(topicId, list)
    }
  }

  const affected = new Set<string>([targetId])
  const queue = [targetId]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const child of children.get(queue[cursor]!) ?? []) {
      if (!affected.has(child)) {
        affected.add(child)
        queue.push(child)
      }
    }
  }

  const deleted = new Set<string>([targetId])
  let changed = true
  while (changed) {
    changed = false
    for (const point of points) {
      if (
        affected.has(point.id) &&
        !deleted.has(point.id) &&
        point.topicIds.length > 0 &&
        point.topicIds.every((topicId) => deleted.has(topicId))
      ) {
        deleted.add(point.id)
        changed = true
      }
    }
  }

  return {
    deletedIds: points.filter((point) => deleted.has(point.id)).map((point) => point.id),
    retainedIds: points
      .filter((point) => affected.has(point.id) && !deleted.has(point.id))
      .map((point) => point.id),
  }
}

export function cloneData(data: DemoData): DemoData {
  return {
    points: data.points.map((point) => ({
      ...point,
      topicIds: [...point.topicIds],
      resourceIds: [...point.resourceIds],
    })),
    resources: data.resources.map((resource) => ({ ...resource })),
    positions: Object.fromEntries(
      Object.entries(data.positions).map(([id, position]) => [id, { ...position }]),
    ),
  }
}

export function applyDelete(data: DemoData, targetId: string): DemoData {
  const deleted = new Set(getDeleteImpact(data.points, targetId).deletedIds)
  const result = cloneData(data)
  result.points = result.points
    .filter((point) => !deleted.has(point.id))
    .map((point) => ({
      ...point,
      topicIds: point.topicIds.filter((id) => !deleted.has(id)),
    }))
  for (const id of deleted) delete result.positions[id]
  // Resource records and their bundled files deliberately survive every node deletion.
  return result
}

export function validatePoint(candidate: KnowledgePoint, points: KnowledgePoint[]): string | null {
  if (!candidate.name.trim()) return '知识点名称不能为空。'
  if (!candidate.id.trim()) return '知识点标识不能为空。'
  if (candidate.topicIds.includes(candidate.id)) return '知识点不能属于自己。'

  const byId = new Map(points.map((point) => [point.id, point]))
  byId.set(candidate.id, candidate)
  for (const topicId of candidate.topicIds) {
    const topic = byId.get(topicId)
    if (!topic || !topic.isTheme) return '请选择有效的所属主题。'
  }

  function reachesCandidate(startId: string): boolean {
    const seen = new Set<string>()
    const queue = [startId]
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const id = queue[cursor]!
      if (id === candidate.id) return true
      if (seen.has(id)) continue
      seen.add(id)
      queue.push(...(byId.get(id)?.topicIds ?? []))
    }
    return false
  }

  if (candidate.topicIds.some(reachesCandidate)) return '这组所属主题会形成循环，请重新选择。'
  if (!candidate.isTheme && points.some((point) => point.topicIds.includes(candidate.id))) {
    return '这个知识点仍被其他知识点作为主题使用。'
  }
  return null
}
