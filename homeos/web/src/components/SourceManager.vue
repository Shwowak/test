<script setup>
import { ref, computed } from 'vue'
import { api } from '../api.js'
import { useI18n } from 'vue-i18n'
import { errorText } from '../i18n.js'

const { t } = useI18n()

const props = defineProps({ meta: Object, sources: Array })
const emit = defineEmits(['changed'])

const form = ref(null)
const error = ref('')
const typeDef = computed(() => form.value && props.meta.sourceTypes[form.value.type])
const creatable = computed(() => Object.keys(props.meta.sourceTypes).filter(k => k !== 'static'))

function start(type) {
  form.value = { name: '', type, config: {} }
}
function edit(s) {
  form.value = { ...s, config: { ...s.config, headers: s.config.headers ? JSON.stringify(s.config.headers) : '' } }
}

async function save() {
  error.value = ''
  const config = { ...form.value.config }
  try {
    if (typeof config.headers === 'string') config.headers = config.headers.trim() ? JSON.parse(config.headers) : undefined
  } catch {
    error.value = t('sources.headers_invalid')
    return
  }
  try {
    if (form.value.id) await api('PUT', `/sources/${form.value.id}`, { name: form.value.name, config })
    else await api('POST', '/sources', { ...form.value, config })
    form.value = null
    emit('changed')
  } catch (e) {
    error.value = errorText(e)
  }
}

async function remove() {
  if (!confirm(t('sources.confirm_delete', { name: form.value.name }))) return
  await api('DELETE', `/sources/${form.value.id}`)
  form.value = null
  emit('changed')
}
</script>

<template>
  <div v-if="!form">
    <div v-if="sources.length" class="list">
      <button v-for="s in sources" :key="s.id" class="btn item" @click="edit(s)">
        <span>{{ s.name }}</span><span class="label">{{ t('sourceTypes.' + s.type) }}</span>
      </button>
    </div>
    <p v-else class="hint">{{ t('sources.empty') }}</p>
    <div class="label sec">{{ t('sources.new') }}</div>
    <div class="new">
      <button v-for="k in creatable" :key="k" class="btn" @click="start(k)">＋ {{ t('sourceTypes.' + k) }}</button>
    </div>
  </div>

  <form v-else @submit.prevent="save">
    <div class="label sec">{{ t('sourceTypes.' + form.type) }}</div>
    <div class="field"><label>{{ t('common.name') }}</label><input v-model="form.name" required :placeholder="t('sources.name_placeholder')"></div>
    <div v-for="f in typeDef.fields" :key="f.key" class="field">
      <label>{{ t('sourceFields.' + f.key) }}</label>
      <textarea v-if="f.type === 'json'" v-model="form.config[f.key]" placeholder='{"Authorization": "Bearer …"}' />
      <input v-else v-model="form.config[f.key]" :type="f.type === 'secret' ? 'password' : f.type === 'url' ? 'url' : 'text'" :required="f.required" autocomplete="off">
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="row">
      <button type="button" class="btn" @click="form = null">{{ t('common.back') }}</button>
      <button v-if="form.id" type="button" class="btn danger" @click="remove">{{ t('common.delete') }}</button>
      <span class="grow" />
      <button class="btn primary">{{ t('common.save') }}</button>
    </div>
  </form>
</template>

<style scoped>
.list { display: flex; flex-direction: column; gap: 8px; }
.item { justify-content: space-between; width: 100%; }
.sec { margin: 24px 0 12px; }
.new { display: grid; gap: 8px; }
.hint { color: var(--dim); }
.row { display: flex; gap: 12px; }
.grow { flex: 1; }
</style>
