<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api.js'
import { errorText, setLocale, LOCALE_NAMES } from '../i18n.js'
import BtSetup from './BtSetup.vue'
import SetupWizard from './SetupWizard.vue'

const { t, locale } = useI18n()
const emit = defineEmits(['login'])
const mode = ref('password')
const name = ref('admin')
const password = ref('')
const pin = ref('')
const pinUsers = ref([])
const error = ref('')
const busy = ref(false)

const setup = ref(null)
const btAvailable = ref(false)
const showBt = ref(false)
const setupForm = ref({ name: 'admin', password: '', password2: '', pin: '' })

async function doSetup() {
  error.value = ''
  const f = setupForm.value
  if (f.password !== f.password2) { error.value = t('setup.mismatch'); return }
  busy.value = true
  try {
    emit('login', await api('POST', '/auth/setup', { name: f.name, password: f.password, pin: f.pin || undefined }))
  } catch (e) {
    error.value = errorText(e)
  } finally { busy.value = false }
}

onMounted(async () => {
  try { const s = await api('GET', '/auth/setup'); if (s.needed) setup.value = s } catch {}
  pollBt()
  try {
    pinUsers.value = await api('GET', '/auth/pin-users')
    if (pinUsers.value.length) {
      mode.value = 'pin'
      name.value = pinUsers.value[0].name
    }
  } catch {}
  await nextTick()
  focusFirst()
  window.addEventListener('keydown', onKey)
})

const btAuto = ref(null)
let btTimer = null
async function pollBt() {
  try {
    const r = await api('GET', '/setup/bluetooth')
    btAvailable.value = r.available
    btAuto.value = r.auto
    const kb = r.devices?.find(d => d.input && d.connected)
    if (kb && btAuto.value) btAuto.value.connected = kb.name
  } catch { btAvailable.value = false; return }
  btTimer = setTimeout(pollBt, 3000)
}
onBeforeUnmount(() => { clearTimeout(btTimer); window.removeEventListener('keydown', onKey) })

function focusFirst() {
  const el = document.querySelector(setup.value ? '#sp' : mode.value === 'password' ? '#p' : null)
  el?.focus()
}
function onKey(e) {
  if (setup.value || mode.value !== 'pin' || e.target.tagName === 'INPUT') return
  if (/^[0-9]$/.test(e.key)) press(e.key)
  else if (e.key === 'Backspace') press('⌫')
  else if (e.key === 'Enter') submit()
}

async function submit() {
  busy.value = true
  error.value = ''
  try {
    const body = mode.value === 'pin' ? { name: name.value, pin: pin.value } : { name: name.value, password: password.value }
    emit('login', await api('POST', '/auth/login', body))
  } catch (e) {
    error.value = errorText(e)
    pin.value = ''
  } finally {
    busy.value = false
  }
}

function press(d) {
  if (d === '⌫') pin.value = pin.value.slice(0, -1)
  else if (pin.value.length < 8) pin.value += d
}
</script>

<template>
  <main class="wrap">
    <div class="card">
      <div class="logo">
        <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
          <path d="M8 32h12l6-10h12l6 10h12M20 32v14h24V32M32 8v14M26 46v10M38 46v10" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="32" cy="8" r="3" fill="#22d3ee"/><circle cx="8" cy="32" r="3" fill="#22d3ee"/><circle cx="56" cy="32" r="3" fill="#22d3ee"/>
        </svg>
        <h1>{{ t('app.name') }}</h1>
      </div>

      <p v-if="btAuto?.active || btAuto?.connected" class="btstat" :class="{ ok: btAuto.connected }">
        {{ btAuto.connected ? '✓ ' + t('btsetup.auto_ok', { name: btAuto.connected }) : '⌨ ' + t('btsetup.auto_search') }}
      </p>
      <SetupWizard v-if="setup" :local="setup.local" @login="u => emit('login', u)" />

      <form v-else @submit.prevent="submit()">
      <div class="tabs">
        <button type="button" class="btn" :class="{ active: mode === 'pin' }" :disabled="!pinUsers.length" @click="mode = 'pin'">{{ t('login.pin') }}</button>
        <button type="button" class="btn" :class="{ active: mode === 'password' }" @click="mode = 'password'">{{ t('login.password') }}</button>
      </div>

      <template v-if="mode === 'pin'">
        <div class="users">
          <button v-for="u in pinUsers" :key="u.name" type="button" class="btn" :class="{ active: name === u.name }" @click="name = u.name; pin = ''">{{ u.display_name }}</button>
        </div>
        <div class="dots" aria-live="polite">
          <span v-for="i in Math.max(4, pin.length)" :key="i" :class="{ on: i <= pin.length }" />
        </div>
        <div class="pad">
          <button v-for="d in ['1','2','3','4','5','6','7','8','9','⌫','0','✓']" :key="d" type="button" class="btn key"
            :class="{ primary: d === '✓' }" :disabled="busy" @click="d === '✓' ? submit() : press(d)">{{ d }}</button>
        </div>
      </template>

      <template v-else>
        <div class="field"><label for="u">{{ t('login.user') }}</label><input id="u" v-model="name" autocomplete="username"></div>
        <div class="field"><label for="p">{{ t('login.password') }}</label><input id="p" v-model="password" type="password" autocomplete="current-password"></div>
        <button class="btn primary full" :disabled="busy">{{ t('login.submit') }}</button>
      </template>
      <p v-if="error" class="error">{{ error }}</p>
      </form>

      <button v-if="btAvailable" type="button" class="btn full bt" @click="showBt = !showBt">⌨ {{ t('btsetup.button') }}</button>
      <BtSetup v-if="showBt" class="btpanel" @close="showBt = false" />

      <select class="lang" :value="locale" :aria-label="t('settings.language')" @change="setLocale($event.target.value)">
        <option v-for="(n, k) in LOCALE_NAMES" :key="k" :value="k">{{ n }}</option>
      </select>
    </div>
  </main>
</template>

<style scoped>
.wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.card { width: min(440px, 100%); padding: 32px; border-radius: 24px; border: 1px solid var(--line); background: var(--glass); backdrop-filter: blur(16px); box-shadow: 0 0 60px rgba(34, 211, 238, 0.08); }
.logo { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-bottom: 22px; }
.logo svg { filter: drop-shadow(0 0 10px rgba(245, 158, 11, 0.6)); }
h1 { margin: 0; font-size: 26px; letter-spacing: 0.25em; font-weight: 300; }
.tabs, .users { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.tabs .btn { flex: 1; }
.dots { display: flex; justify-content: center; gap: 14px; margin: 8px 0 18px; }
.dots span { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--line-strong); }
.dots span.on { background: var(--cyan); box-shadow: 0 0 10px var(--cyan); }
.pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.key { min-height: 64px; font-size: 26px; font-family: var(--mono); }
.full { width: 100%; }
.bt { margin-top: 14px; }
.btstat { text-align: center; padding: 10px; border: 1px dashed var(--line-strong); color: var(--cyan); font-size: 15px; animation: btp 2s infinite; }
.btstat.ok { color: var(--ok); border-color: var(--ok); animation: none; }
@keyframes btp { 50% { opacity: .55; } }
.btpanel { margin-top: 12px; padding: 12px; border: 1px solid var(--line); }
.st { font-weight: 300; text-align: center; margin: 0 0 8px; }
.hint { color: var(--dim); text-align: center; }
.lang { margin-top: 18px; width: 100%; min-height: 44px; background: transparent; border: 1px solid var(--line); border-radius: 10px; padding: 0 10px; color: var(--dim); }
</style>
