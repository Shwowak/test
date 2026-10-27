<script setup>
import { ref, computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import ProfileSettings from './ProfileSettings.vue'
import UsersSettings from './UsersSettings.vue'
import ApiTokens from './ApiTokens.vue'
import LogsSettings from './LogsSettings.vue'
import VersionsSettings from './VersionsSettings.vue'
import SystemSettings from './SystemSettings.vue'
import IntegrationsSettings from './IntegrationsSettings.vue'
import GeneralSettings from './GeneralSettings.vue'
import PluginsSettings from './PluginsSettings.vue'
import HardwareSettings from './HardwareSettings.vue'
import AiSettings from './AiSettings.vue'
import CamerasSettings from './CamerasSettings.vue'
import AlarmSettings from './AlarmSettings.vue'
import SourceManager from '../SourceManager.vue'
import { api } from '../../api.js'
import { features } from '../../features.js'

defineProps({ meta: Object })
const emit = defineEmits(['changed'])
const { t } = useI18n()
const user = inject('user')
const can = p => user.value?.permissions?.includes(p)

const groups = computed(() => [
  { id: 'basics', items: [
    { id: 'general', icon: '⚙', c: '#8e8e93', show: true },
    { id: 'display', icon: '☀', c: '#0a84ff', show: can('system.view') },
    { id: 'network', icon: '◎', c: '#0a84ff', show: can('system.view') },
    { id: 'bluetooth', icon: 'ᛒ', c: '#0a84ff', show: can('system.view') },
    { id: 'audio', icon: '♪', c: '#ff375f', show: can('system.view') },
  ] },
  { id: 'services', items: [
    { id: 'integrations', icon: '⌁', c: '#30d158', show: can('devices.manage') },
    { id: 'sources', icon: '⇄', c: '#64d2ff', show: can('sources.view') },
    { id: 'cameras', icon: '◉', c: '#5e5ce6', show: can('cameras.view') && features.cameras },
    { id: 'assistant', icon: '✦', c: '#bf5af2', show: can('ai.use') && features.assistant },
    { id: 'plugins', icon: '⧉', c: '#ff9f0a', show: can('plugins.view') },
    { id: 'alarm', icon: '!', c: '#ff453a', show: can('users.manage') },
  ] },
  { id: 'security', items: [
    { id: 'users', icon: '⚇', c: '#ff9f0a', show: can('users.manage') },
    { id: 'api', icon: '⚿', c: '#8e8e93', show: can('users.manage') },
  ] },
  { id: 'maintenance', items: [
    { id: 'update', icon: '↓', c: '#0a84ff', show: can('system.view') },
    { id: 'system', icon: '▣', c: '#636366', show: can('system.view') },
    { id: 'versions', icon: '⟲', c: '#30d158', show: can('versions.view') },
    { id: 'logs', icon: '≡', c: '#636366', show: can('logs.view') },
  ] },
].map(g => ({ ...g, items: g.items.filter(x => x.show && (!query.value || t('settings.tabs.' + x.id).toLowerCase().includes(query.value.toLowerCase()))) })).filter(g => g.items.length))
const tab = ref('general')
const query = ref('')
const mobileList = ref(true)
const pick = id => { tab.value = id; mobileList.value = false }
const initials = computed(() => (user.value?.display_name ?? user.value?.name ?? '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())
const sources = ref([])
const loadSources = async () => { sources.value = can('sources.view') ? await api('GET', '/sources').catch(() => []) : [] }
loadSources()
</script>

<template>
  <div class="settings" :class="{ list: mobileList }">
    <aside class="side">
      <div class="search"><input v-model="query" type="search" :placeholder="t('settings.search')"></div>
      <button class="me" :class="{ on: tab === 'profile' }" @click="pick('profile')">
        <span class="av">{{ initials }}</span>
        <span class="mt"><b>{{ user?.display_name ?? user?.name }}</b><small>{{ t('settings.account') }}</small></span>
      </button>
      <nav>
        <div v-for="g in groups" :key="g.id" class="grp">
          <div class="gt">{{ t('settings.groups.' + g.id) }}</div>
          <button v-for="x in g.items" :key="x.id" class="it" :class="{ on: tab === x.id }" @click="pick(x.id)">
            <span class="ic" :style="{ background: x.c }">{{ x.icon }}</span>
            <span class="lb">{{ t('settings.tabs.' + x.id) }}</span>
            <span class="ch">›</span>
          </button>
        </div>
      </nav>
    </aside>
    <main class="pane">
      <header class="ph">
        <button class="bk" @click="mobileList = true">‹ {{ t('settings.title') }}</button>
        <h1>{{ tab === 'profile' ? t('settings.tabs.profile') : t('settings.tabs.' + tab) }}</h1>
      </header>
      <div class="content">
        <ProfileSettings v-if="tab === 'profile'" :meta="meta" />
        <GeneralSettings v-else-if="tab === 'general'" />
        <IntegrationsSettings v-else-if="tab === 'integrations'" />
        <SourceManager v-else-if="tab === 'sources' && meta" :meta="meta" :sources="sources" @changed="loadSources" />
        <HardwareSettings v-else-if="['display', 'network', 'bluetooth', 'audio', 'update'].includes(tab)" :section="tab" />
        <AiSettings v-else-if="tab === 'assistant'" />
        <CamerasSettings v-else-if="tab === 'cameras'" />
        <AlarmSettings v-else-if="tab === 'alarm'" />
        <PluginsSettings v-else-if="tab === 'plugins'" />
        <UsersSettings v-else-if="tab === 'users'" :meta="meta" />
        <ApiTokens v-else-if="tab === 'api'" />
        <VersionsSettings v-else-if="tab === 'versions'" @restored="emit('changed')" />
        <LogsSettings v-else-if="tab === 'logs'" :meta="meta" />
        <SystemSettings v-else-if="tab === 'system'" />
      </div>
    </main>
  </div>
</template>

<style scoped>
.settings { display: flex; width: 100%; height: 100%; min-height: 0; }
.side { width: 280px; flex: none; display: flex; flex-direction: column; gap: 10px; padding: 18px 12px; background: rgba(118, 118, 128, 0.08); border-right: 1px solid var(--line); overflow-y: auto; }
.search input { width: 100%; border: 0; border-radius: 10px; padding: 9px 12px; background: rgba(118, 118, 128, 0.2); color: var(--text); font-size: 14px; }
.search input:focus { outline: none; box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.5); }
.me { display: flex; align-items: center; gap: 12px; padding: 10px; border: 0; border-radius: 12px; background: transparent; color: var(--text); cursor: pointer; text-align: left; }
.av { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font-weight: 600; background: linear-gradient(135deg, #64d2ff, #0a84ff); color: #fff; flex: none; }
.mt { display: flex; flex-direction: column; min-width: 0; }
.mt b { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt small { color: var(--dim); font-size: 12px; }
.grp { margin-top: 10px; }
.gt { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dim); padding: 0 10px 6px; }
.it { width: 100%; display: flex; align-items: center; gap: 10px; padding: 6px 10px; min-height: 38px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font-size: 14px; cursor: pointer; text-align: left; }
.it:hover, .me:hover { background: rgba(118, 118, 128, 0.14); }
.it.on, .me.on { background: #0a84ff; color: #fff; }
.me.on small { color: rgba(255, 255, 255, 0.8); }
.ic { width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; color: #fff; font-size: 14px; flex: none; box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.2); }
.lb { flex: 1; }
.ch { display: none; color: var(--dim); }
.pane { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ph { padding: 22px 32px 10px; }
.ph h1 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
.bk { display: none; border: 0; background: none; color: #0a84ff; font-size: 16px; padding: 0 0 8px; cursor: pointer; }
.content { flex: 1; overflow-y: auto; padding: 12px 32px 40px; user-select: text; }
@media (max-width: 760px) {
  .side { width: 100%; border-right: 0; background: transparent; padding-top: 56px; }
  .it { min-height: 46px; font-size: 16px; }
  .it.on { background: transparent; color: var(--text); }
  .ch { display: block; }
  .settings.list .pane { display: none; }
  .settings:not(.list) .side { display: none; }
  .bk { display: block; }
  .ph { padding: 18px 18px 6px; }
  .content { padding: 8px 18px 40px; }
}
</style>
