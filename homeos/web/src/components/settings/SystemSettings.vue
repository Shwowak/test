<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import HealthPanel from './HealthPanel.vue'

const { t, n } = useI18n()
const s = ref(null)
let timer

async function load() {
  s.value = await api('GET', '/system')
}
onMounted(() => { load(); timer = setInterval(load, 5000) })
onBeforeUnmount(() => clearInterval(timer))

const gb = b => n(b / 1024 ** 3, { maximumFractionDigits: 1 }) + ' GB'
const mb = b => n(b / 1024 ** 2, { maximumFractionDigits: 0 }) + ' MB'
const pct = (used, total) => Math.round((used / total) * 100)
const dur = sec => {
  const dd = Math.floor(sec / 86400)
  const hh = Math.floor((sec % 86400) / 3600)
  const mm = Math.floor((sec % 3600) / 60)
  return `${dd ? dd + 'd ' : ''}${hh}h ${mm}m`
}
</script>

<template>
  <HealthPanel />
  <div v-if="s" class="grid">
    <div class="card">
      <div class="label">{{ t('system.version') }}</div>
      <div class="big">v{{ s.version }}</div>
      <div class="dim">{{ s.platform }} · Node {{ s.node }}</div>
    </div>
    <div class="card">
      <div class="label">{{ t('system.uptime') }}</div>
      <div class="big">{{ dur(s.uptime) }}</div>
      <div class="dim">{{ t('system.app_uptime') }}: {{ dur(s.app_uptime) }}</div>
    </div>
    <div class="card">
      <div class="label">{{ t('system.cpu') }}</div>
      <div class="big">{{ n(s.load[0], { maximumFractionDigits: 2 }) }}</div>
      <div class="dim">{{ t('system.load', { cpus: s.cpus }) }}</div>
    </div>
    <div class="card">
      <div class="label">{{ t('system.memory') }}</div>
      <div class="big">{{ pct(s.memory.total - s.memory.free, s.memory.total) }} %</div>
      <div class="bar"><span :style="{ width: pct(s.memory.total - s.memory.free, s.memory.total) + '%' }" /></div>
      <div class="dim">{{ gb(s.memory.total - s.memory.free) }} / {{ gb(s.memory.total) }} · {{ t('system.process') }} {{ mb(s.memory.process) }}</div>
    </div>
    <div v-if="s.disk" class="card">
      <div class="label">{{ t('system.storage') }}</div>
      <div class="big">{{ pct(s.disk.total - s.disk.free, s.disk.total) }} %</div>
      <div class="bar"><span :style="{ width: pct(s.disk.total - s.disk.free, s.disk.total) + '%' }" /></div>
      <div class="dim">{{ t('system.free') }}: {{ gb(s.disk.free) }} / {{ gb(s.disk.total) }}</div>
    </div>
    <div class="card">
      <div class="label">{{ t('system.data') }}</div>
      <ul class="counts">
        <li v-for="(v, k) in s.counts" :key="k"><span>{{ t('system.counts.' + k) }}</span><b>{{ n(v) }}</b></li>
      </ul>
    </div>
  </div>
  <p class="dim api">API: <a href="/api/docs" target="_blank" rel="noopener">/api/docs</a></p>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.card { padding: 16px; border: 1px solid var(--line); background: rgba(2, 6, 23, 0.4); }
.big { font-family: var(--mono); font-size: 32px; margin: 6px 0; color: #fff; }
.dim { color: var(--dim); font-size: 13px; }
.bar { height: 4px; background: rgba(148, 163, 184, 0.15); margin: 8px 0; }
.bar span { display: block; height: 100%; background: linear-gradient(90deg, var(--cyan), var(--violet)); box-shadow: 0 0 8px var(--cyan); }
.counts { list-style: none; margin: 8px 0 0; padding: 0; }
.counts li { display: flex; justify-content: space-between; padding: 4px 0; font-size: 15px; }
.api a { color: var(--cyan); }
</style>
