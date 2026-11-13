<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { providerLabels } from '../domain/ai'
import type { AiProvider, AiSettings } from '../domain/ai'
import { useModelSettings } from '../composables/useModelSettings'
import Icon from './Icon.vue'

defineProps<{ taskBusy?: boolean }>()
const emit = defineEmits<{ saved: [settings: AiSettings]; busy: [value: boolean] }>()
const providers: AiProvider[] = ['deepseek', 'openai', 'anthropic']
const descriptions: Record<AiProvider, string> = {
  deepseek: '使用 DeepSeek 官方预设，也可填写可信的兼容地址。',
  openai: '填写支持 Chat Completions 的服务地址与完整模型名称。',
  anthropic: '填写支持 Messages 的服务地址与完整模型名称。',
}
const { settings, selected, current, savedConnection, targetChanged, hasSavedKey, canUse, dirty, loading, saving, checking, checkingCurrent, error, feedback, checkFeedback, checkError, load, save, check } = useModelSettings(value => emit('saved', value))
const active = computed(() => settings.value?.connections.find(c => c.provider === settings.value?.activeProvider))
const formDisabled = computed(() => loading.value || !!saving.value)
watch(saving, value => emit('busy', !!value), { flush: 'sync' })
onMounted(load)
onBeforeUnmount(() => emit('busy', false))
</script>

<template>
  <section class="model-settings-page glass-panel" aria-labelledby="model-settings-title" data-testid="model-settings-page">
    <header class="model-page-heading">
      <div><h1 id="model-settings-title">模型设置</h1><p>选择一个连接，用于知识整理、查找与问答。</p></div>
      <div v-if="active" class="active-model" role="status" data-testid="active-model">
        <span>{{ active.configured ? '当前启用' : '当前连接 · 尚未配置密钥' }}</span>
        <strong>{{ providerLabels[active.provider] }}<template v-if="active.model"> · {{ active.model }}</template></strong>
      </div>
    </header>
    <p v-if="taskBusy" class="model-task-note" role="status">正在进行的 AI 任务会继续使用启动时的连接。</p>
    <div v-if="loading" class="model-loading" role="status">正在读取连接配置…</div>
    <div v-else-if="!settings" class="model-load-error"><p class="ai-error" role="alert">{{ error || '暂时无法读取模型设置。' }}</p><button class="button" @click="load">重新读取</button></div>
    <div v-else class="model-settings-layout">
      <nav class="provider-list" aria-label="连接类型">
        <button v-for="provider in providers" :key="provider" type="button" :class="{ selected: selected === provider }" :aria-pressed="selected === provider" :disabled="!!saving" :data-testid="'provider-' + provider" @click="selected = provider">
          <span>{{ providerLabels[provider] }}</span><small>{{ settings.activeProvider === provider ? '当前启用' : settings.connections.find(c => c.provider === provider)?.configured ? '已保存密钥' : '未配置密钥' }}</small>
          <Icon v-if="settings.activeProvider === provider" name="check" :size="15" />
        </button>
      </nav>
      <form v-if="current" class="connection-form" @submit.prevent="save()">
        <div class="connection-heading"><h2>{{ providerLabels[selected] }}</h2><span v-if="dirty" class="unsaved-label">尚未保存</span></div>
        <p class="model-help connection-description">{{ descriptions[selected] }}</p>
        <label class="model-field-label" for="model-base-url">连接地址</label>
        <input id="model-base-url" v-model="current.baseUrl" class="field" type="url" :disabled="formDisabled" autocomplete="off" spellcheck="false" aria-describedby="model-url-help" data-testid="model-base-url" required />
        <p id="model-url-help" class="model-help field-help">请使用可信的服务地址。更改地址后，需要为新目标填写密钥。</p>

        <label class="model-field-label" for="model-api-key">API 密钥</label>
        <div class="model-key-row"><input id="model-api-key" v-model="current.key" class="field" type="password" :disabled="formDisabled" autocomplete="new-password" spellcheck="false" :placeholder="hasSavedKey ? '输入新密钥以替换；留空保留已保存密钥' : '输入这个连接的 API 密钥'" aria-describedby="model-key-state" data-testid="model-api-key" /><button class="text-button" type="button" :disabled="formDisabled || checking || !hasSavedKey || !!current.key" data-testid="model-remove-key" @click="save(false, true)">移除密钥</button></div>
        <p id="model-key-state" class="model-help field-help" data-testid="model-key-state">{{ targetChanged ? '连接地址已变更，不会沿用原地址的密钥。' : hasSavedKey ? '已保存密钥，保存在 Windows 凭据中。' : '这个连接尚未保存密钥。' }}</p>

        <label class="model-field-label" for="model-name">模型名称</label>
        <input id="model-name" v-model="current.model" class="field" :disabled="formDisabled" autocomplete="off" spellcheck="false" placeholder="填写服务提供的完整模型 ID" data-testid="model-name" required />
        <p class="model-help field-help">请确认所选模型支持文本生成和工具调用。</p>

        <div class="connection-result" aria-live="polite">
          <p v-if="checking" class="model-checking" role="status"><span class="spinner small" />{{ checkingCurrent ? '正在检查连接…' : '上一项连接检查仍在进行。' }}</p>
          <p v-if="checkFeedback" class="ai-feedback" role="status" data-testid="model-check-success">{{ checkFeedback }}</p>
          <p v-if="checkError" class="ai-error" role="alert" data-testid="model-check-error">{{ checkError }}</p>
          <p v-if="error" class="ai-error" role="alert" data-testid="model-save-error">{{ error }}</p>
          <p v-if="feedback" class="ai-feedback" role="status" data-testid="model-save-success">{{ feedback }}</p>
        </div>
        <footer class="model-settings-actions">
          <button class="button" type="button" :disabled="formDisabled || checking || !canUse" data-testid="ai-check" @click="check">检查连接</button>
          <span class="action-spacer" />
          <button class="button" type="submit" :disabled="formDisabled || checking || !current.model.trim() || !current.baseUrl.trim()" data-testid="ai-settings-save">{{ saving === 'save' ? '正在保存…' : '保存配置' }}</button>
          <button class="button button-primary" type="button" :disabled="formDisabled || checking || !canUse" data-testid="model-activate" @click="save(true)">{{ saving === 'activate' ? '正在启用…' : '保存并启用' }}</button>
        </footer>
        <p class="model-help model-privacy">使用 AI 时，本次文本、问题和相关知识会发送至启用的连接；勾选的文本资料也会被读取并发送。密钥保存在 Windows 凭据中，知识与资料继续保存在本机。</p>
      </form>
    </div>
  </section>
