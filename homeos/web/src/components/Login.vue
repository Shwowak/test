<script setup>
import { ref } from 'vue'
import { api } from '../api.js'

const emit = defineEmits(['login'])
const name = ref('admin')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  busy.value = true
  error.value = ''
  try {
    emit('login', await api('POST', '/login', { name: name.value, password: password.value }))
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="wrap">
    <form class="card" @submit.prevent="submit">
      <div class="logo">
        <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
          <path d="M8 32h12l6-10h12l6 10h12M20 32v14h24V32M32 8v14M26 46v10M38 46v10" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="32" cy="8" r="3" fill="#22d3ee"/><circle cx="8" cy="32" r="3" fill="#22d3ee"/><circle cx="56" cy="32" r="3" fill="#22d3ee"/>
        </svg>
        <h1>HomeOS</h1>
      </div>
      <div class="field"><label for="u">Benutzer</label><input id="u" v-model="name" autocomplete="username"></div>
      <div class="field"><label for="p">Passwort</label><input id="p" v-model="password" type="password" autocomplete="current-password"></div>
      <p v-if="error" class="error">{{ error }}</p>
      <button class="btn primary full" :disabled="busy">Anmelden</button>
    </form>
  </main>
</template>

<style scoped>
.wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.card { width: min(440px, 100%); padding: 40px 32px; border-radius: 24px; border: 1px solid var(--line); background: var(--glass); backdrop-filter: blur(16px); box-shadow: 0 0 60px rgba(34, 211, 238, 0.08); }
.logo { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-bottom: 28px; }
.logo svg { filter: drop-shadow(0 0 10px rgba(245, 158, 11, 0.6)); }
h1 { margin: 0; font-size: 30px; letter-spacing: 0.3em; font-weight: 300; }
.full { width: 100%; }
</style>
