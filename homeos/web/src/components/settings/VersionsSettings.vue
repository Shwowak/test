<script setup>
import { ref, onMounted, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { errorText } from '../../i18n.js'

const emit = defineEmits(['restored'])
const { t, d } = useI18n()
const user = inject('user')
const versions = ref([])
const error = ref('')
const msg = ref('')

async function load() {
  versions.value = await api('GET', '/versions?limit=200')
}
onMounted(load)

async function restore(v) {
  if (!confirm(t('versions.confirm_restore', { date: d(new Date(v.ts), 'long') }))) return
  error.value = ''
  try {
    await api('POST', `/versions/${v.id}/restore`)
    msg.value = t('versions.restored')
    emit('restored')
    await load()
  } catch (e) {
    error.value = errorText(e)
  }
}
</script>

<template>
  <p class="hint">{{ t('versions.hint') }}</p>
  <p v-if="msg" class="ok">{{ msg }}</p>
  <p v-if="error" class="error">{{ error }}</p>
  <ul class="list">
    <li v-for="v in versions" :key="v.id">
      <div class="when">{{ d(new Date(v.ts), 'long') }}</div>
      <div class="what">
        <span class="badge">{{ t('versions.entity.' + v.entity) }}</span>
        {{ t('versions.action.' + v.action) }}<template v-if="v.summary"> · {{ v.summary }}</template>
        <div class="who">{{ v.user_name ?? '—' }}</div>
      </div>
      <button v-if="user.permissions.includes('versions.restore')" class="btn" @click="restore(v)">⟲ {{ t('versions.restore') }}</button>
    </li>
    <li v-if="!versions.length" class="hint">{{ t('versions.empty') }}</li>
  </ul>
</template>

<style scoped>
.hint { color: var(--dim); }
.ok { color: #86efac; }
.list { list-style: none; margin: 0; padding: 0; }
li { display: flex; align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid var(--line); }
.when { width: 190px; flex: none; font-family: var(--mono); font-size: 14px; color: var(--cyan); }
.what { flex: 1; font-size: 16px; }
.who { color: var(--dim); font-size: 13px; }
.badge { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; border: 1px solid var(--line-strong); padding: 2px 6px; margin-right: 6px; }
@media (max-width: 700px) { li { flex-wrap: wrap; } .when { width: 100%; } }
</style>
