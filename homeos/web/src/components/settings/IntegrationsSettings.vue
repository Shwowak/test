<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { store, loadIntegrations, loadDevices } from '../../devices.js'
import { errorText } from '../../i18n.js'

const { t, te } = useI18n()
const ph = (a, k) => te(`integrationPlaceholders.${a}.${k}`) ? t(`integrationPlaceholders.${a}.${k}`) : ''
const form = ref(null)
const manual = ref(null)
const test = ref(null)
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  if (!store.registry) await loadDevices()
  await loadIntegrations()
})

const adapters = computed(() => store.registry?.adapters ?? {})
const fields = computed(() => form.value ? adapters.value[form.value.adapter]?.fields ?? [] : [])
const manualFields = computed(() => (adapters.value[manual.value?.adapter]?.deviceFields ?? []).filter(f => !f.for || f.for.includes(manual.value?.meta.kind)))

function create(adapter) {
  form.value = { adapter, name: t('adapters.' + adapter), config: adapter === 'mqtt' ? { discovery_prefix: 'homeassistant' } : adapter === 'rest' ? { interval: 30 } : {}, enabled: true }
  test.value = null
}
function edit(i) {
  form.value = { ...i, config: { ...i.config, headers: i.config.headers ? JSON.stringify(i.config.headers) : undefined } }
  test.value = null
}

function payload() {
  const config = { ...form.value.config }
  if (typeof config.headers === 'string') config.headers = config.headers.trim() ? JSON.parse(config.headers) : undefined
  if (config.interval !== undefined) config.interval = Number(config.interval)
  return { id: form.value.id, adapter: form.value.adapter, name: form.value.name, config, enabled: form.value.enabled }
}

async function runTest() {
  busy.value = true
  error.value = ''
  test.value = null
  try {
    test.value = await api('POST', '/integrations/test', payload())
  } catch (e) {
    error.value = e instanceof SyntaxError ? t('sources.headers_invalid') : errorText(e)
  } finally {
    busy.value = false
  }
}

async function save() {
  error.value = ''
  try {
    const p = payload()
    if (form.value.id) await api('PUT', `/integrations/${form.value.id}`, p)
    else await api('POST', '/integrations', p)
    form.value = null
    setTimeout(() => { loadIntegrations(); loadDevices() }, 1500)
    await loadIntegrations()
  } catch (e) {
    error.value = e instanceof SyntaxError ? t('sources.headers_invalid') : errorText(e)
  }
}

async function remove() {
  if (!confirm(t('integrations.confirm_delete', { name: form.value.name }))) return
  await api('DELETE', `/integrations/${form.value.id}`)
  form.value = null
  await Promise.all([loadIntegrations(), loadDevices()])
}

function addManual(i) {
  manual.value = { integration_id: i.id, adapter: i.adapter, name: '', room_id: null, meta: i.adapter === 'modbus' ? { kind: 'sensor', table: 'holding', address: 0, datatype: 'uint16', word_order: 'big' } : { kind: 'sensor', method: 'POST' } }
}
async function saveManual() {
  error.value = ''
  try {
    const { adapter, ...body } = manual.value
    if (adapter === 'modbus') for (const k of ['address', 'scale', 'unit_id']) if (body.meta[k] !== '' && body.meta[k] != null) body.meta[k] = Number(body.meta[k])
    await api('POST', '/devices', body)
    manual.value = null
    await Promise.all([loadIntegrations(), loadDevices()])
  } catch (e) {
    error.value = errorText(e)
  }
}
</script>

