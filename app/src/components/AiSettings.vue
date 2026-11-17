<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { providerLabels } from '../domain/ai'
import type { AiProvider, AiSettings } from '../domain/ai'
import { useModelSettings } from '../composables/useModelSettings'
import Icon from './Icon.vue'

defineProps<{ taskBusy?: boolean }>()
const emit = defineEmits<{ saved: [settings: AiSettings]; busy: [value: boolean] }>()
const providers: AiProvider[] = ['deepseek', 'openai', 'anthropic']
const { settings, selected, current, targetChanged, hasSavedKey, canUse, dirty, loading, saving, checking, checkingCurrent, error, feedback, checkFeedback, checkError, load, save, check } = useModelSettings(value => emit('saved', value))
const active = computed(() => settings.value?.connections.find(c => c.provider === settings.value?.activeProvider))
const formDisabled = computed(() => loading.value || !!saving.value)
watch(saving, value => emit('busy', !!value), { flush: 'sync' })
onMounted(load)
onBeforeUnmount(() => emit('busy', false))
</script>

<template>
  <section class="model-settings-page glass-panel" aria-labelledby="model-settings-title" data-testid="model-settings-page">
    <header class="model-page-heading">
      <h1 id="model-settings-title">模型设置</h1>
      <div v-if="active" class="active-model" role="status" data-testid="active-model">
        <span>{{ active.configured ? '当前启用' : '未配置密钥' }}</span>
        <strong>{{ providerLabels[active.provider] }}<template v-if="active.model"> · {{ active.model }}</template></strong>
      </div>
    </header>
    <div v-if="loading" class="model-loading" role="status">正在读取连接配置…</div>
    <div v-else-if="!settings" class="model-load-error"><p class="ai-error" role="alert">{{ error || '暂时无法读取模型设置。' }}</p><button class="button" @click="load">重新读取</button></div>
    <div v-else class="model-settings-layout">
      <nav class="provider-list" aria-label="连接类型">
        <button v-for="provider in providers" :key="provider" type="button" :class="{ selected: selected === provider }" :aria-pressed="selected === provider" :disabled="!!saving" :data-testid="'provider-' + provider" @click="selected = provider">
          <span>{{ providerLabels[provider] }}</span><span class="provider-state">{{ settings.activeProvider === provider ? '当前启用' : settings.connections.find(c => c.provider === provider)?.configured ? '已配置' : '未配置' }}</span>
          <Icon v-if="settings.activeProvider === provider" name="check" :size="15" />
        </button>
      </nav>
      <form v-if="current" class="connection-form" @submit.prevent="save()">
        <div class="connection-heading"><h2>{{ providerLabels[selected] }}</h2><span v-if="dirty" class="unsaved-label">尚未保存</span></div>
        <label class="model-field-label" for="model-base-url">连接地址</label>
        <input id="model-base-url" v-model="current.baseUrl" class="field" type="url" :disabled="formDisabled" autocomplete="off" spellcheck="false" data-testid="model-base-url" required />

        <div class="model-label-row"><label class="model-field-label" for="model-api-key">API 密钥</label><span id="model-key-state" class="model-key-state" role="status" data-testid="model-key-state">{{ targetChanged ? '请填写新地址的密钥' : hasSavedKey ? '已保存密钥' : '未配置密钥' }}</span></div>
        <div class="model-key-row"><input id="model-api-key" v-model="current.key" class="field" type="password" :disabled="formDisabled" autocomplete="new-password" spellcheck="false" :placeholder="hasSavedKey ? '留空保留已保存密钥' : '输入 API 密钥'" aria-describedby="model-key-state" data-testid="model-api-key" /><button class="text-button" type="button" :disabled="formDisabled || checking || !hasSavedKey || !!current.key" data-testid="model-remove-key" @click="save(false, true)">{{ saving === 'remove' ? '正在移除…' : '移除密钥' }}</button></div>

        <label class="model-field-label" for="model-name">模型名称</label>
        <input id="model-name" v-model="current.model" class="field" :disabled="formDisabled" autocomplete="off" spellcheck="false" placeholder="输入模型名称" data-testid="model-name" required />

        <div class="connection-result" aria-live="polite">
          <p v-if="checking" class="model-checking" role="status"><span class="spinner small" />{{ checkingCurrent ? '正在检查连接…' : '正在检查其他连接…' }}</p>
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
      </form>
    </div>
  </section>
