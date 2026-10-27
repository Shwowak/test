<script setup>
import { ref, computed, inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { store, loadDevices, connected, TYPE_ICONS, command } from '../../devices.js'
import { errorText } from '../../i18n.js'
import Sheet from '../Sheet.vue'
import DeviceDetail from './DeviceDetail.vue'
import RoomsEditor from './RoomsEditor.vue'

const { t, n } = useI18n()
const user = inject('user')
const can = p => user.value?.permissions?.includes(p)
const room = ref('all')
const detail = ref(null)
const showDiscovered = ref(false)
const showRooms = ref(false)
const picked = ref(new Set())
const error = ref('')

onMounted(() => loadDevices().catch(e => (error.value = errorText(e))))

const readOff = () => { try { return new Set(JSON.parse(localStorage.getItem('sb.integrationsOff') ?? '[]')) } catch { return new Set() } }
const off = ref(readOff())
const search = ref('')
function toggleInteg(id) {
  const s = new Set(off.value)
  s.has(id) ? s.delete(id) : s.add(id)
  off.value = s
  try { localStorage.setItem('sb.integrationsOff', JSON.stringify([...s])) } catch {}
}
const integs = computed(() => store.integrations.map(i => ({ ...i, n: Object.values(store.devices).filter(d => d.adopted && d.integration_id === i.id).length })).filter(i => i.n))
const shown = d => !off.value.has(d.integration_id) && (!search.value || d.name.toLowerCase().includes(search.value.toLowerCase()))
const adopted = computed(() => Object.values(store.devices).filter(d => d.adopted && shown(d)))
const discovered = computed(() => Object.values(store.devices).filter(d => !d.adopted && shown(d)).sort((a, b) => a.name.localeCompare(b.name)))
const visible = computed(() => adopted.value.filter(d => room.value === 'all' || (room.value === 'none' ? d.room_id == null : d.room_id === room.value)))
const grouped = computed(() => {
  const groups = new Map()
  for (const d of visible.value) {
    const key = d.room_id ?? 'none'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(d)
  }
  const order = [...store.rooms.map(r => r.id), 'none']
  return order.filter(k => groups.has(k)).map(k => ({
    id: k, name: k === 'none' ? t('rooms.none') : store.rooms.find(r => r.id === k)?.name,
    devices: groups.get(k).sort((a, b) => a.name.localeCompare(b.name)),
  }))
})

function toggle(id) {
  const s = new Set(picked.value)
  s.has(id) ? s.delete(id) : s.add(id)
  picked.value = s
}
function pickAll() {
  picked.value = picked.value.size === discovered.value.length ? new Set() : new Set(discovered.value.map(d => d.id))
}
async function adopt() {
  error.value = ''
  try {
    await api('POST', '/devices/adopt', { ids: [...picked.value], rooms_from_area: true })
    picked.value = new Set()
    await loadDevices()
    if (!discovered.value.length) showDiscovered.value = false
  } catch (e) {
    error.value = errorText(e)
  }
}
const PRIO = ['power', 'temperature', 'humidity', 'cpu', 'soc', 'battery', 'energy']
const num = (v, c) => typeof v === 'number' ? `${n(v, { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1 })}${c?.unit ? ' ' + c.unit : ''}` : null
function status(d) {
  if (d.connection === 'offline') return t('devices.no_response')
  const st = d.state ?? {}
  const cap = id => d.capabilities.find(c => c.id === id)
  const parts = []
  if (cap('onoff')) parts.push(st.onoff ? t('switch.on') : t('switch.off'))
  if (st.onoff && cap('brightness') && st.brightness != null) parts.push(`${st.brightness} %`)
  if (cap('position') && st.position != null) parts.push(`${st.position} %`)
  const ms = d.capabilities.filter(c => c.kind === 'measurement' && typeof st[c.id] === 'number')
    .sort((a, b) => (PRIO.indexOf(a.quantity ?? a.id) + 1 || 99) - (PRIO.indexOf(b.quantity ?? b.id) + 1 || 99))
  for (const c of ms.slice(0, parts.length ? 1 : 2)) parts.push(num(st[c.id], c))
  if (cap('target_temperature') && st.target_temperature != null) parts.push(`${t('devices.target')} ${num(st.target_temperature, { unit: '°C' })}`)
  const bin = d.capabilities.find(c => c.kind === 'binary')
  if (!parts.length && bin) parts.push(t(`binary.${bin.id}.${st[bin.id] ? 'on' : 'off'}`, t(`binary.default.${st[bin.id] ? 'on' : 'off'}`)))
  const txt = d.capabilities.find(c => c.kind === 'text' || c.kind === 'select')
  if (!parts.length && txt && st[txt.id] != null) parts.push(String(st[txt.id]))
  return parts.join(' · ') || '—'
}
const isOn = d => d.connection !== 'offline' && (d.state?.onoff === true || (d.state?.onoff === undefined && d.capabilities.some(c => c.kind === 'binary' && c.id !== 'online' && d.state?.[c.id] === true)))
const canToggle = d => d.capabilities.some(c => c.id === 'onoff') && can('devices.control') && d.connection !== 'offline'
const tapIcon = d => { if (canToggle(d)) command(d.id, 'onoff', !d.state?.onoff).catch(e => (error.value = errorText(e))); else detail.value = d }

async function hide(d) {
  await api('PUT', `/devices/${d.id}`, { hidden: true })
  await loadDevices()
}
</script>

<template>
  <div class="devices">
    <header class="bar">
      <div class="chips">
        <button class="chip" :class="{ on: room === 'all' }" @click="room = 'all'">{{ t('rooms.all') }}</button>
        <button v-for="r in store.rooms" :key="r.id" class="chip" :class="{ on: room === r.id }" @click="room = r.id">{{ r.icon }} {{ r.name }}</button>
        <button class="chip" :class="{ on: room === 'none' }" @click="room = 'none'">{{ t('rooms.none') }}</button>
      </div>
      <div class="actions">
        <span class="live" :class="{ ok: connected }" :title="connected ? t('devices.live') : t('devices.offline')" />
        <button v-if="can('devices.manage')" class="btn" @click="showRooms = true">▢ {{ t('rooms.title') }}</button>
      </div>
    </header>

    <div class="filter">
      <input v-model="search" type="search" class="q" :placeholder="t('devices.search')">
      <button v-for="i in integs" :key="i.id" class="ftog" :class="{ on: !off.has(i.id) }" @click="toggleInteg(i.id)">
        <span class="sw" />{{ i.name }}<small>{{ i.n }}</small>
      </button>
    </div>

    <button v-if="discovered.length && can('devices.manage')" class="found" @click="showDiscovered = true">
      <span class="pulse" />{{ t('devices.found', discovered.length) }} <b>→</b>
    </button>

    <p v-if="error" class="error">{{ error }}</p>

    <section v-for="g in grouped" :key="g.id" class="room">
      <h2>{{ g.name }} <small>{{ g.devices.length }}</small></h2>
      <div class="grid">
        <article v-for="d in g.devices" :key="d.id" class="tile" :class="{ on: isOn(d), off: d.connection === 'offline' }" @click="detail = d">
          <div class="tt">
            <button class="ico" :class="{ tog: canToggle(d) }" @click.stop="tapIcon(d)">{{ TYPE_ICONS[d.type] ?? '◈' }}</button>
            <span v-if="d.battery != null && d.battery < 20" class="bat">🪫 {{ Math.round(d.battery) }} %</span>
          </div>
          <div class="nm">{{ d.name }}</div>
          <div class="sv">{{ status(d) }}</div>
        </article>
      </div>
    </section>

    <p v-if="store.loaded && !adopted.length" class="empty">{{ off.size || search ? t('devices.filtered') : t('devices.empty') }}</p>

    <Sheet v-if="showDiscovered" :title="t('devices.discovered_title')" @close="showDiscovered = false">
      <p class="hint">{{ t('devices.discovered_hint') }}</p>
      <div class="row">
        <button class="btn" @click="pickAll">{{ picked.size === discovered.length ? t('devices.select_none') : t('devices.select_all') }}</button>
        <span class="grow" />
        <button class="btn primary" :disabled="!picked.size" @click="adopt">＋ {{ t('devices.adopt', picked.size) }}</button>
      </div>
      <ul class="disc">
        <li v-for="d in discovered" :key="d.id" :class="{ on: picked.has(d.id) }" @click="toggle(d.id)">
          <span class="check">{{ picked.has(d.id) ? '✓' : '' }}</span>
          <span class="ico">{{ TYPE_ICONS[d.type] ?? '◈' }}</span>
          <span class="txt">
            <b>{{ d.name }}</b>
            <small>{{ t('deviceTypes.' + d.type) }} · {{ [d.manufacturer, d.model].filter(Boolean).join(' ') || d.native_id }}<template v-if="d.meta.area"> · {{ d.meta.area }}</template></small>
          </span>
          <button class="btn icon" :title="t('devices.ignore')" @click.stop="hide(d)">✕</button>
        </li>
      </ul>
      <p v-if="error" class="error">{{ error }}</p>
    </Sheet>

    <Sheet v-if="detail" :title="detail.name" @close="detail = null">
      <DeviceDetail :device="store.devices[detail.id] ?? detail" @close="detail = null" />
    </Sheet>

    <Sheet v-if="showRooms" :title="t('rooms.title')" @close="showRooms = false">
      <RoomsEditor />
    </Sheet>
  </div>
</template>

<style scoped>
.devices { padding: 0 24px 48px; }
.bar { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
.chips { display: inline-flex; gap: 2px; padding: 3px; border-radius: 11px; background: rgba(118, 118, 128, 0.2); overflow-x: auto; max-width: 100%; }
.chip { padding: 7px 16px; border: 0; border-radius: 8px; background: transparent; color: var(--text); white-space: nowrap; font-size: 14px; cursor: pointer; }
.chip.on { background: #636366; box-shadow: 0 3px 8px rgba(0, 0, 0, 0.16); }
.actions { display: flex; gap: 10px; align-items: center; }
.live { width: 8px; height: 8px; border-radius: 50%; background: #ff453a; }
.live.ok { background: #30d158; }
.found { width: 100%; margin-bottom: 20px; border: 0; border-radius: 14px; background: rgba(10, 132, 255, 0.16); color: var(--text); display: flex; align-items: center; gap: 12px; padding: 14px 18px; font-size: 15px; cursor: pointer; text-align: left; }
.found b { margin-left: auto; color: #0a84ff; }
.pulse { width: 10px; height: 10px; border-radius: 50%; background: #0a84ff; animation: pulse 1.4s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
.filter { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 22px; }
.q { min-width: 200px; flex: 0 1 260px; border: 0; border-radius: 10px; padding: 9px 14px; background: rgba(118, 118, 128, 0.2); color: var(--text); font-size: 15px; }
.q:focus { outline: none; box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.5); }
.ftog { display: flex; align-items: center; gap: 8px; padding: 7px 13px; border: 0; border-radius: 999px; background: rgba(118, 118, 128, 0.14); color: var(--dim); font-size: 13px; cursor: pointer; }
.ftog small { opacity: 0.7; font-variant-numeric: tabular-nums; }
.ftog .sw { width: 26px; height: 16px; border-radius: 999px; background: rgba(118, 118, 128, 0.4); position: relative; transition: background 0.2s; }
.ftog .sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform 0.2s; }
.ftog.on { color: var(--text); }
.ftog.on .sw { background: #30d158; }
.ftog.on .sw::after { transform: translateX(10px); }
.room { margin-bottom: 30px; }
.room h2 { margin: 0 0 12px; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
.room h2 small { font-size: 15px; font-weight: 400; color: var(--dim); margin-left: 6px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
.tile { aspect-ratio: 1.35; min-height: 118px; border-radius: 18px; padding: 14px; display: flex; flex-direction: column; cursor: pointer; background: rgba(118, 118, 128, 0.18); backdrop-filter: blur(24px) saturate(160%); -webkit-backdrop-filter: blur(24px) saturate(160%); transition: transform 0.15s, background 0.25s; user-select: none; }
.tile:hover { background: rgba(118, 118, 128, 0.26); }
.tile:active { transform: scale(0.97); }
.tile.on { background: rgba(255, 255, 255, 0.92); color: #1c1c1e; }
.tile.off { opacity: 0.55; }
.tt { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.ico { width: 40px; height: 40px; border-radius: 50%; border: 0; display: grid; place-items: center; font-size: 20px; background: rgba(118, 118, 128, 0.28); cursor: pointer; padding: 0; }
.tile.on .ico { background: #ffcc00; }
.ico.tog:hover { box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.5); }
.bat { font-size: 12px; color: #ff453a; }
.nm { margin-top: auto; font-size: 15px; font-weight: 600; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.sv { font-size: 13px; color: var(--dim); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tile.on .sv { color: #636366; }
.tile.off .sv { color: #ff453a; }
.empty, .hint { color: var(--dim); }
.row { display: flex; gap: 10px; margin: 12px 0; }
.grow { flex: 1; }
.disc { list-style: none; padding: 0; margin: 0; border-radius: 12px; overflow: hidden; background: rgba(118, 118, 128, 0.12); }
.disc li { display: flex; align-items: center; gap: 12px; padding: 10px 14px; cursor: pointer; min-height: 56px; position: relative; }
.disc li + li::before { content: ''; position: absolute; top: 0; left: 54px; right: 0; height: 0.5px; background: rgba(84, 84, 88, 0.45); }
.disc li.on { background: rgba(10, 132, 255, 0.12); }
.check { width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid rgba(235, 235, 245, 0.3); display: grid; place-items: center; color: #fff; flex: none; font-size: 13px; }
.disc li.on .check { background: #0a84ff; border-color: #0a84ff; }
.disc .ico { width: 30px; height: 30px; font-size: 16px; }
.disc .txt { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.disc small { color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 700px) { .devices { padding: 0 12px 30px; } .bar { flex-direction: column; align-items: stretch; } .grid { grid-template-columns: repeat(2, 1fr); gap: 10px; } }
</style>