<template>
  <div v-if="manual">
    <h3>{{ t('integrations.manual_device') }}</h3>
    <form @submit.prevent="saveManual">
      <div class="field"><label>{{ t('common.name') }}</label><input v-model="manual.name" required maxlength="80"></div>
      <div class="field">
        <label>{{ t('rooms.room') }}</label>
        <select v-model="manual.room_id"><option :value="null">{{ t('rooms.none') }}</option><option v-for="r in store.rooms" :key="r.id" :value="r.id">{{ r.name }}</option></select>
      </div>
      <div v-for="f in manualFields" :key="f.key" class="field">
        <label>{{ t('restFields.' + f.key) }}</label>
        <select v-if="f.type === 'select'" v-model="manual.meta[f.key]"><option v-for="o in f.options" :key="o" :value="o">{{ t('restOptions.' + o, o) }}</option></select>
        <input v-else v-model="manual.meta[f.key]" :type="f.type === 'url' ? 'url' : f.type === 'number' ? 'number' : 'text'" step="any" :required="f.required">
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="row">
        <button type="button" class="btn" @click="manual = null">{{ t('common.back') }}</button>
        <span class="grow" />
        <button class="btn primary">{{ t('common.save') }}</button>
      </div>
    </form>
  </div>

  <div v-else-if="!form">
    <ul class="list">
      <li v-for="i in store.integrations" :key="i.id">
        <button class="item" @click="edit(i)">
          <span class="dot" :class="i.status?.status" />
          <span class="txt"><b>{{ i.name }}</b><small>{{ t('adapters.' + i.adapter) }} · {{ t('integrations.status.' + (i.status?.status ?? 'stopped')) }}<template v-if="i.status?.error"> · {{ i.status.error }}</template></small></span>
          <span class="cnt">{{ t('integrations.devices', i.devices) }}</span>
        </button>
        <button v-if="adapters[i.adapter]?.manualDevices" class="btn" @click="addManual(i)">＋ {{ t('integrations.manual_device') }}</button>
      </li>
      <li v-if="!store.integrations.length" class="hint">{{ t('integrations.empty') }}</li>
    </ul>
    <div class="label sec">{{ t('integrations.add') }}</div>
    <div class="new">
      <button v-for="(_, k) in adapters" :key="k" class="btn" @click="create(k)">＋ {{ t('adapters.' + k) }}</button>
    </div>
    <p class="hint small">{{ t('integrations.coming') }}</p>
  </div>

  <form v-else @submit.prevent="save">
    <h3>{{ t('adapters.' + form.adapter) }}</h3>
    <p class="hint">{{ t('integrations.help.' + form.adapter) }}</p>
    <div class="field"><label>{{ t('common.name') }}</label><input v-model="form.name" required maxlength="80"></div>
    <div v-for="f in fields" :key="f.key" class="field">
      <label>{{ t('integrationFields.' + f.key) }}</label>
      <textarea v-if="f.type === 'json'" v-model="form.config[f.key]" placeholder='{"Authorization": "Bearer …"}' />
      <input v-else v-model="form.config[f.key]" :type="f.type === 'secret' ? 'password' : f.type === 'number' ? 'number' : 'text'" :required="f.required" autocomplete="off" :placeholder="ph(form.adapter, f.key)">
    </div>
    <label class="check"><input v-model="form.config.auto_adopt" type="checkbox"> {{ t('integrations.auto_adopt') }}</label>
    <label class="check"><input v-model="form.enabled" type="checkbox"> {{ t('integrations.enabled') }}</label>

    <div v-if="test" class="test" :class="{ ok: test.ok }">
      {{ test.ok ? t('integrations.test_ok', test.found) : t('integrations.test_failed', { error: test.error }) }}
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="row">
      <button type="button" class="btn" @click="form = null">{{ t('common.back') }}</button>
      <button v-if="form.id" type="button" class="btn danger" @click="remove">{{ t('common.delete') }}</button>
      <span class="grow" />
      <button type="button" class="btn" :disabled="busy" @click="runTest">{{ busy ? '…' : t('integrations.test') }}</button>
      <button class="btn primary">{{ t('common.save') }}</button>
    </div>
  </form>
</template>

<style scoped>
h3 { margin: 0 0 8px; font-weight: 400; }
.hint { color: var(--dim); }
.small { font-size: 13px; margin-top: 16px; }
.list { list-style: none; margin: 0; padding: 0; }
.list li { display: flex; gap: 8px; align-items: center; border-top: 1px solid var(--line); padding: 6px 0; }
.item { flex: 1; display: flex; align-items: center; gap: 14px; min-height: 64px; background: none; border: 0; text-align: left; cursor: pointer; }
.txt { flex: 1; display: flex; flex-direction: column; }
.txt small { color: var(--dim); }
.cnt { color: var(--dim); font-family: var(--mono); }
.dot { width: 12px; height: 12px; border-radius: 50%; background: #475569; flex: none; }
.dot.connected { background: var(--ok); box-shadow: 0 0 10px var(--ok); }
.dot.connecting, .dot.disconnected { background: var(--warn); }
.dot.error { background: var(--err); box-shadow: 0 0 10px var(--err); }
.sec { margin: 24px 0 12px; }
.new { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.check { display: flex; align-items: center; gap: 10px; min-height: 48px; font-size: 16px; }
.check input { width: 24px; height: 24px; }
.test { padding: 14px; border: 1px solid var(--err); color: #fda4af; margin: 12px 0; }
.test.ok { border-color: var(--ok); color: #86efac; }
.row { display: flex; gap: 10px; flex-wrap: wrap; }
.grow { flex: 1; }
</style>
