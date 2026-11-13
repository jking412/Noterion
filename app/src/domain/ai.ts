import type { KnowledgePoint } from './types'

export interface AiSettings {
  configured: boolean
  model: string
  baseUrl: string
  keyHint: string
}

export interface AiRequest {
  action: 'extract' | 'search' | 'answer'
  text: string
  sourceName?: string
  resourceIds: string[]
  sessionId?: string
  originalRecordId?: string
  allowSupplement: boolean
}

export interface AiEvidence {
  quote: string
  start: number
  end: number
  inferred: boolean
}

export interface AiCandidate {
  point: KnowledgePoint
  evidence: AiEvidence[]
  matches: string[]
}

export interface AiDraft {
  id: string
  points: AiCandidate[]
  sourceName: string
  sourceResourceIds: string[]
  warnings: string[]
  duplicateRecordId?: string
  originalRecordId?: string
}

export interface AiHit {
  pointId: string
  reason: string
}

export interface AiSource {
  handle: string
  pointId?: string
  resourceId?: string
  title: string
  excerpt: string
  kind: 'point' | 'text' | 'associated'
}

export interface AiAnswerBlock {
  markdown: string
  basis: 'personal' | 'inference' | 'supplement'
  sourceHandles: string[]
}

export type AiResult =
  | { kind: 'extract'; draft: AiDraft }
  | { kind: 'search'; hits: AiHit[]; note: string; sources: AiSource[] }
  | { kind: 'answer'; blocks: AiAnswerBlock[]; sources: AiSource[]; note: string; sessionId: string }

export interface AiEvent {
  taskId: string
  phase: string
  detail?: string
  delta?: string
  result?: AiResult
  error?: string
}

export interface AiChoice {
  candidateId: string
  point: KnowledgePoint
  action: 'create' | 'reuse' | 'update' | 'skip'
  targetId?: string
}

export interface AiAdoptInput {
  draftId: string
  operationId: string
  choices: AiChoice[]
}

export interface AiImportRecord {
  id: string
  sourceName: string
  createdAt: number
  pointIds: string[]
  added: number
  updated: number
  reused: number
  sourceResourceIds: string[]
  previousRecordId?: string
  fingerprint: string
}
