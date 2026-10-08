<script setup>
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { store, loadDevices, command, TYPE_ICONS } from '../devices.js'

const props = defineProps({ widget: Object, editing: Boolean })
const { t, n } = useI18n()
const user = inject('user')
if (!store.loaded) loadDevices().catch(() => {})
const devices = computed(() => Object.values(store.devices)
  .filter(d => d.adopted && d.room_id === props.widget.config.room_id)
  .sort((a, b) => a.name.localeCompare(b.name)))

function primary(d) {
  const c = d.capabilities
  if (c.some(x => x.id === 'onoff')) return { kind: 'toggle', on: !!d.state.onoff }
  const m = c.find(x => x.kind === 'measurement')
  if (m) return { kind: 'value', text: typeof d.state[m.id] === 'number' ? n(d.state[m.id], { maximumFractionDigits: 1 }) + ' ' + m.unit : d.state[m.id] ?? '—' }
  const b = c.find(x => x.kind === 'binary')
  if (b) return { kind: 'binary', on: !!d.state[b.id] }
  if (d.state.position != null) return { kind: 'value', text: d.state.position + ' %' }
  return { kind: 'none' }
}
async function tap(d) {
  if (props.editing || !user.value.permissions.includes('devices.control') || d.connection === 'offline') return
  if (d.capabilities.some(x => x.id === 'onoff')) await command(d.id, 'onoff', !d.state.onoff).catch(() => {})
}
</script>

<template>
  <ul class="room no-drag">
    <li v-for="d in devices" :key="d.id" :class="{ off: d.connection === 'offline' }" @click="tap(d)">
      <span class="ico">{{ TYPE_ICONS[d.type] ?? '◈' }}</span>
      <span class="nm">{{ d.name }}</span>
      <template v-for="p in [primary(d)]" :key="p.kind">
        <span v-if="p.kind === 'toggle'" class="pill" :class="{ on: p.on }">{{ p.on ? t('switch.on') : t('switch.off') }}</span>
        <span v-else-if="p.kind === 'value'" class="val">{{ p.text }}</span>
        <span v-else-if="p.kind === 'binary'" class="dot" :class="{ on: p.on }" />
      </template>
    </li>
    <li v-if="!devices.length" class="empty">{{ t('devices.room_empty') }}</li>
  </ul>
</template>

<style scoped>
.room { list-style: none; margin: 0; padding: 0; height: 100%; overflow-y: auto; }
li { display: flex; align-items: center; gap: 12px; min-height: 52px; border-bottom: 1px solid rgba(148, 163, 184, 0.08); cursor: pointer; }
li.off { opacity: 0.45; }
.ico { width: 26px; text-align: center; }
.nm { flex: 1; font-size: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pill { min-width: 56px; text-align: center; padding: 6px 10px; border: 1px solid var(--line); font-size: 14px; }
.pill.on { border-color: var(--gold); color: var(--gold); box-shadow: 0 0 12px rgba(245, 158, 11, 0.3); }
.val { font-family: var(--mono); color: var(--cyan); }
.dot { width: 12px; height: 12px; border-radius: 50%; background: #475569; }
.dot.on { background: var(--magenta); box-shadow: 0 0 10px var(--magenta); }
.empty { color: var(--dim); cursor: default; }
</style>