</template>

<style scoped>
.model-settings-page{flex:1;min-height:0;overflow:auto;margin:8px 16px 16px;padding:26px 30px}
.model-page-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding-bottom:23px;border-bottom:1px solid var(--line)}
.model-page-heading h1{font-size:25px;font-weight:600;line-height:1.4}.model-page-heading p{font-size:13px;line-height:1.8;color:var(--muted);margin-top:8px}
.active-model{display:flex;flex-direction:column;gap:7px;max-width:45%;text-align:right;line-height:1.7;overflow-wrap:anywhere}.active-model span{font-size:13px;color:var(--muted)}.active-model strong{font-size:14px;font-weight:500}
.model-settings-layout{display:grid;grid-template-columns:220px minmax(0,680px);gap:40px;padding-top:26px}
.provider-list{display:flex;flex-direction:column;gap:8px;align-self:start}.provider-list button{display:grid;grid-template-columns:minmax(0,1fr) auto;text-align:left;gap:5px 8px;padding:15px 14px;border-radius:8px;border:1px solid transparent;line-height:1.6}.provider-list button:hover:not(:disabled){background:#e9e9e9}.provider-list button.selected{background:#e7e7e7;border-color:#b9b9b9}.provider-list button span{font-size:14px;font-weight:500;grid-column:1}.provider-list small{font-size:13px;color:var(--muted);grid-column:1}.provider-list .ui-icon{grid-column:2;grid-row:1/3;align-self:center}
.connection-form{min-width:0}.connection-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.connection-heading h2{font-size:18px;font-weight:600;line-height:1.7}.unsaved-label{font-size:13px;color:var(--muted)}
.model-help{font-size:13px;color:var(--muted);line-height:1.85;overflow-wrap:anywhere}.connection-description{margin-top:7px;margin-bottom:25px}.model-field-label{display:block;font-size:13px;font-weight:600;margin:23px 0 9px}.field{min-height:40px}.field-help{margin-top:8px}.model-key-row{display:flex;align-items:center;gap:12px}.model-key-row .field{flex:1;min-width:0}.model-key-row .text-button{flex-shrink:0}
.connection-result{margin-top:20px}.connection-result p+p{margin-top:10px}.model-checking{display:flex;align-items:center;gap:8px;font-size:13px;line-height:1.85;color:var(--muted)}
.model-settings-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:23px;padding-top:20px;border-top:1px solid var(--line)}.action-spacer{flex:1}.model-privacy{margin-top:23px;max-width:70ch}.model-task-note{font-size:13px;color:var(--muted);line-height:1.85;margin-top:18px}.model-loading,.model-load-error{padding:28px 0;line-height:1.8}.model-load-error .button{margin-top:16px}
@media(max-width:1050px){.model-settings-layout{grid-template-columns:185px minmax(0,1fr);gap:28px}.model-settings-page{padding:24px}}
@media(max-width:720px){.model-page-heading{flex-direction:column;gap:16px}.active-model{max-width:100%;text-align:left}.model-settings-layout{grid-template-columns:1fr;gap:24px}.provider-list{flex-direction:row;overflow-x:auto;padding-bottom:4px}.provider-list button{flex:1;min-width:155px}.model-settings-page{margin:4px 8px 8px;padding:20px}.action-spacer{display:none}.model-settings-actions .button{flex:1}.model-key-row{flex-wrap:wrap}}
</style>