</template>

<style scoped>
.model-settings-page {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  container-type: inline-size;
  margin: 8px 16px 16px;
  padding: 26px 30px;
}
.model-page-heading { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 16px 24px; padding-bottom: 23px; border-bottom: 1px solid var(--line); }
.model-page-heading h1 { font-size: 25px; font-weight: 600; line-height: 1.4; }
.active-model { display: flex; flex-direction: column; gap: 6px; min-width: 0; max-width: min(100%, 440px); text-align: right; line-height: 1.7; overflow-wrap: anywhere; }
.active-model span { color: var(--muted); }
.active-model strong { font-size: 14px; font-weight: 500; }
.model-settings-layout { display: grid; grid-template-columns: 200px minmax(0, 680px); gap: 32px; padding-top: 26px; }
.provider-list { display: flex; flex-direction: column; gap: 8px; min-width: 0; align-self: start; }
.provider-list button { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 8px; padding: 14px; border: 1px solid transparent; border-radius: 8px; text-align: left; line-height: 1.6; overflow-wrap: anywhere; }
.provider-list button:hover:not(:disabled) { background: #e9e9e9; }
.provider-list button.selected { background: #e7e7e7; border-color: #b9b9b9; }
.provider-list button > span { grid-column: 1; font-weight: 500; }
.provider-list button > .provider-state { color: var(--muted); font-weight: 400; }
.provider-list .ui-icon { grid-column: 2; grid-row: 1 / 3; align-self: center; }
.connection-form { min-width: 0; }
.connection-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
.connection-heading h2 { font-size: 18px; font-weight: 600; line-height: 1.7; overflow-wrap: anywhere; }
.unsaved-label { color: var(--muted); }
.model-field-label { display: block; font-size: 14px; font-weight: 600; margin: 23px 0 9px; }
.model-label-row { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 12px; margin: 23px 0 9px; }
.model-label-row .model-field-label { margin: 0; }
.model-key-state { color: var(--muted); line-height: 1.6; }
.field { min-height: 40px; }
.model-key-row { display: flex; align-items: center; gap: 12px; }
.model-key-row .field { flex: 1; min-width: 0; }
.model-key-row .text-button { flex-shrink: 0; font-size: 14px; }
.connection-result { margin-top: 20px; overflow-wrap: anywhere; }
.connection-result p + p { margin-top: 10px; }
.model-checking { display: flex; align-items: center; gap: 8px; line-height: 1.8; color: var(--muted); }
.model-settings-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 23px; padding-top: 20px; border-top: 1px solid var(--line); }
.action-spacer { flex: 1; }
.model-loading, .model-load-error { padding: 28px 0; line-height: 1.8; }
.model-load-error .button { margin-top: 16px; }
@container (max-width: 760px) {
  .model-settings-layout { grid-template-columns: 1fr; gap: 24px; }
  .provider-list { flex-direction: row; overflow-x: auto; padding-bottom: 4px; }
  .provider-list button { flex: 1 0 155px; }
}
@container (max-width: 440px) {
  .active-model { text-align: left; }
  .model-settings-actions .button { flex: 1 1 auto; }
  .action-spacer { display: none; }
  .model-key-row { flex-wrap: wrap; }
  .model-key-row .field { flex-basis: 100%; }
}
@media (max-width: 1050px) {
  .model-settings-page { padding: 24px; }
}
@media (max-width: 720px) {
  .model-settings-page { margin: 4px 8px 8px; padding: 20px; }
}
</style>
