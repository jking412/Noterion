import type { ResourceItem } from './types'

export const MAX_RESOURCE_BYTES = 20 * 1024 * 1024
export const MAX_RESOURCE_FILES = 50

export function resourceKind(filename: string): ResourceItem['kind'] {
  const extension = filename.split('.').at(-1)?.toLowerCase() ?? ''
  if (['txt', 'log'].includes(extension)) return 'text'
  if (['md', 'markdown'].includes(extension)) return 'markdown'
  if (['html', 'htm'].includes(extension)) return 'html'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'].includes(extension)) return 'image'
  if (extension === 'pdf') return 'pdf'
  return 'file'
}

export function resourceLabel(kind: ResourceItem['kind']): string {
  return { text: '文本', markdown: 'Markdown', html: 'HTML', link: '链接', image: '图片', pdf: 'PDF', file: '文件' }[kind]
}

export function validResourceUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function suggestedResourceId(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50)
  return `material-${stem || 'file'}`
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return ''
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Decode text as UTF-8 without silently replacing corrupt or legacy encoded bytes. */
export function decodeResourceText(bytes: ArrayBuffer): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
}

/** sandbox isolates execution; CSP also stops network requests from uploaded HTML. */
export function isolatedHtml(content: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer">${content}`
}
