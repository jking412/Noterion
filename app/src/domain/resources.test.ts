import { describe, expect, it } from 'vitest'
import { decodeResourceText, isolatedHtml, resourceKind, suggestedResourceId, validResourceUrl } from './resources'

describe('local learning resources', () => {
  it('recognizes supported preview formats and keeps office documents downloadable', () => {
    expect(resourceKind('演示.PDF')).toBe('pdf')
    expect(resourceKind('图谱.png')).toBe('image')
    expect(resourceKind('notes.md')).toBe('markdown')
    expect(resourceKind('notes.docx')).toBe('file')
    expect(resourceKind('vector.svg')).toBe('file')
  })
  it('accepts HTTP(S) addresses and rejects executable or credential-bearing URLs', () => {
    expect(validResourceUrl(' https://example.com/a ')).toBe('https://example.com/a')
    expect(validResourceUrl('javascript:alert(1)')).toBeNull()
    expect(validResourceUrl('file:///C:/secret')).toBeNull()
    expect(validResourceUrl('https://name:password@example.com')).toBeNull()
  })
  it('decodes Chinese and multiline UTF-8 while reporting invalid byte sequences', () => {
    const bytes = new TextEncoder().encode('\uFEFF资料\n第二行').buffer
    expect(decodeResourceText(bytes)).toBe('资料\n第二行')
    expect(() => decodeResourceText(new Uint8Array([0xff, 0xfe, 0x41]).buffer)).toThrow()
  })
  it('gives editable stable ID suggestions without treating names as identity', () => {
    expect(suggestedResourceId('Docker 手册.pdf')).toBe('material-docker-手册')
  })
  it('places a restrictive CSP before untrusted HTML', () => {
    const html = isolatedHtml('<script>fetch("https://example.com")</script>')
    expect(html.indexOf("default-src 'none'")).toBeLessThan(html.indexOf('<script>'))
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain("base-uri 'none'")
  })
})
