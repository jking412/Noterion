<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ResourceItem } from '../domain/types'
import { formatBytes, isolatedHtml, resourceLabel, validResourceUrl } from '../domain/resources'
import ModalShell from './ModalShell.vue'
import Icon from './Icon.vue'

const props = defineProps<{ resource: ResourceItem }>()
const emit = defineEmits<{ close: []; import: [resource: ResourceItem] }>()
const imageFailed = ref(false)
watch(() => props.resource.id, () => { imageFailed.value = false })

interface MarkdownBlock { kind: 'text' | 'heading' | 'code' | 'list' | 'quote'; text: string; level?: number; items?: string[] }

const markdownBlocks = computed<MarkdownBlock[]>(() => {
  const blocks: MarkdownBlock[] = []
  let paragraph: string[] = []
  let code: string[] | null = null
  let fence = ''
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'text', text: paragraph.join('\n') })
    paragraph = []
  }
  for (const line of (props.resource.content ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const fenceMatch = line.trim().match(/^(`{3,}|~{3,})/)
    if (code !== null) {
      if (line.trim() === fence) {
        blocks.push({ kind: 'code', text: code.join('\n') })
        code = null
      } else code.push(line)
      continue
    }
    if (fenceMatch) { flushParagraph(); fence = fenceMatch[1]!; code = []; continue }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    const listItem = line.match(/^\s*(?:[-*+] |\d+[.)] )(.+)$/)
    const quote = line.match(/^>\s?(.*)$/)
    if (heading) { flushParagraph(); blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! }) }
    else if (listItem) {
      flushParagraph()
      const previous = blocks.at(-1)
      if (previous?.kind === 'list') previous.items!.push(listItem[1]!)
      else blocks.push({ kind: 'list', text: '', items: [listItem[1]!] })
    } else if (quote) { flushParagraph(); blocks.push({ kind: 'quote', text: quote[1]! }) }
    else if (!line.trim()) flushParagraph()
    else paragraph.push(line)
  }
  flushParagraph()
  if (code !== null) blocks.push({ kind: 'code', text: code.join('\n') })
  return blocks
})

const externalUrl = computed(() => validResourceUrl(props.resource.url ?? ''))
const safeHtml = computed(() => isolatedHtml(props.resource.content || '<p>此资料暂无可预览内容。</p>'))
</script>

<template>
  <ModalShell :title="resource.title" wide @close="emit('close')">
    <div class="resource-meta"><span class="tag">{{ resourceLabel(resource.kind) }}</span><span v-if="resource.filename">{{ resource.filename }}</span><span v-if="resource.size !== undefined">{{ formatBytes(resource.size) }}</span><code>{{ resource.id }}</code></div>
    <template v-if="resource.kind === 'html'"><iframe class="html-preview" :title="resource.title" :srcdoc="safeHtml" sandbox="" referrerpolicy="no-referrer" /><p class="preview-fallback">HTML 预览不加载外部内容；完整文件可下载后打开。</p></template>
    <article v-else-if="resource.kind === 'markdown'" class="markdown-preview">
      <template v-for="(block, index) in markdownBlocks" :key="index">
        <component :is="`h${block.level}`" v-if="block.kind === 'heading'">{{ block.text }}</component>
        <pre v-else-if="block.kind === 'code'"><code>{{ block.text }}</code></pre>
        <ul v-else-if="block.kind === 'list'"><li v-for="(item, itemIndex) in block.items" :key="itemIndex">{{ item }}</li></ul>
        <blockquote v-else-if="block.kind === 'quote'">{{ block.text }}</blockquote>
        <p v-else>{{ block.text }}</p>
      </template>
      <p v-if="!markdownBlocks.length" class="empty-content">此资料暂无可预览内容。</p>
    </article>
    <div v-else-if="resource.kind === 'link'" class="external-preview">
      <p v-if="resource.content">{{ resource.content }}</p>
      <p class="external-address">{{ resource.url }}</p>
      <a v-if="externalUrl" class="button button-primary" :href="externalUrl" target="_blank" rel="noopener noreferrer">在新窗口打开资料 <span aria-hidden="true">↗</span></a>
      <p v-else class="empty-content">此资料暂无可用的外部链接。</p>
    </div>
    <div v-else-if="resource.kind === 'image'" class="image-preview"><img v-if="resource.blobUrl && !imageFailed" :src="resource.blobUrl" :alt="resource.title" @error="imageFailed = true" /><p v-else class="empty-content">{{ imageFailed ? '浏览器无法显示这份图片，可下载原文件后打开。' : '图片文件已不可用，请重新添加资料。' }}</p></div>
    <div v-else-if="resource.kind === 'pdf'" class="pdf-preview"><iframe v-if="resource.blobUrl" class="pdf-frame" :src="resource.blobUrl" :title="resource.title" referrerpolicy="no-referrer" /><p class="preview-fallback">PDF 由浏览器预览。如果当前浏览器无法显示，请下载文件后打开。</p></div>
    <div v-else-if="resource.kind === 'file'" class="generic-file-preview"><Icon name="file" :size="36" /><h3>{{ resource.filename || resource.title }}</h3><p>此格式暂不支持页面内预览，可下载后使用对应应用打开。</p><a v-if="resource.blobUrl" class="button button-primary" :href="resource.blobUrl" :download="resource.filename || resource.title">下载文件</a><p v-else class="empty-content">文件已不可用，请重新添加资料。</p></div>
    <pre v-else class="text-preview">{{ resource.content || '此资料暂无可预览内容。' }}</pre>
    <footer class="preview-footer"><a v-if="resource.blobUrl && resource.kind !== 'file'" class="button" :href="resource.blobUrl" :download="resource.filename || resource.title">下载原文件</a><button class="button" type="button" @click="emit('close')">关闭预览</button><button class="button button-primary" type="button" @click="emit('import', resource)">导入知识</button></footer>
  </ModalShell>
</template>

<style scoped>
.resource-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 18px; color: #646464; font-size: 12px; overflow-wrap: anywhere; }
.resource-meta code { font: 11px Consolas,'Microsoft YaHei',monospace; }
.image-preview { min-height: 250px; display: flex; justify-content: center; align-items: center; border: 1px solid #d9d9d9; border-radius: 10px; padding: 20px; background: #ffffffcf; }
.image-preview img { display: block; max-width: 100%; max-height: 55dvh; object-fit: contain; }
.pdf-frame { width: 100%; height: 56dvh; border: 1px solid #d9d9d9; border-radius: 8px; background: #fff; }
.preview-fallback { margin: 12px 0 0; color: #646464; font-size: 12px; line-height: 1.8; }
.generic-file-preview { min-height: 270px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 24px; border: 1px solid #d9d9d9; border-radius: 10px; background: #ffffffcf; text-align: center; }
.generic-file-preview h3 { max-width: 100%; overflow-wrap: anywhere; font-size: 17px; font-weight: 600; }
.generic-file-preview p { font-size: 13px; line-height: 1.8; color: #646464; }
.html-preview { display: block; box-sizing: border-box; width: 100%; min-height: 430px; height: 58dvh; border: 1px solid #d9d9d9; border-radius: 10px; background: #fff; }
.text-preview, .markdown-preview { min-height: 250px; margin: 0; padding: 22px 24px; border: 1px solid #d9d9d9; border-radius: 10px; background: #ffffffcf; color: #202020; font-size: 14px; line-height: 1.85; overflow-wrap: anywhere; }
.text-preview { font-family: 'Cascadia Code', Consolas, 'Microsoft YaHei', monospace; white-space: pre-wrap; }
.markdown-preview :deep(h1) { margin: 0 0 18px; font-size: 24px; }
.markdown-preview :deep(h2) { margin: 24px 0 12px; font-size: 19px; }
.markdown-preview :deep(h3), .markdown-preview :deep(h4), .markdown-preview :deep(h5), .markdown-preview :deep(h6) { margin: 20px 0 10px; font-size: 16px; }
.markdown-preview :deep(p) { margin: 0 0 14px; white-space: pre-wrap; }
.markdown-preview :deep(pre) { padding: 15px 18px; overflow-x: auto; border: 1px solid #d9d9d9; border-radius: 8px; background: #eee; font-family: 'Cascadia Code', Consolas, monospace; font-size: 13px; line-height: 1.7; }
.markdown-preview :deep(ul) { padding-left: 24px; }
.markdown-preview :deep(blockquote) { margin: 15px 0; padding-left: 14px; border-left: 3px solid #aaa; color: #646464; }
.markdown-preview > :first-child { margin-top: 0; }
.external-preview { padding: 20px 24px 28px; border: 1px solid #d9d9d9; border-radius: 10px; background: #ffffffcf; font-size: 14px; line-height: 1.8; }
.external-preview > p:first-child { margin-top: 0; }
.external-address { overflow-wrap: anywhere; color: #646464; font-size: 13px; }
.external-preview .button { display: inline-flex; align-items: center; gap: 12px; text-decoration: none; }
.empty-content { color: #646464; }
.preview-footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; margin-top: 20px; padding-top: 18px; border-top: 1px solid #d9d9d9; }
</style>
