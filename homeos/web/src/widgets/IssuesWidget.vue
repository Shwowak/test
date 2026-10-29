<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api.js'

const { t, locale } = useI18n()
const data = ref(null)
let timer = null
const load = async () => { data.value = await api('GET', '/issues').catch(() => data.value) }
onMounted(() => { load(); timer = setInterval(load, 30000) })
onBeforeUnmount(() => clearInterval(timer))
const time = s => s ? new Date(s).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' }) : ''
const count = () => (data.value?.integrations.length ?? 0) + (data.value?.devices.length ?? 0) + (data.value?.logs.length ?? 0)
</script>

<template>
  <div class="iss">
    <div class="head"><span class="n" :class="{ ok: data && !count() }">{{ data ? count() : '–' }}</span><span class="l">{{ data && !count() ? t('issues.ok') : t('widgetTypes.issues') }}</span></div>
    <ul v-if="data">
      <li v-for="i in data.integrations" :key="'i' + i.id" class="err"><b>{{ i.name }}</b><small>{{ t('issues.integration') }} · {{ i.error }}</small></li>
      <li v-for="d in data.devices" :key="'d' + d.id" class="warn"><b>{{ d.name }}</b><small>{{ t('issues.offline') }}</small></li>
      <li v-for="(l, k) in data.logs" :key="'l' + k" :class="l.level === 'warning' ? 'warn' : 'err'"><b>{{ l.message }}</b><small>{{ t('issues.log') }} · {{ l.category }} · {{ time(l.ts) }}</small></li>
    </ul>
  </div>
</template>

<style scoped>
.iss { height: 100%; display: flex; flex-direction: column; }
.head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.n { font-size: 34px; font-weight: 600; color: #ff453a; }
.n.ok { color: #30d158; }
.l { color: var(--dim); font-size: 14px; }
ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
li { display: flex; flex-direction: column; padding: 7px 0 7px 14px; position: relative; border-bottom: 1px solid rgba(148, 163, 184, 0.08); }
li::before { content: ''; position: absolute; left: 0; top: 13px; width: 7px; height: 7px; border-radius: 50%; }
li.err::before { background: #ff453a; }
li.warn::before { background: #ff9f0a; }
b { font-size: 15px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
small { color: var(--dim); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
