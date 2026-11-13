export type PresetColor = 'docker' | 'linux' | 'mysql' | 'concurrency' | 'neutral'
export type ThemeColor = PresetColor | `#${string}`

export interface Point {
  x: number
  y: number
}

export interface KnowledgePoint {
  id: string
  name: string
  description: string
  topicIds: string[]
  resourceIds: string[]
  isTheme: boolean
  color: ThemeColor
}

export interface ResourceItem {
  id: string
  title: string
  kind: 'text' | 'markdown' | 'html' | 'link' | 'image' | 'pdf' | 'video' | 'file'
  status?: 'ready' | 'missing'
  content?: string
  url?: string
  filename?: string
  mime?: string
  size?: number
  blobUrl?: string
}

export interface DemoData {
  points: KnowledgePoint[]
  resources: ResourceItem[]
  positions: Record<string, Point>
}

export interface DescriptionSections {
  description: string
  command: string
  understanding: string
}

export interface DeleteImpact {
  deletedIds: string[]
  retainedIds: string[]
}

export type MatchMode = 'all' | 'any'
