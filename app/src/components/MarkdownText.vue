<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ text: string }>()
// Render a small Markdown subset as Vue text nodes. HTML, images and remote embeds
// deliberately remain inert text; source navigation is handled by verified buttons.
const blocks = computed(() => {
  const result: { kind: 'paragraph' | 'code' | 'heading' | 'list'; text: string; level?: number }[] = []
  let code: string[] | null = null
  let paragraph: string[] = []
  const flush = () => { if (paragraph.length) { result.push({ kind: 'paragraph', text: paragraph.join('\n') }); paragraph = [] } }
  for (const line of props.text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { flush(); if (code) { result.push({ kind: 'code', text: code.join('\n') }); code = null } else code = []; continue }
    if (code) { code.push(line); continue }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) { flush(); result.push({ kind: 'heading', text: heading[2]!, level: heading[1]!.length }); continue }
    if (/^\s*(?:[-*+] |\d+\. )/.test(line)) { flush(); result.push({ kind: 'list', text: line.replace(/^\s*(?:[-*+] |\d+\. )/, '') }); continue }
    if (!line.trim()) flush(); else paragraph.push(line)
  }
  flush(); if (code) result.push({ kind: 'code', text: code.join('\n') })
  return result
})
function parts(text: string) { return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map(value => ({ value: value.startsWith('`') ? value.slice(1, -1) : value.startsWith('**') ? value.slice(2, -2) : value, kind: value.startsWith('`') ? 'code' : value.startsWith('**') ? 'strong' : 'text' })) }
</script>
<template><div class="markdown-text"><template v-for="(block, index) in blocks" :key="index"><pre v-if="block.kind === 'code'"><code>{{ block.text }}</code></pre><h3 v-else-if="block.kind === 'heading'">{{ block.text }}</h3><div v-else :class="block.kind === 'list' ? 'markdown-list-item' : 'markdown-paragraph'"><span v-if="block.kind === 'list'" aria-hidden="true">• </span><template v-for="(part, i) in parts(block.text)" :key="i"><code v-if="part.kind === 'code'">{{ part.value }}</code><strong v-else-if="part.kind === 'strong'">{{ part.value }}</strong><template v-else>{{ part.value }}</template></template></div></template></div></template>
<style scoped>.markdown-text{font-size:14px;line-height:1.85;overflow-wrap:anywhere;min-width:0}.markdown-paragraph{white-space:pre-wrap;margin:8px 0 14px}.markdown-text h3{font-size:15px;font-weight:600;margin:20px 0 8px}.markdown-text h3:first-child{margin-top:0}.markdown-text pre{overflow:auto;white-space:pre;padding:13px 14px;background:#292929;color:#fff;border-radius:8px;margin:12px 0;font:13px/1.8 Consolas,'Microsoft YaHei',monospace}.markdown-text code{font-family:Consolas,'Microsoft YaHei',monospace}.markdown-paragraph>code,.markdown-list-item>code{padding:1px 4px;background:#e6e6e6;border-radius:3px}.markdown-list-item{padding-left:12px;margin:5px 0}</style>
