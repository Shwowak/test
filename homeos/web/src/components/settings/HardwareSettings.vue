<script setup>
import { ref, computed, onMounted, inject, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { errorText } from '../../i18n.js'
import { hw, loadHardware, getScale, setScale, resetScale } from '../../display.js'

const props = defineProps({ section: String })
const { t, d } = useI18n()
const user = inject('user')
const canManage = computed(() => user.value?.permissions?.includes('system.manage'))
const data = ref(null)
const busy = ref('')
const msg = ref('')
const err = ref('')
const wifi = ref(null)
const join = ref(null)
const hostname = ref('')
const displaySettings = ref({ idle: 0, dim: 0 })
const scale = ref(Math.round(getScale() * 100))
function applyScale(v) { scale.value = Number(v); setScale(scale.value / 100) }

const call = async (key, fn, ok) => {
  busy.value = key
  err.value = ''
  msg.value = ''
  try {
    const r = await fn()
    if (ok) msg.value = ok
    return r
  } catch (e) {
    err.value = errorText(e) + (e.details?.message ? ` – ${e.details.message}` : '')
  } finally { busy.value = '' }
}

async function load() {
  await loadHardware()
  displaySettings.value = { idle: 0, dim: 0, ...hw.info?.display }
  const path = { display: '/hardware/display', network: '/hardware/network', bluetooth: '/hardware/bluetooth', audio: '/hardware/audio', update: '/hardware/update' }[props.section]
  if (!hw.info?.device && props.section === 'display') return
  data.value = await call('load', () => api('GET', path))
  if (props.section === 'network') hostname.value = data.value?.hostname ?? ''
}
onMounted(load)
watch(() => props.section, () => { data.value = null; wifi.value = null; load() })

const post = (path, body) => api('POST', path, body)
const scanWifi = () => call('scan', async () => { wifi.value = await api('GET', '/hardware/network/wifi') })
async function connectWifi() {
  const j = join.value
  if (await call('join', () => post('/hardware/network/wifi', { ssid: j.ssid, password: j.password || undefined, hidden: j.hidden }), t('hw.connected', { ssid: j.ssid })) !== undefined) {
    join.value = null
    await load()
    await scanWifi()
  }
}
async function forgetConn(c) {
  if (!confirm(t('hw.confirm_forget', { name: c.name }))) return
  await call('', () => api('DELETE', `/hardware/network/connections/${c.uuid}`))
  await load()
}
const bars = s => '▂▄▆█'.slice(0, Math.max(1, Math.ceil(s / 25)))
const btAction = async (action, address) => { await call(action + address, () => post(`/hardware/bluetooth/${action}`, { address })); data.value = await api('GET', '/hardware/bluetooth') }
const btScan = () => call('btscan', async () => { data.value = await post('/hardware/bluetooth/scan') })
const BT_ICONS = { 'audio-card': '🔊', 'audio-headphones': '🎧', 'audio-headset': '🎧', 'input-keyboard': '⌨', 'input-mouse': '🖱', 'input-gaming': '🎮', phone: '📱', computer: '💻' }

let volTimer = null
function setVolume(item, value) {
  item.volume = Number(value)
  clearTimeout(volTimer)
  volTimer = setTimeout(() => call('', () => post('/hardware/audio/volume', { id: item.id, value: item.volume })), 150)
}
const toggleMute = item => call('', async () => { await post('/hardware/audio/mute', { id: item.id, muted: !item.muted }); item.muted = !item.muted })
const setDefault = async item => { await call('', () => post('/hardware/audio/default', { id: item.id })); data.value = await api('GET', '/hardware/audio') }
function testTone() {
  const ctx = new AudioContext()
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  g.gain.value = 0.2
  o.frequency.value = 660
  o.connect(g).connect(ctx.destination)
  o.start()
  o.stop(ctx.currentTime + 0.6)
}

let brTimer = null
function setBrightness(p, value) {
  p.brightness = Number(value)
  clearTimeout(brTimer)
  brTimer = setTimeout(() => call('', () => post('/hardware/display/brightness', { id: p.id, value: p.brightness })), 150)
}
const rotate = (o, transform) => call('rot', async () => { await post('/hardware/display/output', { name: o.name, transform }); o.transform = transform })
const saveDisplay = () => call('dset', async () => { hw.info.display = await api('PUT', '/hardware/display/settings', { idle: Number(displaySettings.value.idle) || 0, dim: Number(displaySettings.value.dim) || 0 }) }, t('plugins.saved'))
async function screenOffTest() {
  await call('', () => post('/hardware/display/power', { on: false }))
  setTimeout(() => post('/hardware/display/power', { on: true }).catch(() => {}), 3000)
}

const power = action => { if (confirm(t('hw.confirm_' + action.replace('-', '_')))) call('power', () => post('/hardware/power', { action }), t('hw.power_sent')) }
const checkUpdate = () => call('upd', () => post('/hardware/update/check'), t('hw.update_started'))
const saveUpdate = () => call('updset', () => api('PUT', '/hardware/update', data.value.settings), t('plugins.saved'))
</script>

<template>
  <div class="hw">
    <p v-if="err" class="err">{{ err }}</p>
    <p v-if="msg" class="msg">{{ msg }}</p>

    <template v-if="section === 'display'">
      <h3>{{ t('hw.scale') }}</h3>
      <div class="slider">
        <input type="range" min="50" max="150" step="5" :value="scale" @change="applyScale($event.target.value)">
        <b>{{ scale }} %</b>
        <button class="btn" @click="resetScale(); scale = Math.round(getScale() * 100)">{{ t('hw.scale_reset') }}</button>
      </div>
      <p class="hint">{{ t('hw.scale_hint') }}</p>
      <h3>{{ t('hw.idle_title') }}</h3>
      <div class="two">
        <div class="field"><label>{{ t('hw.idle') }}</label><input v-model="displaySettings.idle" type="number" min="0" max="1440" :disabled="!canManage"></div>
        <div class="field"><label>{{ t('hw.dim') }}</label><input v-model="displaySettings.dim" type="number" min="0" max="100" :disabled="!canManage"></div>
      </div>
      <button v-if="canManage" class="btn" @click="saveDisplay">{{ t('common.save') }}</button>
    </template>

    <p v-if="hw.info && !hw.info.device && section === 'update'" class="hint">🐳 {{ t('hw.docker_update') }}</p>
    <p v-else-if="hw.info && !hw.info.device" class="hint">{{ t('hw.not_device') }}</p>
    <p v-else-if="!data && busy === 'load'" class="hint">…</p>

    <template v-if="data && section === 'display'">
      <h3>{{ t('hw.brightness') }}</h3>
      <p v-if="!data.panels.length" class="hint">{{ t('hw.no_panels') }}</p>
      <div v-for="p in data.panels" :key="p.id" class="slider">
        <span class="nm">{{ p.name }}</span>
        <input type="range" min="1" max="100" :value="p.brightness ?? 0" :disabled="!p.writable" @input="setBrightness(p, $event.target.value)">
        <b>{{ p.brightness ?? '—' }} %</b>
      </div>
      <button class="btn" @click="screenOffTest">◐ {{ t('hw.off_test') }}</button>
      <template v-if="data.outputs.length">
        <h3>{{ t('hw.outputs') }}</h3>
        <div v-for="o in data.outputs" :key="o.name" class="out">
          <b>{{ o.name }}</b> <small>{{ o.description }} · {{ o.mode ? `${o.mode.width}×${o.mode.height}` : '' }}</small>
          <div class="seg">
            <button v-for="tr in ['normal', '90', '180', '270']" :key="tr" class="btn" :class="{ active: o.transform === tr }" :disabled="!canManage" @click="rotate(o, tr)">{{ tr === 'normal' ? '0°' : tr + '°' }}</button>
          </div>
        </div>
      </template>
    </template>

    <template v-if="data && section === 'network'">
      <div v-for="dv in data.devices" :key="dv.device" class="row card">
        <span class="ico">{{ dv.type === 'wifi' ? '📶' : '🖧' }}</span>
        <div class="grow"><b>{{ dv.connection || dv.device }}</b><small>{{ t('hw.state.' + dv.state.split(' ')[0], dv.state) }} · {{ dv.ip?.join(', ') || '—' }}{{ dv.gateway ? ' · GW ' + dv.gateway : '' }}</small><small>{{ dv.device }} · {{ dv.mac }}</small></div>
      </div>
      <template v-if="data.managed && canManage">
        <h3>WLAN</h3>
        <div class="row">
          <label class="chk"><input type="checkbox" :checked="data.wifiEnabled" @change="call('', () => post('/hardware/network/radio', { on: $event.target.checked }))"> {{ t('hw.wifi_on') }}</label>
          <span class="grow" />
          <button class="btn" :disabled="busy === 'scan'" @click="scanWifi">{{ busy === 'scan' ? '…' : '⟳ ' + t('hw.scan') }}</button>
          <button class="btn" @click="join = { ssid: '', password: '', hidden: true }">＋ {{ t('hw.hidden') }}</button>
        </div>
        <div v-for="n in wifi ?? []" :key="n.ssid" class="row net" :class="{ on: n.active }" @click="!n.active && (join = { ssid: n.ssid, password: '', secure: n.secure })">
          <span class="sig">{{ bars(n.signal) }}</span>
          <div class="grow"><b>{{ n.ssid }}</b><small>{{ n.band }} · {{ n.secure ? '🔒 ' + n.security : t('hw.open') }}</small></div>
          <span v-if="n.active" class="msg">✓ {{ t('hw.connected_short') }}</span>
        </div>
        <form v-if="join" class="card join" @submit.prevent="connectWifi">
          <div v-if="join.hidden" class="field"><label>SSID</label><input v-model="join.ssid" required maxlength="64"></div>
          <b v-else>{{ join.ssid }}</b>
          <div v-if="join.secure || join.hidden" class="field"><label>{{ t('hw.password') }}</label><input v-model="join.password" type="password" autocomplete="off" maxlength="128"></div>
          <div class="row"><button type="button" class="btn" @click="join = null">{{ t('common.cancel') }}</button><span class="grow" /><button class="btn primary" :disabled="busy === 'join'">{{ busy === 'join' ? '…' : t('hw.connect') }}</button></div>
        </form>
        <h3>{{ t('hw.saved') }}</h3>
        <div v-for="c in data.saved" :key="c.uuid" class="row">
          <div class="grow"><b>{{ c.name }}</b><small>{{ c.type }}</small></div>
          <button class="btn" @click="forgetConn(c)">{{ t('hw.forget') }}</button>
        </div>
        <h3>{{ t('hw.hostname') }}</h3>
        <form class="row" @submit.prevent="call('', () => post('/hardware/network/hostname', { name: hostname }), t('plugins.saved'))">
          <input v-model="hostname" class="grow" pattern="[A-Za-z0-9-]{1,63}"><button class="btn">{{ t('common.save') }}</button>
        </form>
        <small class="hint">{{ t('hw.hostname_hint', { name: hostname }) }}</small>
      </template>
    </template>

    <template v-if="data && section === 'bluetooth'">
      <p v-if="!data.available" class="hint">{{ t('hw.no_bt') }}</p>
      <template v-else>
        <div class="row">
          <label class="chk"><input type="checkbox" :checked="data.powered" :disabled="!canManage" @change="call('', () => post('/hardware/bluetooth/power', { on: $event.target.checked })).then(load)"> {{ t('hw.bt_on') }}</label>
          <span class="grow" />
          <button v-if="canManage" class="btn" :disabled="busy === 'btscan' || !data.powered" @click="btScan">{{ busy === 'btscan' ? t('hw.scanning') : '⟳ ' + t('hw.scan') }}</button>
        </div>
        <div v-for="dv in data.devices" :key="dv.address" class="row card">
          <span class="ico">{{ BT_ICONS[dv.icon] ?? '◈' }}</span>
          <div class="grow"><b>{{ dv.name }}</b><small>{{ dv.connected ? t('hw.connected_short') : dv.paired ? t('hw.paired') : t('hw.new') }}{{ dv.battery ? ' · 🔋 ' + dv.battery + ' %' : '' }}{{ dv.rssi ? ' · ' + dv.rssi + ' dBm' : '' }}</small></div>
          <template v-if="canManage">
            <button v-if="!dv.paired" class="btn primary" :disabled="!!busy" @click="btAction('pair', dv.address)">{{ busy === 'pair' + dv.address ? '…' : t('hw.pair') }}</button>
            <button v-else-if="!dv.connected" class="btn" :disabled="!!busy" @click="btAction('connect', dv.address)">{{ t('hw.connect') }}</button>
            <button v-else class="btn" :disabled="!!busy" @click="btAction('disconnect', dv.address)">{{ t('hw.disconnect') }}</button>
            <button v-if="dv.paired" class="btn icon" :aria-label="t('hw.forget')" @click="btAction('remove', dv.address)">✕</button>
          </template>
        </div>
      </template>
    </template>

    <template v-if="data && section === 'audio'">
      <p v-if="!data.available" class="hint">{{ t('hw.no_audio') }}</p>
      <template v-else>
        <h3>{{ t('hw.outputs_audio') }}</h3>
        <div v-for="s in data.sinks" :key="s.id" class="slider">
          <button class="btn icon" :class="{ active: s.default }" :title="t('hw.default')" @click="setDefault(s)">{{ s.default ? '●' : '○' }}</button>
          <span class="nm">{{ s.name }}</span>
          <button class="btn icon" @click="toggleMute(s)">{{ s.muted ? '🔇' : '🔊' }}</button>
          <input type="range" min="0" max="100" :value="s.volume ?? 0" @input="setVolume(s, $event.target.value)">
          <b>{{ s.volume }} %</b>
        </div>
        <button class="btn" @click="testTone">♪ {{ t('hw.test_tone') }}</button>
        <h3>{{ t('hw.inputs_audio') }}</h3>
        <div v-for="s in data.sources" :key="s.id" class="slider">
          <button class="btn icon" :class="{ active: s.default }" @click="setDefault(s)">{{ s.default ? '●' : '○' }}</button>
          <span class="nm">{{ s.name }}</span>
          <button class="btn icon" @click="toggleMute(s)">{{ s.muted ? '🔇' : '🎙' }}</button>
          <input type="range" min="0" max="100" :value="s.volume ?? 0" @input="setVolume(s, $event.target.value)">
          <b>{{ s.volume }} %</b>
        </div>
      </template>
    </template>

    <template v-if="data && section === 'update'">
      <div class="card">
        <div class="label">{{ t('hw.installed') }}</div>
        <div class="big">v{{ data.version }}</div>
        <small v-if="data.state">{{ t('hw.update_state.' + data.state.status, data.state.status) }}{{ data.state.available ? ' · ' + t('hw.available', { v: data.state.available }) : '' }}{{ data.state.checked ? ' · ' + d(new Date(data.state.checked), 'long') : '' }}</small>
        <small v-if="data.state?.error" class="err">{{ data.state.error }}</small>
        <small v-if="data.state?.rolled_back" class="err">{{ t('hw.rolled_back', { v: data.state.rolled_back }) }}</small>
        <pre v-if="data.state?.log" class="log">{{ data.state.log }}</pre>
      </div>
      <template v-if="canManage && data.device">
        <div class="two">
          <div class="field"><label>{{ t('hw.channel') }}</label><select v-model="data.settings.channel"><option value="stable">stable</option><option value="beta">beta</option></select></div>
          <div class="field"><label>{{ t('hw.auto') }}</label><label class="chk"><input v-model="data.settings.auto" type="checkbox"> {{ t('plugins.on') }}</label></div>
        </div>
        <div class="row"><button class="btn" @click="saveUpdate">{{ t('common.save') }}</button><span class="grow" /><button class="btn primary" :disabled="busy === 'upd'" @click="checkUpdate">⇣ {{ t('hw.update_now') }}</button></div>
        <h3>{{ t('hw.power') }}</h3>
        <div class="row">
          <button class="btn" @click="power('restart-ui')">⟳ {{ t('hw.restart_ui') }}</button>
          <button class="btn" @click="power('reboot')">↻ {{ t('hw.reboot') }}</button>
          <button class="btn danger" @click="power('poweroff')">⏻ {{ t('hw.poweroff') }}</button>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.hint { color: var(--dim); }
.msg { color: var(--cyan); }
.err { color: var(--err); display: block; }
h3 { margin: 22px 0 10px; font-weight: 400; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.row { display: flex; gap: 12px; align-items: center; padding: 8px 0; flex-wrap: wrap; }
.row small, .card small { display: block; color: var(--dim); }
.grow { flex: 1; min-width: 0; }
.card { padding: 12px 14px; border: 1px solid var(--line); background: rgba(2, 6, 23, .4); margin-bottom: 8px; }
.ico { font-size: 26px; width: 36px; text-align: center; }
.net { border-bottom: 1px solid var(--line); cursor: pointer; }
.net.on b { color: var(--cyan); }
.sig { font-family: var(--mono); color: var(--cyan); width: 40px; }
.join { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.slider { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
.slider .nm { width: 34%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slider input { flex: 1; }
.slider b { width: 56px; text-align: right; font-weight: 400; }
.seg { display: flex; gap: 6px; margin-top: 8px; }
.out { margin-bottom: 14px; }
.out small { color: var(--dim); }
.chk { display: flex; gap: 8px; align-items: center; }
.big { font-family: var(--mono); font-size: 30px; margin: 4px 0; }
.log { font-size: 11px; color: var(--dim); white-space: pre-wrap; max-height: 160px; overflow: auto; margin: 6px 0 0; }
.label { color: var(--dim); font-size: 12px; letter-spacing: .15em; text-transform: uppercase; }
</style>
