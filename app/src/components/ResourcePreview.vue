<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ResourceItem } from '../domain/types'
import { formatBytes, resourceLabel } from '../domain/resources'
import { errorText, invoke } from '../desktop'
import ModalShell from './ModalShell.vue'
const props = defineProps<{ resource: ResourceItem }>()
const emit = defineEmits<{ close: []; import: [resource: ResourceItem] }>()
const mediaUrl = ref('')
const error = ref('')
const loading = ref(false)
const externalStatus = ref('')
const video = ref<HTMLVideoElement | null>(null)
const time = ref(0)
const duration = ref(0)
const playing = ref(false)
const text = ref('')
let disposed = false
let decodingTimer: ReturnType<typeof setTimeout> | undefined
const textKind = computed(() => ['text','markdown','html'].includes(props.resource.kind))
async function open() {
  if (props.resource.kind === 'link') return
  loading.value = true
  try {
    const media = await invoke<{ url: string; mime: string; size: number }>('media_open', { id: props.resource.id })
    if (disposed) { await invoke('media_close', { url: media.url }); return }
    mediaUrl.value = media.url
    if (textKind.value) {
      // Text is bounded for display. The managed original remains available through system open.
      const response = await fetch(media.url, { headers: { Range: 'bytes=0-524287' } })
      if (!response.ok) throw new Error('文本读取失败，请检查本地文件。')
      text.value = await response.text()
    }
  } catch (e) { error.value = errorText(e) }
  finally { if (!disposed) loading.value = false }
}
async function external() { externalStatus.value = ''; try { await invoke('resource_external', { id: props.resource.id }); externalStatus.value = '已请求系统应用打开。' } catch (e) { error.value = errorText(e) } }
function videoFailure() { error.value = '当前视频无法读取或解码。可使用系统应用打开本机副本。'; playing.value = false }
function checkVideo() {
  clearTimeout(decodingTimer)
  decodingTimer = setTimeout(() => { const element = video.value; if (element && element.readyState >= 1 && (!element.videoWidth || !element.videoHeight)) videoFailure() }, 2000)
}
async function togglePlayback() {
  const element = video.value
  if (!element) return
  try { if (element.paused) { await element.play(); checkVideo() } else element.pause() }
  catch { videoFailure() }
}
function seek(event: Event) { const element = video.value; if (element && Number.isFinite(element.duration)) element.currentTime = Number((event.target as HTMLInputElement).value) }
function updateTime() { const element = video.value; if (element) { time.value = element.currentTime; duration.value = Number.isFinite(element.duration) ? element.duration : 0 } }
function clock(value: number) { return Math.floor(value / 60) + ':' + String(Math.floor(value % 60)).padStart(2, '0') }
onMounted(open)
onBeforeUnmount(() => {
  disposed = true; clearTimeout(decodingTimer)
  if (video.value) { video.value.pause(); video.value.removeAttribute('src'); video.value.load() }
  if (mediaUrl.value) void invoke('media_close', { url: mediaUrl.value }).catch(() => {})
})
</script>
<template>
  <ModalShell :title="resource.title" wide @close="emit('close')">
    <div class="resource-meta"><span class="tag">{{ resourceLabel(resource.kind) }}</span><span v-if="resource.filename">{{ resource.filename }}</span><span v-if="resource.size !== undefined">{{ formatBytes(resource.size) }}</span></div>
    <p v-if="loading" role="status">正在打开本机资料…</p>
    <p v-if="error" class="preview-error" role="alert">{{ error }}</p>
    <div v-if="resource.kind === 'link'" class="external-preview"><p>{{ resource.url }}</p><button class="button button-primary" @click="external">在系统浏览器打开</button></div>
    <template v-else-if="mediaUrl">
      <div v-if="resource.kind === 'video'" class="video-workspace"><video ref="video" class="video-preview" :src="mediaUrl" controls preload="metadata" @error="videoFailure" @loadedmetadata="updateTime(); checkVideo()" @timeupdate="updateTime" @play="playing = true; checkVideo()" @pause="playing = false" @loadeddata="checkVideo" /><div class="video-controls"><button class="button" aria-label="播放视频" @click="togglePlayback">{{ playing ? '暂停' : '播放' }}</button><input type="range" aria-label="视频播放位置" min="0" :max="duration || 1" step="1" :value="time" :disabled="!duration" @input="seek" /><span>{{ clock(time) }} / {{ clock(duration) }}</span></div><p class="preview-note">支持情况取决于本机 WebView2 解码能力；无法播放时可使用系统应用打开。</p></div>
      <div v-else-if="resource.kind === 'image'" class="image-preview"><img :src="mediaUrl" :alt="resource.title" @error="error = '这份图片无法显示，可使用系统应用打开。'" /></div>
      <div v-else-if="resource.kind === 'pdf'" class="pdf-preview"><iframe :src="mediaUrl" :title="resource.title" class="pdf-frame" /><p class="preview-note">本机只读 PDF 预览；若当前运行时无法显示，可使用系统应用打开。</p></div>
      <pre v-else-if="textKind" class="text-preview">{{ text || '资料为空。' }}</pre>
      <p v-else class="generic-preview">此格式暂不支持内置查看，请使用系统应用打开本机副本。</p>
    </template>
    <p v-if="textKind && (resource.size ?? 0) > 524288" class="preview-note">仅显示前 512 KB，可在系统应用中查看完整原文。</p>
    <p v-if="externalStatus" role="status" class="preview-note">{{ externalStatus }}</p>
    <footer class="preview-footer"><button class="button" @click="external">{{ resource.kind === 'link' ? '在系统浏览器打开' : '使用系统应用打开' }}</button><button class="button" @click="emit('close')">关闭预览</button><button class="button button-primary" @click="emit('import', resource)">导入知识</button></footer>
  </ModalShell>
</template>
<style scoped>
.resource-meta { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 18px; color: #646464; font-size: 12px; overflow-wrap: anywhere; }.video-preview { display: block; width: 100%; max-height: 53vh; min-height: 250px; background: #161616; border-radius: 9px; }.video-controls { display: flex; align-items: center; gap: 14px; margin: 12px 0; }.video-controls input { flex: 1; min-width: 0; accent-color: #444; }.video-controls span { font-size: 12px; color: #666; min-width: 85px; }.image-preview { min-height: 250px; display: grid; place-items: center; border: 1px solid #d9d9d9; border-radius: 10px; padding: 20px; background: #ffffffcf; }.image-preview img { max-width: 100%; max-height: 55vh; object-fit: contain; }.pdf-frame { width: 100%; height: 56vh; border: 1px solid #d9d9d9; border-radius: 8px; background: white; }.preview-note { color: #646464; font-size: 12px; line-height: 1.8; margin: 12px 0; }.preview-error { color: #8e3a2e; border: 1px solid #b5887b; background: #fff3ed; padding: 13px; border-radius: 8px; line-height: 1.8; margin-bottom: 15px; font-size: 13px; }.text-preview { min-height: 250px; max-height: 55vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 22px; border: 1px solid #d9d9d9; border-radius: 10px; background: #ffffffcf; font: 13px/1.85 Consolas,'Microsoft YaHei',monospace; }.external-preview,.generic-preview { padding: 25px; min-height: 180px; line-height: 1.9; overflow-wrap: anywhere; }.preview-footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-top: 20px; padding-top: 18px; border-top: 1px solid #d9d9d9; }
</style>
