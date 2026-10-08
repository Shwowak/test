<script setup>
import { ref, onMounted, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { errorText } from '../../i18n.js'

const { t, d } = useI18n()
const user = inject('user')
const canEdit = () => user.value?.permissions?.includes('users.manage')
const s = ref(null)
const msg = ref('')
const zones = Intl.supportedValuesOf?.('timeZone') ?? []

async function load() { s.value = await api('GET', '/settings') }
onMounted(load)

async function save() {
  msg.value = ''
  try {
    await api('PUT', '/settings', { timezone: s.value.timezone, location: { name: s.value.location.name ?? '', lat: Number(s.value.location.lat), lon: Number(s.value.location.lon) } })
    await load()
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
</style>
