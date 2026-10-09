<script setup>
import { ref, onMounted, provide } from 'vue'
import { api } from './api.js'
import { setLocale } from './i18n.js'
import Login from './components/Login.vue'
import Shell from './components/Shell.vue'
import Keyboard from './components/Keyboard.vue'
import { kiosk } from './display.js'

const user = ref(null)
const ready = ref(false)
const netcode = ref(false)
const code = ref('')
const codeErr = ref('')
async function sendCode() {
  codeErr.value = ''
  try { await api('POST', '/auth/netcode', { code: code.value }); netcode.value = false; try { setUser(await api('GET', '/auth/me')) } catch {} } catch { codeErr.value = '✕' }
}

function setUser(u) {
  user.value = u
  if (u?.locale) setLocale(u.locale)
}

provide('user', user)
provide('setUser', setUser)

onMounted(async () => {
  try { setUser(await api('GET', '/auth/me')) } catch (e) { if (e.code === 'netcode.required') netcode.value = true }
  ready.value = true
})

async function logout() {
  await api('POST', '/auth/logout').catch(() => {})
  user.value = null
  try { setUser(await api('GET', '/auth/me')) } catch {}
}
</script>

<template>
  <template v-if="ready">
    <main v-if="netcode && !user" class="nc">
      <form @submit.prevent="sendCode">
        <h1>SmartBoard</h1>
        <p>{{ $t('netcode.hint') }}</p>
        <input v-model="code" type="password" autofocus autocomplete="off" :placeholder="$t('netcode.code')">
        <button class="btn primary">{{ $t('netcode.submit') }}</button>
        <p v-if="codeErr" class="err">{{ $t('netcode.wrong') }}</p>
      </form>
    </main>
    <Login v-else-if="!user" @login="setUser" />
    <Shell v-else @logout="logout" />
  </template>
  <Keyboard v-if="kiosk" />
</template>

<style scoped>
.nc { min-height: 100vh; display: grid; place-items: center; }
.nc form { display: flex; flex-direction: column; gap: 12px; width: min(360px, 90vw); text-align: center; }
.nc h1 { font-weight: 300; letter-spacing: .25em; }
.nc p { color: var(--dim); }
.nc input { min-height: 52px; font-size: 20px; text-align: center; }
.err { color: var(--err) !important; }
</style>
