<script setup>
import { ref, computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import ProfileSettings from './ProfileSettings.vue'
import UsersSettings from './UsersSettings.vue'
import LogsSettings from './LogsSettings.vue'
import VersionsSettings from './VersionsSettings.vue'
import SystemSettings from './SystemSettings.vue'
import IntegrationsSettings from './IntegrationsSettings.vue'
import GeneralSettings from './GeneralSettings.vue'
import PluginsSettings from './PluginsSettings.vue'

defineProps({ meta: Object })
const emit = defineEmits(['changed'])
const { t } = useI18n()
const user = inject('user')
const can = p => user.value?.permissions?.includes(p)

const tabs = computed(() => [
  { id: 'profile', icon: '☺', show: true },
  { id: 'general', icon: '⌖', show: true },
  { id: 'integrations', icon: '⌁', show: can('devices.manage') },
  { id: 'plugins', icon: '⧉', show: can('plugins.view') },
  { id: 'users', icon: '⚇', show: can('users.manage') },
  { id: 'versions', icon: '⟲', show: can('versions.view') },
  { id: 'logs', icon: '☰', show: can('logs.view') },
  { id: 'system', icon: '◉', show: can('system.view') },
].filter(x => x.show))
const tab = ref('profile')
</script>

<template>
  <div class="settings">
    <nav class="tabs">
      <button v-for="x in tabs" :key="x.id" class="btn" :class="{ active: tab === x.id }" @click="tab = x.id">
        <span>{{ x.icon }}</span>{{ t('settings.tabs.' + x.id) }}
      </button>
    </nav>
    <div class="pane">
      <ProfileSettings v-if="tab === 'profile'" :meta="meta" />
      <GeneralSettings v-else-if="tab === 'general'" />
      <IntegrationsSettings v-else-if="tab === 'integrations'" />
      <PluginsSettings v-else-if="tab === 'plugins'" />
      <UsersSettings v-else-if="tab === 'users'" :meta="meta" />
      <VersionsSettings v-else-if="tab === 'versions'" @restored="emit('changed')" />
      <LogsSettings v-else-if="tab === 'logs'" :meta="meta" />
      <SystemSettings v-else-if="tab === 'system'" />
    </div>
  </div>
</template>

<style scoped>
.tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
.tabs .btn { font-size: 16px; }
</style>
