<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { AiSettings } from '../domain/ai'
import { errorText, invoke } from '../desktop'
import ModalShell from './ModalShell.vue'
const emit = defineEmits<{ close: []; saved: [settings: AiSettings] }>()
const settings = ref<AiSettings | null>(null)
const model = ref(''); const baseUrl = ref(''); const key = ref(''); const busy = ref(false); const error = ref(''); const feedback = ref('')
onMounted(async () => { try { settings.value = await invoke<AiSettings>('ai_settings'); model.value = settings.value.model; baseUrl.value = settings.value.baseUrl } catch (e) { error.value = errorText(e) } })
onBeforeUnmount(() => { key.value = '' })
async function save(remove = false) {
  busy.value = true; error.value = ''; feedback.value = ''
  try { const input = { model: model.value.trim(), baseUrl: baseUrl.value.trim(), ...(remove ? { key: '' } : key.value ? { key: key.value } : {}) }; settings.value = await invoke<AiSettings>('ai_configure', { input }); key.value = ''; emit('saved', settings.value); feedback.value = remove ? '已移除密钥。' : 'DeepSeek 配置已保存。' }
  catch (e) { error.value = errorText(e) }
  finally { key.value = ''; busy.value = false }
}
async function check() { busy.value = true; error.value = ''; feedback.value = ''; try { feedback.value = await invoke<string>('ai_check') } catch (e) { error.value = errorText(e) } finally { busy.value = false } }
</script>
<template><ModalShell title="DeepSeek 设置" @close="!busy && emit('close')"><form class="ai-settings" @submit.prevent="save()"><p class="ai-help">使用 AI 时，提交的文本、问题、相关知识与资料信息会发送至 DeepSeek。勾选的文本资料也会被读取并发送。密钥保存在 Windows 凭据中。</p><p v-if="settings" class="ai-config-status" role="status">{{ settings.configured ? '已配置密钥 ' + settings.keyHint : '尚未配置密钥' }}</p><label for="deepseek-key">API 密钥</label><input id="deepseek-key" v-model="key" class="field" type="password" autocomplete="new-password" spellcheck="false" :disabled="busy" placeholder="输入新密钥；留空保留现有密钥" aria-label="DeepSeek API key" /><label for="deepseek-model">模型</label><input id="deepseek-model" v-model="model" class="field" :disabled="busy" autocomplete="off" aria-label="DeepSeek 模型" /><label for="deepseek-url">连接地址</label><input id="deepseek-url" v-model="baseUrl" class="field" :disabled="busy" autocomplete="off" aria-label="DeepSeek 连接地址" /><p class="ai-help">更改地址后，密钥和文本将发送到该地址。请仅使用可信的服务。</p><p v-if="error" class="ai-error" role="alert">{{ error }}</p><p v-if="feedback" class="ai-feedback" role="status">{{ feedback }}</p><footer class="ai-settings-actions"><button type="button" class="text-button" :disabled="busy || !settings?.configured" @click="save(true)">移除密钥</button><span /><button class="button" type="button" :disabled="busy || !settings?.configured" data-testid="ai-check" @click="check">检查连接</button><button class="button button-primary" type="submit" :disabled="busy || !model.trim() || !baseUrl.trim()" data-testid="ai-settings-save">{{ busy ? '正在处理…' : '保存配置' }}</button></footer></form></ModalShell></template>
<style scoped>.ai-settings>label{display:block;font-size:13px;font-weight:600;margin:20px 0 8px}.ai-help{font-size:13px;color:#646464;line-height:1.85;margin-bottom:12px}.ai-config-status{font-size:13px;padding:10px 12px;background:#eaeaea;border-radius:8px;margin:16px 0}.ai-settings-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:24px;padding-top:18px;border-top:1px solid #d9d9d9}.ai-settings-actions>span{flex:1}</style>
