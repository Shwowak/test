<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { store, loadDevices } from '../../devices.js'
import { errorText } from '../../i18n.js'

const { t } = useI18n()
const name = ref('')
const editing = ref(null)
const error = ref('')
const icons = ['▢', '🛋', '🍳', '🛏', '🛁', '💻', '🚪', '🧸', '🌳', '🚗', '⚙', '🏠']

async function run(fn) {
  error.value = ''
  try {
    await fn()
    await loadDevices()
  } catch (e) {
    error.value = errorText(e)
  }
}
const add = () => run(async () => { await api('POST', '/rooms', { name: name.value }); name.value = '' })
const save = r => run(async () => { await api('PUT', `/rooms/${r.id}`, { name: r.name, icon: r.icon }); editing.value = null })
const remove = r => confirm(t('rooms.confirm_delete', { name: r.name })) && run(() => api('DELETE', `/rooms/${r.id}`))
const move = (r, dir) => {
  const list = [...store.rooms]
  const i = list.indexOf(r)
  const j = i + dir
  if (j < 0 || j >= list.length) return
  run(async () => {
    await api('PUT', `/rooms/${list[i].id}`, { position: j })
    await api('PUT', `/rooms/${list[j].id}`, { position: i })
  })
}
</script>

<template>
  <form class="add" @submit.prevent="add">
    <input v-model="name" :placeholder="t('rooms.name_placeholder')" required maxlength="60">
    <button class="btn primary">＋ {{ t('rooms.add') }}</button>
  </form>
  <p v-if="error" class="error">{{ error }}</p>
  <ul class="list">
    <li v-for="r in store.rooms" :key="r.id">
      <template v-if="editing === r.id">
        <input v-model="r.name" maxlength="60">
        <select v-model="r.icon"><option v-for="i in icons" :key="i" :value="i">{{ i }}</option></select>
        <button class="btn primary" @click="save(r)">{{ t('common.save') }}</button>
      </template>
      <template v-else>
        <span class="nm" @click="editing = r.id">{{ r.icon }} {{ r.name }}</span>
        <span class="cnt">{{ Object.values(store.devices).filter(d => d.room_id === r.id).length }}</span>
        <button class="btn icon" @click="move(r, -1)">↑</button>
        <button class="btn icon" @click="move(r, 1)">↓</button>
        <button class="btn icon danger" @click="remove(r)">✕</button>
      </template>
    </li>
  </ul>
</template>

<style scoped>
.add { display: flex; gap: 8px; margin-bottom: 16px; }
.add input, li input, li select { flex: 1; min-height: 56px; padding: 0 14px; border: 1px solid var(--line); background: rgba(2, 6, 23, 0.7); font-size: 17px; }
li select { flex: 0 0 80px; }
.list { list-style: none; margin: 0; padding: 0; }
li { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid var(--line); }
.nm { flex: 1; font-size: 18px; cursor: pointer; min-height: 48px; display: flex; align-items: center; }
.cnt { color: var(--dim); font-family: var(--mono); margin-right: 6px; }
</style>
