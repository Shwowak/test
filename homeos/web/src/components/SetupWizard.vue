<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api.js'
import { errorText } from '../i18n.js'

const props = defineProps({ local: Boolean })
const emit = defineEmits(['login'])
const { t } = useI18n()
const info = ref(null)
const step = ref('loading')
const code = ref('')
const nets = ref(null)
const join = ref(null)
const busy = ref('')
const err = ref('')
const form = ref({ name: 'admin', password: '', password2: '', pin: '' })
let timer = null

const hdr = () => (code.value ? { 'x-setup-code': code.value } : {})
async function call(method, path, body) {
  const r = await fetch(`/api/v1${path}`, { method, headers: { 'content-type': 'application/json', ...hdr() }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(data.error), { code: data.error, details: data.details })
  return data
}

async function refresh() {
  try { info.value = await api('GET', '/setup/info') } catch { info.value = { device: false } }
}

onMounted(async () => {
  await refresh()
  if (!props.local && info.value.device) step.value = 'code'
  else if (info.value.device && !info.value.online) { step.value = 'network'; scan() }
  else step.value = 'account'
  timer = setInterval(refresh, 5000)
  focus()
})
onBeforeUnmount(() => clearInterval(timer))

const focus = () => nextTick(() => (document.querySelector('.wiz #sp') ?? document.querySelector('.wiz input:not([type=checkbox])') ?? document.querySelector('.wiz .net'))?.focus())
function arrows(e) {
  if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return
  const list = [...document.querySelectorAll('.wiz .net')]
  const i = list.indexOf(document.activeElement)
  list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  e.preventDefault()
}

async function checkCode() {
  err.value = ''
  busy.value = 'code'
  try {
    const st = await call('GET', '/setup/network')
    step.value = st.online ? 'account' : 'network'
    if (!st.online) scan()
    focus()
  } catch (e) { err.value = errorText(e) } finally { busy.value = '' }
}

async function scan() {
  busy.value = 'scan'
  err.value = ''
  try { nets.value = await call('GET', '/setup/network/wifi') } catch (e) { err.value = errorText(e) } finally { busy.value = ''; focus() }
}
function pick(n) {
  join.value = { ssid: n.ssid, password: '', secure: n.secure }
  focus()
}
async function connect() {
  busy.value = 'join'
  err.value = ''
  try {
    await call('POST', '/setup/network/wifi', { ssid: join.value.ssid, password: join.value.password || undefined, code: code.value || undefined })
    join.value = null
    await refresh()
    step.value = 'account'
    focus()
  } catch (e) {
    err.value = errorText(e) + (e.details?.message ? ` – ${e.details.message}` : '')
  } finally { busy.value = '' }
}
function skip() { step.value = 'account'; focus() }

async function create() {
  err.value = ''
  const f = form.value
  if (f.password !== f.password2) { err.value = t('setup.mismatch'); return }
  busy.value = 'account'
  try {
    emit('login', await call('POST', '/auth/setup', { name: f.name, password: f.password, pin: f.pin || undefined, code: code.value || undefined }))
  } catch (e) { err.value = errorText(e) } finally { busy.value = '' }
}

const bars = s => '▂▄▆█'.slice(0, Math.max(1, Math.ceil(s / 25)))
const stepNo = computed(() => ({ code: 0, network: 1, account: 2 })[step.value] ?? 0)
</script>

<template>
  <div class="wiz">
    <h2 class="st">{{ t('setup.title') }}</h2>
    <div v-if="info?.device && step !== 'code'" class="steps">
      <span :class="{ on: stepNo === 1, done: stepNo > 1 }">1 · {{ t('setup.step_network') }}</span>
      <span :class="{ on: stepNo === 2 }">2 · {{ t('setup.step_account') }}</span>
    </div>

    <form v-if="step === 'code'" @submit.prevent="checkCode">
      <p class="hint">{{ t('setup.code_hint') }}</p>
      <div class="field"><label>{{ t('setup.code') }}</label><input v-model="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" class="big"></div>
      <button class="btn primary full" :disabled="code.length !== 6 || busy === 'code'">{{ t('setup.next') }}</button>
    </form>

    <template v-else-if="step === 'network'">
      <p class="hint">{{ t('setup.network_hint') }}</p>
      <form v-if="join" class="join" @submit.prevent="connect">
        <b>📶 {{ join.ssid }}</b>
        <div v-if="join.secure" class="field"><label>{{ t('hw.password') }}</label><input v-model="join.password" type="password" autocomplete="off" maxlength="128"></div>
        <div class="row">
          <button type="button" class="btn" @click="join = null">{{ t('common.cancel') }}</button>
          <span class="grow" />
          <button class="btn primary" :disabled="busy === 'join'">{{ busy === 'join' ? t('setup.connecting') : t('hw.connect') }}</button>
        </div>
      </form>
      <template v-else>
        <div class="nets" @keydown="arrows">
          <button v-for="n in nets ?? []" :key="n.ssid" type="button" class="net" @click="pick(n)">
            <span class="sig">{{ bars(n.signal) }}</span><span class="grow">{{ n.ssid }}</span><span>{{ n.secure ? '🔒' : '' }}</span>
          </button>
          <p v-if="busy === 'scan'" class="hint">{{ t('hw.scanning') }}</p>
          <p v-else-if="nets && !nets.length" class="hint">{{ t('setup.no_networks') }}</p>
        </div>
        <div class="row">
          <button type="button" class="btn" :disabled="busy === 'scan'" @click="scan">⟳ {{ t('hw.scan') }}</button>
          <span class="grow" />
          <button type="button" class="btn" @click="skip">{{ t('setup.skip') }}</button>
        </div>
      </template>
    </template>

    <form v-else-if="step === 'account'" @submit.prevent="create">
      <p class="hint">{{ t('setup.hint') }}</p>
      <div class="field"><label>{{ t('login.user') }}</label><input v-model="form.name" required maxlength="40"></div>
      <div class="field"><label>{{ t('login.password') }}</label><input id="sp" v-model="form.password" type="password" required autocomplete="new-password"></div>
      <div class="field"><label>{{ t('setup.repeat') }}</label><input v-model="form.password2" type="password" required autocomplete="new-password"></div>
      <div class="field"><label>{{ t('setup.pin') }}</label><input v-model="form.pin" inputmode="numeric" pattern="[0-9]{4,8}" autocomplete="off"></div>
      <button class="btn primary full" :disabled="busy === 'account'">{{ t('setup.submit') }}</button>
    </form>

    <p v-if="err" class="err">{{ err }}</p>

    <div v-if="local && info?.device && info.needed" class="remote">
      <div class="rt">📱 {{ t('setup.remote_title') }}</div>
      <template v-if="info.hotspot">
        <div>{{ t('setup.remote_hotspot') }}</div>
        <div class="kv"><span>WLAN</span><b>{{ info.hotspot.ssid }}</b></div>
        <div class="kv"><span>{{ t('hw.password') }}</span><b>{{ info.hotspot.password }}</b></div>
        <div class="kv"><span>{{ t('setup.open') }}</span><b>{{ info.hotspot.url }}</b></div>
      </template>
      <div v-else-if="info.online" class="kv"><span>{{ t('setup.open') }}</span><b>{{ info.urls.join('  ·  ') }}</b></div>
      <div class="kv"><span>{{ t('setup.code') }}</span><b class="code">{{ info.code }}</b></div>
    </div>
  </div>
</template>

<style scoped>
.st { font-weight: 300; text-align: center; margin: 0 0 8px; }
.steps { display: flex; justify-content: center; gap: 14px; font-size: 13px; letter-spacing: .1em; color: var(--dim); margin-bottom: 12px; }
.steps .on { color: var(--cyan); }
.steps .done { color: var(--ok); }
.hint { color: var(--dim); text-align: center; }
.full { width: 100%; }
.big { font-size: 28px; letter-spacing: .4em; text-align: center; font-family: var(--mono); }
.nets { max-height: 40vh; overflow-y: auto; margin-bottom: 10px; }
.net { display: flex; gap: 12px; width: 100%; align-items: center; padding: 12px 10px; background: none; border: 0; border-bottom: 1px solid var(--line); color: var(--text); font-size: 17px; text-align: left; cursor: pointer; }
.net:focus { outline: 2px solid var(--cyan); }
.sig { font-family: var(--mono); color: var(--cyan); width: 40px; }
.grow { flex: 1; min-width: 0; }
.row { display: flex; gap: 10px; align-items: center; }
.join { display: flex; flex-direction: column; gap: 10px; }
.err { color: var(--err); text-align: center; }
.remote { margin-top: 18px; padding: 12px 14px; border: 1px dashed var(--line-strong); font-size: 14px; color: var(--dim); }
.rt { color: var(--text); margin-bottom: 6px; }
.kv { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; }
.kv b { color: var(--text); font-weight: 500; text-align: right; word-break: break-all; }
.code { font-family: var(--mono); font-size: 20px; letter-spacing: .25em; color: var(--cyan) !important; }
</style>
