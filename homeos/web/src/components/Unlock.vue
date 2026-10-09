<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api.js'
import { errorText } from '../i18n.js'

const emit = defineEmits(['unlocked'])
const { t } = useI18n()
const pinUsers = ref([])
const mode = ref('password')
const name = ref('admin')
const password = ref('')
const pin = ref('')
const err = ref('')
const busy = ref(false)

onMounted(async () => {
  try {
    pinUsers.value = await api('GET', '/auth/pin-users')
    if (pinUsers.value.length) { mode.value = 'pin'; name.value = pinUsers.value[0].name }
  } catch {}
  await nextTick()
  document.querySelector('.unlock #upw')?.focus()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function onKey(e) {
  if (mode.value !== 'pin' || e.target.tagName === 'INPUT') return
  if (/^[0-9]$/.test(e.key)) press(e.key)
  else if (e.key === 'Backspace') press('⌫')
  else if (e.key === 'Enter') submit()
}
function press(d) {
  if (d === '⌫') pin.value = pin.value.slice(0, -1)
  else if (pin.value.length < 8) pin.value += d
  if (pin.value.length >= 4 && d !== '⌫') err.value = ''
}
async function submit() {
  busy.value = true
  err.value = ''
  try {
    const body = mode.value === 'pin' ? { name: name.value, pin: pin.value } : { name: name.value, password: password.value }
    emit('unlocked', await api('POST', '/auth/login', body))
  } catch (e) {
    err.value = errorText(e)
    pin.value = ''
  } finally { busy.value = false }
}
</script>

<template>
  <div class="unlock">
    <p class="hint">🔒 {{ t('unlock.hint') }}</p>
    <div v-if="pinUsers.length" class="tabs">
      <button type="button" class="btn" :class="{ active: mode === 'pin' }" @click="mode = 'pin'">{{ t('login.pin') }}</button>
      <button type="button" class="btn" :class="{ active: mode === 'password' }" @click="mode = 'password'; nextTick(() => $el.querySelector('#upw')?.focus())">{{ t('login.password') }}</button>
    </div>
    <template v-if="mode === 'pin'">
      <div class="users"><button v-for="u in pinUsers" :key="u.name" type="button" class="btn" :class="{ active: name === u.name }" @click="name = u.name; pin = ''">{{ u.display_name }}</button></div>
      <div class="dots"><span v-for="i in Math.max(4, pin.length)" :key="i" :class="{ on: i <= pin.length }" /></div>
      <div class="pad">
        <button v-for="d in ['1','2','3','4','5','6','7','8','9','⌫','0','✓']" :key="d" type="button" class="btn key" :class="{ primary: d === '✓' }" :disabled="busy" @click="d === '✓' ? submit() : press(d)">{{ d }}</button>
      </div>
    </template>
    <form v-else @submit.prevent="submit">
      <div class="field"><label>{{ t('login.user') }}</label><input v-model="name" autocomplete="username"></div>
      <div class="field"><label>{{ t('login.password') }}</label><input id="upw" v-model="password" type="password" autocomplete="current-password"></div>
      <button class="btn primary full" :disabled="busy">{{ t('unlock.submit') }}</button>
    </form>
    <p v-if="err" class="err">{{ err }}</p>
  </div>
</template>

<style scoped>
.unlock { max-width: 420px; margin: 0 auto; }
.hint { color: var(--dim); text-align: center; }
.tabs, .users { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.tabs .btn { flex: 1; }
.dots { display: flex; justify-content: center; gap: 14px; margin: 8px 0 18px; }
.dots span { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--line-strong); }
.dots span.on { background: var(--cyan); }
.pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.key { min-height: 64px; font-size: 26px; font-family: var(--mono); }
.full { width: 100%; }
.err { color: var(--err); text-align: center; }
</style>
