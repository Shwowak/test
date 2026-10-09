<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api.js'
import { store, loadDevices, listeners, TYPE_ICONS } from '../devices.js'
import Sheet from './Sheet.vue'

const emit = defineEmits(['apply'])
const { t, n } = useI18n()
const plan = ref(null)
const open = ref(false)
const tab = ref(0)
const KEY = 'homeos_suggest_dismissed'
const dismissed = ref((() => { try { return localStorage.getItem(KEY) === '1' } catch { return false } })())
let timer = null

async function refresh() {
  plan.value = await api('POST', '/dashboards/generate', { dryRun: true }).catch(() => null)
  if (plan.value && !store.loaded) loadDevices().catch(() => {})
}
const on = type => {
  if (type === 'device.discovered' || type === 'integration.status') { clearTimeout(timer); timer = setTimeout(refresh, 4000) }
}
onMounted(() => { refresh(); listeners.add(on) })
onBeforeUnmount(() => { listeners.delete(on); clearTimeout(timer) })

const show = computed(() => plan.value && !plan.value.created && plan.value.devices_used >= 3 && !dismissed.value)
const dash = computed(() => plan.value?.plan?.[tab.value])
function dismiss() { dismissed.value = true; try { localStorage.setItem(KEY, '1') } catch {} }

function value(d) {
  if (!d) return '—'
  const c = d.capabilities
  if (c.some(x => x.id === 'onoff')) return d.state.onoff ? t('switch.on') : t('switch.off')
  const m = c.find(x => x.kind === 'measurement')
  if (m) return typeof d.state[m.id] === 'number' ? `${n(d.state[m.id], { maximumFractionDigits: 1 })} ${m.unit}` : d.state[m.id] ?? '—'
  if (d.state.position != null) return `${d.state.position} %`
  const b = c.find(x => x.kind === 'binary')
  return b ? (d.state[b.id] ? '●' : '○') : '—'
}
const dev = id => store.devices[id]
const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
function apply() { open.value = false; emit('apply') }
defineExpose({ refresh, openPreview: () => { open.value = true } })
</script>

<template>
  <div v-if="show" class="banner">
    <span class="ico">✦</span>
    <span class="txt"><b>{{ t('suggest.title', { n: plan.devices_used }) }}</b><small>{{ t('suggest.sub', { d: plan.dashboards, r: plan.rooms }) }}</small></span>
    <button class="btn primary" @click="open = true">{{ t('suggest.view') }}</button>
    <button class="btn" @click="dismiss">{{ t('suggest.later') }}</button>
  </div>

  <Sheet v-if="open && plan" :title="t('suggest.preview')" @close="open = false">
    <div class="tabs">
      <button v-for="(d, i) in plan.plan" :key="i" class="btn" :class="{ active: tab === i }" @click="tab = i">{{ d.icon }} {{ d.name }}</button>
    </div>
    <div v-if="dash" class="mini">
      <div v-for="(w, i) in dash.widgets" :key="i" class="card" :style="{ gridColumn: `${w.x + 1} / span ${w.w}`, gridRow: `${w.y + 1} / span ${w.h}` }">
        <template v-if="w.type === 'clock'"><small>{{ t('suggest.clock') }}</small><b class="big">{{ clock() }}</b></template>
        <template v-else-if="w.type === 'device'">
          <small>{{ TYPE_ICONS[dev(w.config.device_id)?.type] ?? '◈' }} {{ w.title }}</small>
          <b class="big">{{ value(dev(w.config.device_id)) }}</b>
        </template>
        <template v-else-if="w.type === 'room'">
          <small>{{ w.title }}</small>
          <ul>
            <li v-for="id in w.devices.slice(0, w.h * 2)" :key="id"><span>{{ plan.names?.[id] ?? dev(id)?.name ?? '…' }}</span><b>{{ value(dev(id)) }}</b></li>
            <li v-if="w.devices.length > w.h * 2" class="more">+{{ w.devices.length - w.h * 2 }}</li>
          </ul>
        </template>
      </div>
    </div>
    <div class="row">
      <button class="btn" @click="open = false">{{ t('common.back') }}</button>
      <span class="grow" />
      <button class="btn primary" @click="apply">✦ {{ t('suggest.apply') }}</button>
    </div>
  </Sheet>
</template>

<style scoped>
.banner { display: flex; align-items: center; gap: 14px; margin: 0 0 14px; padding: 14px 18px; border-radius: var(--radius); background: var(--glass); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); }
.banner .ico { font-size: 26px; color: var(--cyan); }
.banner .txt { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.banner small { color: var(--dim); }
.tabs { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 12px; }
.tabs .btn { flex: none; min-height: 44px; font-size: 15px; }
.mini { display: grid; grid-template-columns: repeat(12, 1fr); grid-auto-rows: 44px; gap: 8px; margin-bottom: 16px; }
.card { border-radius: 16px; background: rgba(118, 118, 128, 0.18); padding: 10px 12px; overflow: hidden; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.card small { color: var(--dim); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.big { font-size: 18px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
li { display: flex; justify-content: space-between; gap: 8px; }
li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
li b { flex: none; font-weight: 600; }
.more { color: var(--dim); }
@media (max-width: 700px) { .mini { grid-template-columns: repeat(6, 1fr); } .card { grid-column: span 6 !important; grid-row: auto !important; min-height: 70px; } }
</style>
