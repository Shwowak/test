<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { errorText } from '../../i18n.js'

const props = defineProps({ meta: Object })
const { t, te, d } = useI18n()
const filter = ref({ category: '', level: '', q: '', from: '', to: '' })
const rows = ref([])
const open = ref(null)
const error = ref('')

function query(extra = {}) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...filter.value, ...extra })) {
    if (!v) continue
    p.set(k, (k === 'from' || k === 'to') ? new Date(v).toISOString() : v)
  }
  return p.toString()
}

async function load() {
  error.value = ''
  try {
    rows.value = await api('GET', `/logs?${query({ limit: 300 })}`)
  } catch (e) {
    error.value = errorText(e)
  }
}
onMounted(load)

const exportUrl = fmt => `/api/v1/logs/export?${query({ format: fmt })}`
const msgText = m => { const k = 'logs.messages.' + m.replace(/\./g, '_'); return te(k) ? t(k) : m }
const pretty = s => { try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s } }
</script>

<template>
  <form class="filters" @submit.prevent="load">
    <select v-model="filter.category" :aria-label="t('logs.category')">
      <option value="">{{ t('logs.all_categories') }}</option>
      <option v-for="c in props.meta.logCategories" :key="c" :value="c">{{ t('logs.categories.' + c) }}</option>
    </select>
    <select v-model="filter.level" :aria-label="t('logs.level')">
      <option value="">{{ t('logs.all_levels') }}</option>
      <option v-for="l in props.meta.logLevels" :key="l" :value="l">≥ {{ t('logs.levels.' + l) }}</option>
    </select>
    <input v-model="filter.q" type="search" :placeholder="t('logs.search')">
    <input v-model="filter.from" type="datetime-local" :aria-label="t('logs.from')">
    <input v-model="filter.to" type="datetime-local" :aria-label="t('logs.to')">
    <button class="btn primary">{{ t('logs.apply') }}</button>
    <a class="btn" :href="exportUrl('csv')">⇩ CSV</a>
    <a class="btn" :href="exportUrl('json')">⇩ JSON</a>
  </form>
  <p v-if="error" class="error">{{ error }}</p>
  <ul class="list">
    <li v-for="r in rows" :key="r.id" :class="'lv-' + r.level" @click="open = open === r.id ? null : r.id">
      <div class="line">
        <span class="ts">{{ d(new Date(r.ts), 'long') }}</span>
        <span class="lv">{{ t('logs.levels.' + r.level) }}</span>
        <span class="cat">{{ t('logs.categories.' + r.category) }}</span>
        <span class="msg">{{ msgText(r.message) }}</span>
        <span class="usr">{{ r.user_name }}</span>
      </div>
      <pre v-if="open === r.id && r.data" class="data">{{ pretty(r.data) }}</pre>
    </li>
    <li v-if="!rows.length" class="empty">{{ t('logs.empty') }}</li>
  </ul>
</template>

<style scoped>
.filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.filters select, .filters input { min-height: 48px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line); background: rgba(2, 6, 23, 0.7); font-size: 15px; }
.filters input[type='search'] { flex: 1; min-width: 160px; }
a.btn { text-decoration: none; font-size: 15px; }
.list { list-style: none; margin: 0; padding: 0; font-size: 14px; }
li { border-top: 1px solid var(--line); padding: 10px 4px; cursor: pointer; }
.line { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.ts { font-family: var(--mono); color: var(--dim); width: 170px; flex: none; }
.lv { width: 70px; flex: none; text-transform: uppercase; font-size: 11px; letter-spacing: 0.1em; }
.cat { width: 110px; flex: none; color: var(--cyan); }
.msg { flex: 1; }
.usr { color: var(--dim); }
.lv-warning .lv { color: var(--warn); }
.lv-error .lv, .lv-critical .lv { color: var(--err); }
.data { margin: 8px 0 0; padding: 10px; background: rgba(2, 6, 23, 0.7); border: 1px solid var(--line); font-size: 12px; overflow-x: auto; user-select: text; }
.empty { color: var(--dim); cursor: default; }
</style>
