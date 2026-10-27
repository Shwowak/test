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
const pair = ref(null)
const actionMsg = ref('')
async function action(i, name, value) {
  busy.value = true
  try {
    await api('POST', `/integrations/${i.id}/action`, { action: name, value })
    actionMsg.value = t('integrations.action_ok.' + name)
    pair.value = null
  } catch (e) {
    actionMsg.value = t('integrations.action_failed') + ' ' + (e.message ?? '')
  } finally { busy.value = false }
}
const test = ref(null)
const step = ref(1)
const adding = ref(false)
const query = ref('')
const reveal = ref({})
const META = {
  home_assistant: ['🏠', 'smart', '#18bcf2'], zigbee2mqtt: ['🐝', 'smart', '#f5b301'], zwavejs: ['〰', 'smart', '#2fb37a'], matter: ['◈', 'smart', '#7b61ff'],
  fritzbox: ['📶', 'smart', '#e2001a'], evcc: ['🔌', 'energy', '#0fdd42'], modbus: ['⚙', 'energy', '#f97316'], proxmox: ['🖥', 'server', '#e57000'],
  mqtt: ['📡', 'protocol', '#660066'], knx: ['🏢', 'protocol', '#00a651'], rest: ['🔗', 'protocol', '#64748b'], system: ['📊', 'server', '#0a84ff'],
}
const CATS = ['smart', 'energy', 'server', 'protocol']
const icon = a => META[a]?.[0] ?? '⌁'
const title = a => t('adapters.' + a).split(' (')[0]
const subtitle = a => t('adapters.' + a).match(/\((.*)\)/)?.[1] ?? t('integrations.ui.cat.' + (META[a]?.[1] ?? 'protocol'))
const catalog = computed(() => {
  const q = query.value.trim().toLowerCase()
  const keys = Object.keys(adapters.value).filter(k => !adapters.value[k].hidden && (!q || t('adapters.' + k).toLowerCase().includes(q)))
  return CATS.map(c => ({ c, items: keys.filter(k => (META[k]?.[1] ?? 'protocol') === c) })).filter(g => g.items.length)
})
const stats = computed(() => ({
  total: store.integrations.length,
  ok: store.integrations.filter(i => i.status?.status === 'connected').length,
  err: store.integrations.filter(i => i.status?.status === 'error').length,
  devices: store.integrations.reduce((a, i) => a + (i.devices ?? 0), 0),
}))
async function next() {
  await runTest()
  if (test.value?.ok) step.value = 2
}
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
  adding.value = false
  step.value = 1
  reveal.value = {}
  form.value = { adapter, name: title(adapter), config: { mqtt: { discovery_prefix: 'homeassistant' }, rest: { interval: 30 }, proxmox: { kind: 'pve', insecure: 'yes', include: 'all', interval: 15, auto_adopt: true }, knx: { mode: 'tunneling' }, evcc: { interval: 5, auto_adopt: true }, fritzbox: { url: 'http://fritz.box', interval: 30, auto_adopt: true } }[adapter] ?? {}, enabled: true }
  test.value = null
}
function edit(i) {
  step.value = 0
  reveal.value = {}
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
  <div class="integ">
    <div v-if="manual">
      <button type="button" class="back" @click="manual = null">‹ {{ t('settings.tabs.integrations') }}</button>
      <h2>{{ t('integrations.manual_device') }}</h2>
      <form @submit.prevent="saveManual">
        <div class="group">
          <label class="row"><span class="k">{{ t('common.name') }}</span><input v-model="manual.name" required maxlength="80"></label>
          <label class="row"><span class="k">{{ t('rooms.room') }}</span>
            <select v-model="manual.room_id"><option :value="null">{{ t('rooms.none') }}</option><option v-for="r in store.rooms" :key="r.id" :value="r.id">{{ r.name }}</option></select>
          </label>
          <label v-for="f in manualFields" :key="f.key" class="row"><span class="k">{{ t('restFields.' + f.key) }}</span>
            <select v-if="f.type === 'select'" v-model="manual.meta[f.key]"><option v-for="o in f.options" :key="o" :value="o">{{ t('restOptions.' + o, o) }}</option></select>
            <input v-else v-model="manual.meta[f.key]" :type="f.type === 'url' ? 'url' : f.type === 'number' ? 'number' : 'text'" step="any" :required="f.required">
          </label>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="foot"><span class="grow" /><button class="btn primary">{{ t('common.save') }}</button></div>
      </form>
    </div>

    <form v-else-if="pair" @submit.prevent="action(pair.i, 'commission', pair.code.trim())">
      <button type="button" class="back" @click="pair = null">‹ {{ t('settings.tabs.integrations') }}</button>
      <h2>{{ t('integrations.commission') }}</h2>
      <div class="group"><label class="row"><span class="k">Code</span><input v-model="pair.code" required placeholder="MT:… / 3497-011-2332"></label></div>
      <p class="note">{{ t('integrations.commission_help') }}</p>
      <div class="foot"><span class="grow" /><button class="btn primary" :disabled="busy">{{ t('integrations.commission') }}</button></div>
    </form>

    <div v-else-if="adding">
      <div class="top">
        <button type="button" class="back" @click="adding = false">‹ {{ t('settings.tabs.integrations') }}</button>
        <input v-model="query" class="search" type="search" :placeholder="t('integrations.ui.search')">
      </div>
      <h2>{{ t('integrations.add') }}</h2>
      <template v-for="g in catalog" :key="g.c">
        <div class="gh">{{ t('integrations.ui.cat.' + g.c) }}</div>
        <div class="group">
          <button v-for="k in g.items" :key="k" class="row link" @click="create(k)">
            <span class="ic" :style="{ background: META[k]?.[2] }">{{ icon(k) }}</span>
            <span class="tt"><b>{{ title(k) }}</b><small>{{ subtitle(k) }}</small></span>
            <span class="add">{{ t('integrations.ui.add_short') }}</span>
          </button>
        </div>
      </template>
      <p v-if="!catalog.length" class="note">{{ t('integrations.ui.no_match') }}</p>
    </div>

    <form v-else-if="form" @submit.prevent="save">
      <button type="button" class="back" @click="form = null">‹ {{ t('settings.tabs.integrations') }}</button>
      <div class="hero">
        <span class="ic lg" :style="{ background: META[form.adapter]?.[2] }">{{ icon(form.adapter) }}</span>
        <div><h2>{{ form.id ? form.name : title(form.adapter) }}</h2><small>{{ form.id ? title(form.adapter) : t('integrations.ui.new') }}</small></div>
        <span v-if="form.id" class="st" :class="form.status?.status">{{ t('integrations.status.' + (form.status?.status ?? 'stopped')) }}</span>
      </div>

      <div v-if="!form.id" class="seg">
        <span :class="{ on: step === 1 }">1 · {{ t('integrations.ui.step_connect') }}</span>
        <span :class="{ on: step === 2 }">2 · {{ t('integrations.ui.step_finish') }}</span>
      </div>

      <p v-if="form.id && form.status?.error" class="banner err">{{ form.status.error }}</p>

      <template v-if="step !== 2">
        <div class="gh">{{ t('integrations.ui.step_connect') }}</div>
        <div class="group">
          <label class="row"><span class="k">{{ t('common.name') }}</span><input v-model="form.name" required maxlength="80"></label>
          <label v-for="f in fields" :key="f.key" class="row" :class="{ tall: f.type === 'json' }">
            <span class="k">{{ t('integrationFields.' + f.key) }}</span>
            <select v-if="f.type === 'select'" v-model="form.config[f.key]"><option v-for="o in f.options" :key="o" :value="o">{{ t('restOptions.' + o, o) }}</option></select>
            <textarea v-else-if="f.type === 'json'" v-model="form.config[f.key]" placeholder='{"Authorization": "Bearer …"}' />
            <span v-else-if="f.type === 'secret'" class="sec">
              <input v-model="form.config[f.key]" :type="reveal[f.key] ? 'text' : 'password'" :required="f.required" autocomplete="off" :placeholder="ph(form.adapter, f.key) || t('integrations.ui.required')">
              <button type="button" class="eye" @click.prevent="reveal[f.key] = !reveal[f.key]">{{ reveal[f.key] ? t('integrations.ui.hide') : t('integrations.ui.show') }}</button>
            </span>
            <input v-else v-model="form.config[f.key]" :type="f.type === 'number' ? 'number' : 'text'" :required="f.required" autocomplete="off" :placeholder="ph(form.adapter, f.key) || (f.required ? t('integrations.ui.required') : t('integrations.ui.optional'))">
          </label>
        </div>
        <p class="note">{{ t('integrations.help.' + form.adapter) }}</p>
      </template>

      <div v-if="test" class="banner" :class="test.ok ? 'ok' : 'err'">
        {{ test.ok ? '✓ ' + t('integrations.test_ok', test.found) : t('integrations.test_failed', { error: test.error }) }}
      </div>

      <template v-if="step !== 1">
        <div class="gh">{{ t('integrations.ui.options') }}</div>
        <div class="group">
          <label class="row"><span class="k">{{ t('integrations.auto_adopt') }}</span><span class="tog"><input v-model="form.config.auto_adopt" type="checkbox"><i /></span></label>
          <label class="row"><span class="k">{{ t('integrations.enabled') }}</span><span class="tog"><input v-model="form.enabled" type="checkbox"><i /></span></label>
        </div>
      </template>
      <p v-if="error" class="error">{{ error }}</p>

      <div class="foot">
        <button v-if="step === 2" type="button" class="btn" @click="step = 1; test = null">{{ t('common.back') }}</button>
        <span class="grow" />
        <template v-if="step === 1">
          <button v-if="test && !test.ok" type="button" class="btn" @click="step = 2">{{ t('integrations.ui.skip_test') }}</button>
          <button type="button" class="btn primary" :disabled="busy" @click="next">{{ busy ? t('integrations.ui.testing') : t('integrations.ui.test_next') }}</button>
        </template>
        <template v-else>
          <button v-if="form.id" type="button" class="btn" :disabled="busy" @click="runTest">{{ busy ? t('integrations.ui.testing') : t('integrations.test') }}</button>
          <button class="btn primary">{{ form.id ? t('common.save') : t('integrations.ui.finish') }}</button>
        </template>
      </div>
      <div v-if="form.id" class="group danger"><button type="button" class="row link" @click="remove">{{ t('integrations.ui.remove') }}</button></div>
    </form>

    <div v-else>
      <div class="summary">
        <span><b>{{ stats.total }}</b> {{ t('integrations.ui.k_total') }}</span>
        <span><b class="g">{{ stats.ok }}</b> {{ t('integrations.ui.k_ok') }}</span>
        <span v-if="stats.err"><b class="r">{{ stats.err }}</b> {{ t('integrations.ui.k_err') }}</span>
        <span><b>{{ stats.devices }}</b> {{ t('integrations.ui.k_devices') }}</span>
        <span class="grow" />
        <button class="btn primary" @click="adding = true; query = ''">＋ {{ t('integrations.ui.add_short') }}</button>
      </div>
      <p v-if="actionMsg" class="banner ok">{{ actionMsg }}</p>
      <div v-if="store.integrations.length" class="group">
        <div v-for="i in store.integrations" :key="i.id" class="row link" @click="edit(i)">
          <span class="ic" :style="{ background: META[i.adapter]?.[2] }">{{ icon(i.adapter) }}</span>
          <span class="tt"><b>{{ i.name }}</b><small :class="{ e: i.status?.error }">{{ i.status?.error || title(i.adapter) + ' · ' + t('integrations.devices', i.devices) }}</small></span>
          <span class="acts">
            <button v-if="adapters[i.adapter]?.actions?.includes('permit_join')" class="mini" @click.stop="action(i, 'permit_join')">{{ t('integrations.permit_join') }}</button>
            <button v-if="adapters[i.adapter]?.actions?.includes('commission')" class="mini" @click.stop="pair = { i, code: '' }">{{ t('integrations.commission') }}</button>
            <button v-if="adapters[i.adapter]?.manualDevices" class="mini" @click.stop="addManual(i)">＋ {{ t('integrations.manual_device') }}</button>
          </span>
          <span class="st" :class="i.status?.status">{{ t('integrations.status.' + (i.status?.status ?? 'stopped')) }}</span>
          <span class="chev">›</span>
        </div>
      </div>
      <div v-else class="emptyst">
        <p>{{ t('integrations.empty') }}</p>
        <button class="btn primary" @click="adding = true">＋ {{ t('integrations.add') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.integ { --grp: rgba(118, 118, 128, 0.12); --sep: rgba(84, 84, 88, 0.45); max-width: 760px; }
h2 { margin: 0; font-size: 22px; font-weight: 700; }
.grow { flex: 1; }
.back { border: 0; background: none; color: #0a84ff; font-size: 15px; padding: 0; margin-bottom: 12px; cursor: pointer; }
.top { display: flex; align-items: center; gap: 12px; }
.top .back { margin: 0; }
.search { margin-left: auto; width: 240px; border: 0; border-radius: 10px; padding: 8px 12px; background: rgba(118, 118, 128, 0.2); color: var(--text); font-size: 14px; }
.top + h2 { margin: 14px 0 6px; }
.gh { font-size: 13px; color: var(--dim); padding: 22px 16px 7px; text-transform: uppercase; letter-spacing: 0.02em; }
.note { font-size: 13px; color: var(--dim); padding: 7px 16px 0; margin: 0; line-height: 1.45; }
.group { background: var(--grp); border-radius: 12px; overflow: hidden; }
.row { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 6px 16px; position: relative; width: 100%; border: 0; background: transparent; color: var(--text); font-size: 15px; text-align: left; }
.row + .row::before { content: ''; position: absolute; top: 0; left: 16px; right: 0; height: 0.5px; background: var(--sep); }
.row:has(.ic) + .row::before { left: 58px; }
.link { cursor: pointer; }
.link:hover { background: rgba(118, 118, 128, 0.1); }
.link:active { background: rgba(118, 118, 128, 0.2); }
.k { flex: 0 0 auto; min-width: 140px; color: var(--text); }
.row input, .row select, .row textarea { flex: 1; min-width: 0; border: 0 !important; background: transparent !important; box-shadow: none !important; color: var(--text); font-size: 15px; text-align: right; padding: 8px 0 !important; border-radius: 0 !important; }
.row select { direction: rtl; cursor: pointer; }
.row select option { direction: ltr; }
.row input::placeholder { color: rgba(235, 235, 245, 0.3); }
.row input:focus, .row select:focus, .row textarea:focus { outline: none; }
.row.tall { align-items: flex-start; padding-top: 12px; }
.row textarea { min-height: 90px; text-align: left; font-family: var(--mono); font-size: 13px; }
.sec { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0; }
.eye { border: 0; background: none; color: #0a84ff; font-size: 14px; cursor: pointer; padding: 0; }
.ic { width: 30px; height: 30px; border-radius: 7px; display: grid; place-items: center; font-size: 16px; color: #fff; flex: none; box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.18); }
.ic.lg { width: 56px; height: 56px; border-radius: 13px; font-size: 28px; }
.tt { flex: 1; display: flex; flex-direction: column; min-width: 0; padding: 4px 0; }
.tt b { font-weight: 500; }
.tt small { color: var(--dim); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tt small.e { color: #ff453a; }
.add { color: #0a84ff; font-size: 15px; }
.chev { color: rgba(235, 235, 245, 0.3); font-size: 20px; margin-left: 2px; }
.st { font-size: 14px; color: var(--dim); white-space: nowrap; display: flex; align-items: center; gap: 6px; }
.st::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #8e8e93; }
.st.connected::before { background: #30d158; }
.st.connecting::before, .st.disconnected::before { background: #ff9f0a; }
.st.error { color: #ff453a; }
.st.error::before { background: #ff453a; }
.acts { display: flex; gap: 6px; }
.mini { border: 0; border-radius: 999px; padding: 5px 11px; background: rgba(10, 132, 255, 0.16); color: #0a84ff; font-size: 13px; cursor: pointer; white-space: nowrap; }
.summary { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; color: var(--dim); font-size: 14px; margin-bottom: 16px; }
.summary b { color: var(--text); font-size: 17px; font-weight: 600; margin-right: 2px; }
.summary b.g { color: #30d158; }
.summary b.r { color: #ff453a; }
.hero { display: flex; align-items: center; gap: 14px; margin: 4px 0 16px; }
.hero small { color: var(--dim); font-size: 14px; }
.hero .st { margin-left: auto; }
.seg { display: inline-flex; padding: 2px; border-radius: 9px; background: rgba(118, 118, 128, 0.24); margin-bottom: 4px; }
.seg span { padding: 6px 16px; border-radius: 7px; font-size: 13px; color: var(--dim); }
.seg span.on { background: #636366; color: #fff; box-shadow: 0 3px 8px rgba(0, 0, 0, 0.12); }
.banner { margin: 16px 0 0; padding: 12px 16px; border-radius: 12px; font-size: 14px; }
.banner.ok { background: rgba(48, 209, 88, 0.14); color: #30d158; }
.banner.err { background: rgba(255, 69, 58, 0.14); color: #ff6961; }
.tog { margin-left: auto; position: relative; display: inline-flex; }
.tog input { position: absolute; opacity: 0; pointer-events: none; }
.tog i { width: 51px; height: 31px; border-radius: 999px; background: rgba(120, 120, 128, 0.32); position: relative; transition: background 0.2s; cursor: pointer; }
.tog i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 50%; background: #fff; box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15); transition: transform 0.2s; }
.tog input:checked + i { background: #30d158; }
.tog input:checked + i::after { transform: translateX(20px); }
.foot { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 22px; }
.danger { margin-top: 28px; }
.danger .row { justify-content: center; color: #ff453a; }
.emptyst { text-align: center; padding: 40px 0; color: var(--dim); }
@media (max-width: 600px) { .k { min-width: 0; max-width: 45%; } .acts { display: none; } .search { width: 100%; } .top { flex-wrap: wrap; } }
</style>
