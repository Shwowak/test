<script setup>
import { computed, ref, onMounted, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { errorText } from '../../i18n.js'
import { loadFeatures, applyTheme, features } from '../../features.js'

const { t, d } = useI18n()
const user = inject('user')
const canEdit = () => user.value?.permissions?.includes('users.manage')
const s = ref(null)
const msg = ref('')
const zones = Intl.supportedValuesOf?.('timeZone') ?? []
const users = ref([])
const auto = ref({ user_id: null, scope: 'device' })
const feats = ref({ automations: false, control: true, assistant: true, cameras: true })
const adminTimeout = ref(10)
const netCode = ref('')

async function load() {
  s.value = await api('GET', '/settings')
  auto.value = { user_id: s.value.autologin?.user_id ?? null, scope: s.value.autologin?.scope ?? 'device' }
  feats.value = { ...feats.value, ...s.value.features }
  adminTimeout.value = s.value.admin_timeout ?? 10
  netCode.value = s.value.network_code ?? ''
  if (canEdit()) users.value = await api('GET', '/users').catch(() => [])
}
onMounted(load)

async function setTheme(v) {
  s.value.theme = v
  applyTheme(v)
  await api('PUT', '/settings', { theme: v }).catch(e => { msg.value = errorText(e) })
}

async function setFx(v) {
  s.value.fx = v
  features.fx = v
  await api('PUT', '/settings', { fx: v }).catch(e => { msg.value = errorText(e) })
}

const openAccess = computed(() => !!auto.value.user_id && users.value.find(u => u.id === auto.value.user_id)?.role === 'admin')
function setOpen(on) {
  const target = on ? users.value.find(u => u.role === 'admin' && !u.disabled) : users.value.find(u => u.name === 'anzeige') ?? users.value.find(u => u.role === 'guest')
  auto.value = { user_id: target?.id ?? null, scope: 'lan' }
  if (on) adminTimeout.value = 0
  else if (!Number(adminTimeout.value)) adminTimeout.value = 10
}

async function save() {
  msg.value = ''
  try {
    await api('PUT', '/settings', { features: feats.value, admin_timeout: Number(adminTimeout.value) || 0, network_code: netCode.value, autologin: auto.value.user_id ? auto.value : null, timezone: s.value.timezone, location: { name: s.value.location.name ?? '', lat: Number(s.value.location.lat), lon: Number(s.value.location.lon) } })
    await load()
    await loadFeatures()
    msg.value = t('general.saved')
  } catch (e) { msg.value = errorText(e) }
}
function locate() {
  navigator.geolocation?.getCurrentPosition(p => {
    s.value.location.lat = Math.round(p.coords.latitude * 1e4) / 1e4
    s.value.location.lon = Math.round(p.coords.longitude * 1e4) / 1e4
  })
}
</script>

<template>
  <form v-if="s" @submit.prevent="save">
    <div class="field"><label>{{ t('general.place') }}</label><input v-model="s.location.name" :disabled="!canEdit()"></div>
    <div class="two">
      <div class="field"><label>{{ t('general.lat') }}</label><input v-model="s.location.lat" type="number" step="any" min="-90" max="90" required :disabled="!canEdit()"></div>
      <div class="field"><label>{{ t('general.lon') }}</label><input v-model="s.location.lon" type="number" step="any" min="-180" max="180" required :disabled="!canEdit()"></div>
    </div>
    <div class="field">
      <label>{{ t('general.timezone') }}</label>
      <select v-model="s.timezone" :disabled="!canEdit()"><option v-for="z in zones" :key="z" :value="z">{{ z }}</option></select>
    </div>
    <p class="sun">☀ {{ t('general.sunrise') }} {{ s.sun.sunrise ? d(new Date(s.sun.sunrise), 'long') : '—' }}<br>☾ {{ t('general.sunset') }} {{ s.sun.sunset ? d(new Date(s.sun.sunset), 'long') : '—' }}</p>
    <template v-if="canEdit()">
      <h3>{{ t('general.theme') }}</h3>
      <div class="row">
        <button v-for="v in ['apple', 'neon']" :key="v" type="button" class="btn" :class="{ active: (s.theme ?? 'apple') === v }" @click="setTheme(v)">{{ t('general.themes.' + v) }}</button>
      </div>
      <h3>{{ t('general.fx') }}</h3>
      <div class="row">
        <button v-for="v in ['off', 'particles', 'circuit', 'both']" :key="v" type="button" class="btn" :class="{ active: (s.fx ?? 'particles') === v }" @click="setFx(v)">{{ t('general.fxs.' + v) }}</button>
      </div>
      <h3>{{ t('general.features') }}</h3>
      <p class="sun">{{ t('general.features_hint') }}</p>
      <label v-for="k in ['control', 'automations', 'assistant', 'cameras']" :key="k" class="chk"><input v-model="feats[k]" type="checkbox"> {{ t('general.feature.' + k) }}</label>
      <h3>{{ t('general.autologin') }}</h3>
      <label class="chk"><input type="checkbox" :checked="openAccess" @change="setOpen($event.target.checked)"> {{ t('general.open_access') }}</label>
      <p v-if="openAccess" class="warn">⚠ {{ t('general.open_access_warn') }}</p>
      <div class="field"><label>{{ t('general.network_code') }}</label><input v-model="netCode" type="text" maxlength="64" autocomplete="off" :placeholder="t('general.network_code_ph')"></div>
      <div class="field"><label>{{ t('general.admin_timeout') }}</label><input v-model="adminTimeout" type="number" min="0" max="1440"></div>
      <div class="two">
        <div class="field">
          <label>{{ t('general.autologin_user') }}</label>
          <select v-model="auto.user_id"><option :value="null">{{ t('general.autologin_off') }}</option><option v-for="u in users" :key="u.id" :value="u.id">{{ u.display_name || u.name }} ({{ t('roles.' + u.role) }})</option></select>
        </div>
        <div class="field">
          <label>{{ t('general.autologin_scope') }}</label>
          <select v-model="auto.scope" :disabled="!auto.user_id"><option value="device">{{ t('general.scope_device') }}</option><option value="lan">{{ t('general.scope_lan') }}</option></select>
        </div>
      </div>
      <p v-if="auto.user_id && auto.scope === 'lan' && users.find(u => u.id === auto.user_id)?.role === 'admin'" class="warn">⚠ {{ t('general.autologin_warn') }}</p>
    </template>
    <div v-if="canEdit()" class="row">
      <button type="button" class="btn" @click="locate">⌖ {{ t('general.locate') }}</button>
      <span class="grow" />
      <button class="btn primary">{{ t('common.save') }}</button>
    </div>
    <p v-if="msg" class="msg">{{ msg }}</p>
  </form>
</template>

<style scoped>
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.sun { color: var(--dim); line-height: 1.8; }
.row { display: flex; gap: 12px; }
.grow { flex: 1; }
.msg { color: var(--cyan); }
.warn { color: var(--warn); }
h3 { font-weight: 400; margin: 22px 0 8px; }
.chk { display: flex; gap: 10px; align-items: center; padding: 5px 0; }
</style>
