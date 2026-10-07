<script setup>
import { ref, computed } from 'vue'
import { api } from '../api.js'

const props = defineProps({ widget: Object, dashboardId: Number, meta: Object, sources: Array })
const emit = defineEmits(['saved'])

const form = ref({
  ...props.widget,
  config: { ...props.widget.config, values: props.widget.config.values?.join(', ') },
})
const error = ref('')

const typeDef = computed(() => props.meta.widgetTypes[form.value.type])
const allowedSources = computed(() => props.sources.filter(s => typeDef.value.sources.includes(s.type)))
const sourceType = computed(() => props.sources.find(s => s.id === form.value.source_id)?.type ?? 'static')
const visibleFields = computed(() => typeDef.value.fields.filter(f => {
  if (f.static) return sourceType.value === 'static'
  if (f.for) return f.for.includes(sourceType.value)
  return true
}))

function onTypeChange() {
  if (!allowedSources.value.some(s => s.id === form.value.source_id)) form.value.source_id = null
}

async function save() {
  error.value = ''
  const config = { ...form.value.config }
  if (typeof config.values === 'string') config.values = config.values.split(',').map(v => Number(v.trim())).filter(v => !isNaN(v))
  for (const f of typeDef.value.fields) if (f.type === 'number' && config[f.key] !== undefined && config[f.key] !== '') config[f.key] = Number(config[f.key])
  const body = { ...form.value, config }
  try {
    if (form.value.id) await api('PUT', `/widgets/${form.value.id}`, body)
    else await api('POST', `/dashboards/${props.dashboardId}/widgets`, body)
    emit('saved')
  } catch (e) {
    error.value = e.message
  }
}

async function remove() {
  if (!confirm('Widget löschen?')) return
  await api('DELETE', `/widgets/${form.value.id}`)
  emit('saved')
}
</script>

<template>
  <form @submit.prevent="save">
    <div class="field">
      <label>Typ</label>
      <div class="types">
        <button
          v-for="(t, key) in meta.widgetTypes" :key="key" type="button" class="btn"
          :class="{ active: form.type === key }" @click="form.type = key; onTypeChange()"
        >{{ t.label }}</button>
      </div>
    </div>

    <div class="field"><label>Titel</label><input v-model="form.title" placeholder="z. B. Wohnzimmer"></div>

    <div v-if="typeDef.sources.length" class="field">
      <label>Datenquelle</label>
      <select v-model="form.source_id">
        <option v-if="typeDef.sources.includes('static')" :value="null">Fester Wert</option>
        <option v-for="s in allowedSources" :key="s.id" :value="s.id">{{ s.name }} ({{ meta.sourceTypes[s.type].label }})</option>
      </select>
      <small v-if="!allowedSources.length && !typeDef.sources.includes('static')" class="hint">
        Erst unter „Quellen“ eine passende Datenquelle anlegen: {{ typeDef.sources.map(s => meta.sourceTypes[s].label).join(', ') }}
      </small>
    </div>

    <div v-for="f in visibleFields" :key="f.key" class="field">
      <label>{{ f.label }}</label>
      <textarea v-if="f.type === 'textarea'" v-model="form.config[f.key]" />
      <select v-else-if="f.type === 'select'" v-model="form.config[f.key]">
        <option v-for="(l, v) in f.options" :key="v" :value="v">{{ l }}</option>
      </select>
      <input v-else-if="f.type === 'color'" v-model="form.config[f.key]" type="color">
      <input v-else-if="f.type === 'number'" v-model="form.config[f.key]" type="number" step="any" inputmode="decimal">
      <input v-else v-model="form.config[f.key]" :type="f.type === 'url' ? 'url' : 'text'">
    </div>

    <div class="field">
      <label>Aktualisierung (Sekunden)</label>
      <input v-model.number="form.config.refresh" type="number" min="5" placeholder="30">
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <div class="row">
      <button v-if="form.id" type="button" class="btn danger" @click="remove">Löschen</button>
      <span class="grow" />
      <button class="btn primary">Speichern</button>
    </div>
  </form>
</template>

<style scoped>
.types { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.types .btn { font-size: 15px; }
.hint { color: var(--warn); font-size: 14px; }
.row { display: flex; gap: 12px; }
.grow { flex: 1; }
</style>
