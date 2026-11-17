<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
const props = defineProps<{ view: string; disabled: boolean }>()
const emit = defineEmits<{ navigate: [view: 'graph' | 'resources' | 'import' | 'models'] }>()
const collapsed = ref(false)
const pages = [{ id: 'graph', label: '知识图谱', icon: 'layers' }, { id: 'resources', label: '资料库', icon: 'book' }, { id: 'import', label: '知识导入', icon: 'file' }] as const
const pageTitle = computed(() => pages.find(page => page.id === props.view)?.label || '应用设置')
</script>

<template>
  <main class="desktop-shell" :class="{ 'navigation-collapsed': collapsed }">
    <aside class="desktop-sidebar">
      <button class="desktop-wordmark" aria-label="Noterion 知识图谱" :disabled="disabled" @click="emit('navigate', 'graph')"><img src="/brand-icon.png" alt="" width="30" height="30" /><span>Noterion</span></button>
      <div class="workspace-entry"><slot name="workspace" /></div>
      <nav class="desktop-navigation" aria-label="主导航">
        <button v-for="page in pages" :key="page.id" :class="{ active: view === page.id }" :aria-current="view === page.id ? 'page' : undefined" :aria-label="page.label" :disabled="disabled" @click="emit('navigate', page.id)"><Icon :name="page.icon" :size="20" /><span>{{ page.label }}</span></button>
      </nav>
      <div class="sidebar-bottom">
        <button class="settings-navigation" :class="{ active: view === 'models' || view === 'data' }" aria-label="应用设置" data-testid="ai-settings" :aria-current="view === 'models' || view === 'data' ? 'page' : undefined" :disabled="disabled" @click="emit('navigate', 'models')"><Icon name="settings" :size="20" /><span>应用设置</span></button>
        <button class="collapse-navigation" :aria-label="collapsed ? '展开导航' : '收起导航'" :aria-expanded="!collapsed" @click="collapsed = !collapsed"><Icon name="sidebar" :size="18" /><span>收起导航</span></button>
      </div>
    </aside>
    <section class="desktop-main" :aria-label="pageTitle">
      <header class="workspace-header"><h1>{{ pageTitle }}</h1><div class="workspace-actions"><slot name="actions" /></div></header>
      <div class="desktop-content"><slot /></div>
    </section>
  </main>
</template>

<style scoped>
.desktop-shell{--sidebar-width:208px;display:grid;grid-template-columns:var(--sidebar-width) minmax(0,1fr);width:100%;height:100dvh;min-width:0;background:#f6f6f6}
.desktop-sidebar{display:flex;flex-direction:column;gap:24px;padding:24px 14px 12px;background:#ececec;border-right:1px solid #d6d6d6;min-width:0;min-height:0;overflow:auto}
.desktop-wordmark{display:flex;align-items:center;gap:9px;padding:0 2px;font-family:'Segoe UI',system-ui,sans-serif;font-size:25px;font-weight:700;letter-spacing:-.6px;white-space:nowrap;min-height:36px;text-align:left}
.desktop-wordmark img{flex:none}.workspace-entry{min-width:0;min-height:46px;display:flex;align-items:center;padding:2px}
.desktop-navigation,.sidebar-bottom{display:flex;flex-direction:column;gap:7px}.desktop-navigation button,.sidebar-bottom button{display:flex;align-items:center;gap:12px;padding:12px 14px;min-height:46px;width:100%;text-align:left;border-radius:8px;font-size:14px;white-space:nowrap}.desktop-navigation button:hover:not(:disabled),.sidebar-bottom button:hover:not(:disabled){background:#e0e0e0}.desktop-navigation .active,.sidebar-bottom .active{background:#d9d9d9;color:#171717;font-weight:600}
.sidebar-bottom{margin-top:auto;padding-top:20px}.sidebar-bottom .collapse-navigation{min-height:38px;color:#595959;padding-top:9px;padding-bottom:9px}
.desktop-main{display:flex;flex-direction:column;min-width:0;min-height:0}.workspace-header{display:flex;align-items:center;justify-content:space-between;gap:18px;flex:none;min-height:70px;padding:14px 22px;border-bottom:1px solid #ddd;background:#fafafa}.workspace-header h1{font-size:16px;line-height:1.5;font-weight:600;white-space:nowrap}.workspace-actions{display:flex;align-items:center;justify-content:flex-end;gap:12px;min-width:0;flex-wrap:wrap}.desktop-content{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden}
.navigation-collapsed{--sidebar-width:72px}.navigation-collapsed .desktop-sidebar{padding:24px 10px 12px}.navigation-collapsed .desktop-wordmark{justify-content:center}.navigation-collapsed .desktop-wordmark span,.navigation-collapsed .desktop-navigation span,.navigation-collapsed .sidebar-bottom span{display:none}.navigation-collapsed .desktop-navigation button,.navigation-collapsed .sidebar-bottom button{justify-content:center;padding:12px}.navigation-collapsed .workspace-entry{padding:0;justify-content:center}
@media(max-width:1100px){.desktop-shell{--sidebar-width:184px}.desktop-sidebar{padding-left:10px;padding-right:10px}.desktop-wordmark{font-size:23px}.workspace-header{padding:12px 18px}.navigation-collapsed{--sidebar-width:72px}}
@media(max-width:850px){.desktop-shell{--sidebar-width:72px}.desktop-sidebar{padding:20px 10px 12px}.desktop-wordmark{justify-content:center}.desktop-wordmark span,.desktop-navigation span,.sidebar-bottom span{display:none}.desktop-navigation button,.sidebar-bottom button{justify-content:center;padding:12px}.workspace-entry{justify-content:center;padding:0}.workspace-header{align-items:flex-start;gap:12px;padding:12px 16px}.workspace-header h1{padding-top:7px}.workspace-actions{gap:8px}.collapse-navigation{display:none!important}}
@media(max-height:600px){.desktop-sidebar{gap:16px;padding-top:14px}.sidebar-bottom{padding-top:10px}.workspace-header{min-height:60px;padding-top:10px;padding-bottom:10px}}
</style>
