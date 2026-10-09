<script setup>
import { ref, computed } from 'vue'
import { api } from '../api.js'
import { useI18n } from 'vue-i18n'
import { errorText } from '../i18n.js'
import { store, loadDevices } from '../devices.js'
import { plugins, loadPlugins, pluginWidgets } from '../plugins.js'

if (!store.loaded) loadDevices().catch(() => {})
if (!plugins.loaded) loadPlugins().catch(() => {})

const { t, locale } = useI18n()

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
    error.value = errorText(e)
  }
}

async function remove() {
  if (!confirm(t('widget.confirm_delete'))) return
  await api('DELETE', `/widgets/${form.value.id}`)
  emit('saved')
}
</script>

<template>
  <form @submit.prevent="save">
    <div class="field">
      <label>{{ t('widget.type') }}</label>
      <div class="types">
        <button
          v-for="(_, key) in meta.widgetTypes" :key="key" type="button" class="btn"
          :class="{ active: form.type === key }" @click="form.type = key; onTypeChange()"
        >{{ $t('widgetTypes.' + key) }}</button>
      </div>
    </div>

    <div class="field"><label>{{ t('widget.title') }}</label><input v-model="form.title" :placeholder="t('widget.title_placeholder')"></div>

    <div v-if="typeDef.sources.length" class="field">
      <label>{{ t('widget.source') }}</label>
      <select v-model="form.source_id">
        <option v-if="typeDef.sources.includes('static')" :value="null">{{ t('sourceTypes.static') }}</option>
        <option v-for="s in allowedSources" :key="s.id" :value="s.id">{{ s.name }} ({{ t('sourceTypes.' + s.type) }})</option>
      </select>
      <small v-if="!allowedSources.length && !typeDef.sources.includes('static')" class="hint">
        {{ t('widget.need_source', { types: typeDef.sources.map(s => t('sourceTypes.' + s)).join(', ') }) }}
      </small>
    </div>

    <div v-for="f in visibleFields" :key="f.key" class="field">
      <label>{{ t('fields.' + f.key) }}</label>
      <textarea v-if="f.type === 'textarea'" v-model="form.config[f.key]" />
      <select v-else-if="f.type === 'select'" v-model="form.config[f.key]">
        <option v-for="v in f.options" :key="v" :value="v">{{ t('chartStyles.' + v) }}</option>
      </select>
      <select v-else-if="f.type === 'device'" v-model.number="form.config[f.key]">
        <option v-for="d in Object.values(store.devices).filter(x => x.adopted).sort((a, b) => a.name.localeCompare(b.name))" :key="d.id" :value="d.id">{{ d.name }}</option>
      </select>
      <select v-else-if="f.type === 'room'" v-model.number="form.config[f.key]">
        <option v-for="r in store.rooms" :key="r.id" :value="r.id">{{ r.name }}</option>
      </select>
      <select v-else-if="f.type === 'plugin_widget'" v-model="form.config[f.key]" required>
        <option v-for="o in pluginWidgets(locale)" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <input v-else-if="f.type === 'color'" v-model="form.config[f.key]" type="color">
      <input v-else-if="f.type === 'number'" v-model="form.config[f.key]" type="number" step="any" inputmode="decimal">
      <input v-else v-model="form.config[f.key]" :type="f.type === 'url' ? 'url' : 'text'">
    </div>

    <div class="field">
      <label>{{ t('widget.refresh') }}</label>
      <input v-model.number="form.config.refresh" type="number" min="5" placeholder="30">
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <div class="row">
      <button v-if="form.id" type="button" class="btn danger" @click="remove">{{ t('common.delete') }}</button>
      <span class="grow" />
      <button class="btn primary">{{ t('common.save') }}</button>
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
