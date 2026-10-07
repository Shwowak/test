<script setup>
import { ref, onMounted } from 'vue'
import { api } from './api.js'
import Login from './components/Login.vue'
import Shell from './components/Shell.vue'

const user = ref(null)
const ready = ref(false)

onMounted(async () => {
  try { user.value = await api('GET', '/me') } catch {}
  ready.value = true
})

async function logout() {
  await api('POST', '/logout')
  user.value = null
}
</script>

<template>
  <template v-if="ready">
    <Login v-if="!user" @login="u => (user = u)" />
    <Shell v-else :user="user" @logout="logout" />
  </template>
</template>
