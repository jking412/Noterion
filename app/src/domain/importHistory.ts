import type { ImportDraft, ImportPlan } from './import'

export interface ImportSubmission {
  source: string
  format: 'markdown' | 'csv'
  filename: string
  draft: ImportDraft
  defaultResourceIds: string[]
  sourceResourceId?: string
}
export interface ImportRecord extends ImportSubmission {
  recordId: string
  createdAt: string
  status: 'success' | 'duplicate' | 'failed' | 'resolved'
  resolvedByRecordId?: string
  counts: ImportPlan['counts']
  pointIds: string[]
  messages: string[]
}
