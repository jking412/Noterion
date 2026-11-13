<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'
const failed = ref(false)
const emit = defineEmits<{ failure: [] }>()
onErrorCaptured(() => { failed.value = true; emit('failure'); return false })
</script>
<template><slot v-if="!failed" /><div v-else class="graph-boundary-message" role="alert">图谱暂时无法显示。搜索、知识详情和资料仍可使用。</div></template>
<style scoped>.graph-boundary-message { padding: 100px 35%; line-height: 2; }</style>
