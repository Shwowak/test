<script setup>
import { ref, computed, inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { store, loadDevices, connected, TYPE_ICONS } from '../../devices.js'
import { errorText } from '../../i18n.js'
import Sheet from '../Sheet.vue'
import DeviceControl from './DeviceControl.vue'
import DeviceDetail from './DeviceDetail.vue'
import RoomsEditor from './RoomsEditor.vue'

const { t } = useI18n()
const user = inject('user')
const can = p => user.value?.permissions?.includes(p)
const room = ref('all')
const detail = ref(null)
const showDiscovered = ref(false)
const showRooms = ref(false)
const picked = ref(new Set())
const error = ref('')

onMounted(() => loadDevices().catch(e => (error.value = errorText(e))))

const adopted = computed(() => Object.values(store.devices).filter(d => d.adopted))
const discovered = computed(() => Object.values(store.devices).filter(d => !d.adopted).sort((a, b) => a.name.localeCompare(b.name)))
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

    <button v-if="discovered.length && can('devices.manage')" class="found" @click="showDiscovered = true">
      <span class="pulse" />{{ t('devices.found', discovered.length) }} <b>→</b>
    </button>

    <p v-if="error" class="error">{{ error }}</p>

    <section v-for="g in grouped" :key="g.id" class="room">
      <h2 class="label">{{ g.name }}</h2>
      <div class="grid">
        <article v-for="d in g.devices" :key="d.id" class="dev" :class="{ off: d.connection === 'offline' }">
          <header @click="detail = d">
            <span class="ico">{{ TYPE_ICONS[d.type] ?? '◈' }}</span>
            <span class="name">{{ d.name }}</span>
            <span v-if="d.battery != null" class="bat" :class="{ low: d.battery < 20 }">{{ Math.round(d.battery) }}%</span>
            <span class="conn" :class="d.connection" />
          </header>
          <DeviceControl :device="d" compact :disabled="!can('devices.control')" />
        </article>
      </div>
    </section>

    <p v-if="store.loaded && !adopted.length" class="empty">{{ t('devices.empty') }}</p>

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
.devices { padding: 0 20px 40px; }
.bar { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
.chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.chip { min-height: 48px; padding: 0 18px; border: 1px solid var(--line); background: transparent; white-space: nowrap; font-size: 16px; cursor: pointer; }
.chip.on { border-color: var(--cyan); color: #fff; box-shadow: 0 0 14px rgba(34, 211, 238, 0.25); }
.actions { display: flex; gap: 10px; align-items: center; }
.live { width: 10px; height: 10px; border-radius: 50%; background: var(--err); }
.live.ok { background: var(--ok); box-shadow: 0 0 10px var(--ok); }
.found { width: 100%; min-height: 64px; margin-bottom: 18px; border: 1px solid var(--magenta); background: rgba(236, 72, 153, 0.08); display: flex; align-items: center; gap: 14px; padding: 0 20px; font-size: 18px; cursor: pointer; }
.found b { margin-left: auto; }
.pulse { width: 12px; height: 12px; border-radius: 50%; background: var(--magenta); box-shadow: 0 0 12px var(--magenta); animation: pulse 1.4s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
.room { margin-bottom: 26px; }
.room h2 { margin: 0 0 10px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
.dev { border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); background: rgba(8, 13, 26, 0.6); padding: 16px; display: flex; flex-direction: column; gap: 12px; min-height: 150px; }
.dev header { display: flex; align-items: center; gap: 10px; cursor: pointer; min-height: 32px; }
.dev .ico { font-size: 22px; }
.dev .name { flex: 1; font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bat { font-size: 12px; color: var(--dim); font-family: var(--mono); }
.bat.low { color: var(--err); }
.conn { width: 8px; height: 8px; border-radius: 50%; background: #475569; }
.conn.online { background: var(--ok); }
.conn.offline { background: var(--err); }
.empty, .hint { color: var(--dim); }
.row { display: flex; gap: 10px; margin: 12px 0; }
.grow { flex: 1; }
.disc { list-style: none; padding: 0; margin: 0; }
.disc li { display: flex; align-items: center; gap: 12px; padding: 12px 6px; border-top: 1px solid var(--line); cursor: pointer; min-height: 64px; }
.disc li.on { background: rgba(34, 211, 238, 0.06); }
.check { width: 28px; height: 28px; border: 1px solid var(--line-strong); display: grid; place-items: center; color: var(--cyan); flex: none; }
.disc .txt { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.disc small { color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 700px) { .devices { padding: 0 10px 30px; } .bar { flex-direction: column; align-items: stretch; } }
</style>
