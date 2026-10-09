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

function setUser(u) {
  user.value = u
  if (u?.locale) setLocale(u.locale)
}

provide('user', user)
provide('setUser', setUser)

onMounted(async () => {
  try { setUser(await api('GET', '/auth/me')) } catch {}
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
    <Login v-if="!user" @login="setUser" />
    <Shell v-else @logout="logout" />
  </template>
  <Keyboard v-if="kiosk" />
</template>
