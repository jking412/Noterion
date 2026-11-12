<script setup lang="ts">
import Icon from './Icon.vue'
import { getTopicTags } from '../domain/logic'
import type { KnowledgePoint, MatchMode } from '../domain/types'
defineProps<{ query: string; keywords: string[]; mode: MatchMode; results: KnowledgePoint[]; points: KnowledgePoint[]; selectedId: string | null; hasQuery: boolean }>()
const emit = defineEmits<{ 'update:query': [value: string]; 'update:mode': [value: MatchMode]; add: []; remove: [index: number]; clear: []; select: [id: string] }>()
</script>
<template>
  <aside class="search-panel glass-panel" aria-label="知识搜索">
    <div class="search-controls">
      <form class="search-form" @submit.prevent="emit('add')">
        <div class="search-input-wrap">
          <Icon name="search" :size="19" />
          <input :value="query" @input="emit('update:query', ($event.target as HTMLInputElement).value)" @keydown.esc="emit('clear')" @keydown.down.prevent="results[0] && emit('select', results[0].id)" placeholder="搜索名称或描述" aria-label="搜索名称或描述" autocomplete="off" spellcheck="false" data-testid="search-input" />
          <button v-if="query" type="button" class="clear-input" aria-label="清空输入" @click="emit('update:query', '')"><Icon name="close" :size="14" /></button>
        </div>
        <button class="button add-keyword" type="submit" title="把输入添加为一个关键词，词内可以含空格"><Icon name="plus" :size="14" /><span>添加关键词</span></button>
      </form>
      <div v-if="keywords.length" class="keyword-list" aria-label="已添加的关键词">
        <span v-for="(term, i) in keywords" :key="term" class="keyword-chip">{{ term }}<button type="button" :aria-label="'移除关键词 ' + term" @click="emit('remove', i)"><Icon name="close" :size="12" /></button></span>
      </div>
      <div class="match-controls" role="group" aria-label="关键词匹配方式">
        <button type="button" class="button" :class="{ 'button-primary': mode === 'all' }" :aria-pressed="mode === 'all'" @click="emit('update:mode', 'all')">全部匹配</button>
        <button type="button" class="button" :class="{ 'button-primary': mode === 'any' }" :aria-pressed="mode === 'any'" @click="emit('update:mode', 'any')">任意匹配</button>
      </div>
      <div v-if="hasQuery" class="results-caption"><span role="status">{{ results.length }} 个结果</span><button class="text-button" @click="emit('clear')">清空搜索</button></div>
    </div>
    <div class="results-scroll">
      <ul v-if="hasQuery && results.length" class="result-list">
        <li v-for="point in results" :key="point.id">
          <button class="result-item" :class="{ 'is-selected': selectedId === point.id }" :aria-pressed="selectedId === point.id" :data-result-id="point.id" @click="emit('select', point.id)">
            <span class="result-name">{{ point.name }}</span>
            <span class="result-description">{{ point.description ? point.description.replace(/\s+/g, ' ').slice(0, 100) : '暂无描述' }}</span>
            <span class="result-tags"><span v-for="topic in getTopicTags(point, points)" :key="topic.id" class="tag">{{ topic.name }}</span><span v-if="!getTopicTags(point, points).length" class="point-type">{{ point.isTheme ? '主题' : '独立知识点' }}</span></span>
          </button>
        </li>
      </ul>
      <div v-else-if="hasQuery" class="search-empty"><Icon name="search" :size="26" /><strong>没有找到相关知识</strong><p>换个片段，或试试任意匹配。</p></div>
      <div v-else class="search-empty search-start"><Icon name="search" :size="27" /><strong>{{ points.length ? '从记得的片段开始' : '先添加你的知识' }}</strong><p>{{ points.length ? '名称、命令，或一句描述。' : '新建知识点后，可按名称或描述查找。' }}</p></div>
    </div>
    <div class="search-footer"><span class="subtle-dot" />{{ points.length }} 个知识点<span class="footer-spacer" />个人知识图谱</div>
  </aside>
</template>
<style scoped>.result-description { display: block; font-size: 12px; color: #707070; line-height: 1.6; margin: 7px 0; overflow-wrap: anywhere; }</style>
