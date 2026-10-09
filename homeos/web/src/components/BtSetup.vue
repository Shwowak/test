<script setup>
import { ref, onMounted, getCurrentInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api.js'
import { errorText } from '../i18n.js'

const emit = defineEmits(['close'])
const { t } = useI18n()
const st = ref(null)
const busy = ref('')
const err = ref('')
const done = ref('')

async function run(key, fn) {
  busy.value = key
  err.value = ''
  try { st.value = await fn() } catch (e) { err.value = errorText(e) + (e.details?.message ? ` – ${e.details.message}` : '') } finally { busy.value = '' }
}
const scan = () => run('scan', () => api('POST', '/setup/bluetooth/scan'))
async function pair(d) {
  await run(d.address, () => api('POST', '/setup/bluetooth/pair', { address: d.address }))
  if (!err.value) done.value = d.name
}
const inst = getCurrentInstance()
onMounted(async () => {
  inst?.proxy?.$el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  await run('load', () => api('GET', '/setup/bluetooth')); if (st.value?.available) scan() })
</script>

<template>
  <div class="bt">
    <h3>⌨ {{ t('btsetup.title') }}</h3>
    <p class="hint">{{ t('btsetup.hint') }}</p>
    <p v-if="done" class="ok">✓ {{ t('btsetup.done', { name: done }) }}</p>
    <p v-if="err" class="err">{{ err }}</p>
    <p v-if="st && !st.available" class="err">{{ t('hw.no_bt') }}</p>
    <div v-for="d in st?.devices ?? []" :key="d.address" class="dev" :class="{ dim: !d.input }">
      <span class="ic">{{ /mouse|maus/i.test(d.icon + d.name) ? '🖱' : d.input ? '⌨' : '◈' }}</span>
      <div class="grow"><b>{{ d.name }}</b><small>{{ d.connected ? t('hw.connected_short') : d.paired ? t('hw.paired') : d.address }}</small></div>
      <button v-if="!d.connected" type="button" class="btn primary" :disabled="!!busy" @click="pair(d)">{{ busy === d.address ? '…' : t('hw.pair') }}</button>
      <span v-else class="ok">✓</span>
    </div>
    <div class="row">
      <button type="button" class="btn" :disabled="!!busy" @click="scan">{{ busy === 'scan' ? t('hw.scanning') : '⟳ ' + t('hw.scan') }}</button>
      <span class="grow" />
      <button type="button" class="btn" @click="emit('close')">{{ t('common.close') }}</button>
    </div>
  </div>
</template>

<style scoped>
h3 { margin: 0 0 6px; font-weight: 400; }
.hint { color: var(--dim); font-size: 14px; margin: 0 0 10px; }
.dev { display: flex; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--line); }
.dev.dim { opacity: .55; }
.dev small { display: block; color: var(--dim); }
.ic { font-size: 24px; width: 30px; text-align: center; }
.grow { flex: 1; min-width: 0; }
.row { display: flex; gap: 10px; margin-top: 12px; }
.ok { color: var(--ok); }
.err { color: var(--err); }
</style>
