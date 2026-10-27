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
const tint = a => ({ '--tint': META[a]?.[2] ?? '#64748b' })
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
  form.value = { adapter, name: t('adapters.' + adapter), config: { mqtt: { discovery_prefix: 'homeassistant' }, rest: { interval: 30 }, proxmox: { kind: 'pve', insecure: 'yes', include: 'all', interval: 15, auto_adopt: true }, knx: { mode: 'tunneling' }, evcc: { interval: 5, auto_adopt: true }, fritzbox: { url: 'http://fritz.box', interval: 30, auto_adopt: true } }[adapter] ?? {}, enabled: true }
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
    <div v-if="manual" class="panel">
      <header class="phead"><button type="button" class="back" @click="manual = null">‹</button><h3>{{ t('integrations.manual_device') }}</h3></header>
      <form @submit.prevent="saveManual">
        <div class="grid2">
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
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="actions"><span class="grow" /><button class="btn primary">{{ t('common.save') }}</button></div>
      </form>
    </div>

    <form v-else-if="pair" class="panel" @submit.prevent="action(pair.i, 'commission', pair.code.trim())">
      <header class="phead"><button type="button" class="back" @click="pair = null">‹</button><h3>{{ t('integrations.commission') }}</h3></header>
      <p class="hint">{{ t('integrations.commission_help') }}</p>
      <div class="field"><input v-model="pair.code" required placeholder="MT:… / 3497-011-2332"></div>
      <div class="actions"><span class="grow" /><button class="btn primary" :disabled="busy">{{ t('integrations.commission') }}</button></div>
    </form>

    <div v-else-if="adding" class="panel">
      <header class="phead">
        <button type="button" class="back" @click="adding = false">‹</button>
        <h3>{{ t('integrations.add') }}</h3>
        <span class="grow" />
        <input v-model="query" class="search" type="search" :placeholder="t('integrations.ui.search')" autofocus>
      </header>
      <section v-for="g in catalog" :key="g.c" class="cat">
        <div class="cat-t">{{ t('integrations.ui.cat.' + g.c) }}</div>
        <div class="tiles">
          <button v-for="k in g.items" :key="k" class="tile" :style="tint(k)" @click="create(k)">
            <span class="logo">{{ icon(k) }}</span>
            <span class="tt"><b>{{ title(k) }}</b><small>{{ subtitle(k) }}</small></span>
            <span class="plus">＋</span>
          </button>
        </div>
      </section>
      <p v-if="!catalog.length" class="hint">{{ t('integrations.ui.no_match') }}</p>
    </div>

    <form v-else-if="form" class="panel" @submit.prevent="save">
      <header class="phead">
        <button type="button" class="back" @click="form = null">‹</button>
        <span class="logo sm" :style="tint(form.adapter)">{{ icon(form.adapter) }}</span>
        <div class="ht"><h3>{{ form.id ? form.name : title(form.adapter) }}</h3><small>{{ form.id ? title(form.adapter) : t('integrations.ui.new') }}</small></div>
        <span v-if="form.id" class="pill" :class="form.status?.status">{{ t('integrations.status.' + (form.status?.status ?? 'stopped')) }}</span>
      </header>

      <ol v-if="!form.id" class="steps">
        <li :class="{ on: step === 1, done: step > 1 }"><span>1</span>{{ t('integrations.ui.step_connect') }}</li>
        <li :class="{ on: step === 2 }"><span>2</span>{{ t('integrations.ui.step_finish') }}</li>
      </ol>

      <p v-if="form.id && form.status?.error" class="alert">{{ form.status.error }}</p>

      <template v-if="step !== 2">
        <p class="help">{{ t('integrations.help.' + form.adapter) }}</p>
        <div class="grid2">
          <div class="field wide"><label>{{ t('common.name') }}</label><input v-model="form.name" required maxlength="80"></div>
          <div v-for="f in fields" :key="f.key" class="field" :class="{ wide: !['number', 'select'].includes(f.type) }">
            <label>{{ t('integrationFields.' + f.key) }}<i v-if="f.required">*</i></label>
            <select v-if="f.type === 'select'" v-model="form.config[f.key]"><option v-for="o in f.options" :key="o" :value="o">{{ t('restOptions.' + o, o) }}</option></select>
            <textarea v-else-if="f.type === 'json'" v-model="form.config[f.key]" placeholder='{"Authorization": "Bearer …"}' />
            <div v-else-if="f.type === 'secret'" class="secret">
              <input v-model="form.config[f.key]" :type="reveal[f.key] ? 'text' : 'password'" :required="f.required" autocomplete="off" :placeholder="ph(form.adapter, f.key)">
              <button type="button" class="eye" @click="reveal[f.key] = !reveal[f.key]">{{ reveal[f.key] ? '🙈' : '👁' }}</button>
            </div>
            <input v-else v-model="form.config[f.key]" :type="f.type === 'number' ? 'number' : 'text'" :required="f.required" autocomplete="off" :placeholder="ph(form.adapter, f.key)">
          </div>
        </div>
      </template>

      <div v-if="test" class="result" :class="{ ok: test.ok }">
        <span class="ri">{{ test.ok ? '✓' : '!' }}</span>
        <span>{{ test.ok ? t('integrations.test_ok', test.found) : t('integrations.test_failed', { error: test.error }) }}</span>
      </div>

      <div v-if="step !== 1" class="opts">
        <label class="switch"><input v-model="form.config.auto_adopt" type="checkbox"><span />{{ t('integrations.auto_adopt') }}</label>
        <label class="switch"><input v-model="form.enabled" type="checkbox"><span />{{ t('integrations.enabled') }}</label>
      </div>
      <p v-if="error" class="error">{{ error }}</p>

      <div class="actions">
        <button v-if="form.id" type="button" class="btn danger ghost" @click="remove">{{ t('common.delete') }}</button>
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
    </form>

    <div v-else>
      <div class="kpis">
        <div><b>{{ stats.total }}</b><small>{{ t('integrations.ui.k_total') }}</small></div>
        <div><b class="g">{{ stats.ok }}</b><small>{{ t('integrations.ui.k_ok') }}</small></div>
        <div><b :class="{ r: stats.err }">{{ stats.err }}</b><small>{{ t('integrations.ui.k_err') }}</small></div>
        <div><b>{{ stats.devices }}</b><small>{{ t('integrations.ui.k_devices') }}</small></div>
        <span class="grow" />
        <button class="btn primary" @click="adding = true; query = ''">＋ {{ t('integrations.add') }}</button>
      </div>
      <p v-if="actionMsg" class="toast">{{ actionMsg }}</p>
      <div v-if="store.integrations.length" class="cards">
        <article v-for="i in store.integrations" :key="i.id" class="card" :style="tint(i.adapter)" @click="edit(i)">
          <div class="ctop">
            <span class="logo">{{ icon(i.adapter) }}</span>
            <div class="ht"><b>{{ i.name }}</b><small>{{ title(i.adapter) }}</small></div>
            <span class="pill" :class="i.status?.status">{{ t('integrations.status.' + (i.status?.status ?? 'stopped')) }}</span>
          </div>
          <p v-if="i.status?.error" class="cerr">{{ i.status.error }}</p>
          <div class="cbot">
            <span class="cnt">{{ t('integrations.devices', i.devices) }}</span>
            <span class="grow" />
            <button v-if="adapters[i.adapter]?.actions?.includes('permit_join')" class="chip" @click.stop="action(i, 'permit_join')">{{ t('integrations.permit_join') }}</button>
            <button v-if="adapters[i.adapter]?.actions?.includes('commission')" class="chip" @click.stop="pair = { i, code: '' }">{{ t('integrations.commission') }}</button>
            <button v-if="adapters[i.adapter]?.manualDevices" class="chip" @click.stop="addManual(i)">＋ {{ t('integrations.manual_device') }}</button>
            <span class="chev">›</span>
          </div>
        </article>
      </div>
      <div v-else class="empty">
        <div class="big">⌁</div>
        <p>{{ t('integrations.empty') }}</p>
        <button class="btn primary" @click="adding = true">＋ {{ t('integrations.add') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.integ { --card: rgba(148, 163, 184, 0.06); --card-h: rgba(148, 163, 184, 0.11); --r: 16px; }
h3 { margin: 0; font-weight: 600; font-size: 20px; }
.hint, .help { color: var(--dim); }
.help { font-size: 14px; line-height: 1.5; padding: 12px 14px; border-radius: 12px; background: var(--card); margin: 0 0 18px; }
.grow { flex: 1; }
.kpis { display: flex; align-items: center; gap: 28px; flex-wrap: wrap; margin-bottom: 20px; }
.kpis div { display: flex; flex-direction: column; }
.kpis b { font-size: 26px; font-weight: 600; line-height: 1.1; }
.kpis b.g { color: var(--ok); }
.kpis b.r { color: var(--err); }
.kpis small { color: var(--dim); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; }
.toast { padding: 10px 14px; border-radius: 12px; background: var(--card); color: var(--text); }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.card { background: var(--card); border-radius: var(--r); padding: 16px; cursor: pointer; display: flex; flex-direction: column; gap: 12px; transition: background 0.15s, transform 0.15s; position: relative; overflow: hidden; }
.card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--tint); opacity: 0.9; }
.card:hover { background: var(--card-h); transform: translateY(-1px); }
.ctop { display: flex; align-items: center; gap: 12px; }
.ht { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.ht b, .ht h3 { overflow-wrap: break-word; line-height: 1.25; }
.ht small { color: var(--dim); font-size: 13px; }
.logo { width: 44px; height: 44px; flex: none; border-radius: 12px; display: grid; place-items: center; font-size: 22px; background: color-mix(in srgb, var(--tint, #64748b) 22%, transparent); }
.logo.sm { width: 38px; height: 38px; font-size: 19px; }
.pill { font-size: 12px; padding: 4px 10px; border-radius: 999px; background: rgba(100, 116, 139, 0.2); color: var(--dim); white-space: nowrap; }
.pill::before { content: '●'; margin-right: 6px; }
.pill.connected { background: rgba(48, 209, 88, 0.14); color: var(--ok); }
.pill.connecting, .pill.disconnected { background: rgba(255, 159, 10, 0.14); color: var(--warn); }
.pill.error { background: rgba(255, 69, 58, 0.14); color: var(--err); }
.cerr { margin: 0; font-size: 13px; color: var(--err); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cbot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cnt { color: var(--dim); font-size: 14px; }
.chip { font-size: 13px; padding: 6px 12px; border-radius: 999px; border: 0; background: var(--card-h); color: var(--text); cursor: pointer; }
.chip:hover { background: rgba(148, 163, 184, 0.2); }
.chev { color: var(--dim); font-size: 22px; }
.empty { text-align: center; padding: 48px 16px; color: var(--dim); }
.empty .big { font-size: 48px; opacity: 0.5; }
.panel { max-width: 860px; }
.phead { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
.back { width: 38px; height: 38px; border-radius: 50%; border: 0; background: var(--card); color: var(--text); font-size: 24px; line-height: 1; cursor: pointer; }
.back:hover { background: var(--card-h); }
.search { min-width: 220px; max-width: 100%; border-radius: 999px; padding: 10px 16px; }
.cat { margin-bottom: 22px; }
.cat-t { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--dim); margin-bottom: 10px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
.tile { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 14px; border: 0; background: var(--card); color: var(--text); text-align: left; cursor: pointer; transition: background 0.15s; }
.tile:hover { background: var(--card-h); }
.tt { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.tt small { color: var(--dim); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plus { color: var(--dim); font-size: 18px; }
.steps { display: flex; gap: 8px; list-style: none; padding: 0; margin: 0 0 18px; }
.steps li { flex: 1; display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 12px; background: var(--card); color: var(--dim); font-size: 14px; }
.steps li span { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: rgba(148, 163, 184, 0.18); font-size: 13px; }
.steps li.on { color: var(--text); }
.steps li.on span { background: var(--cyan); color: #000; }
.steps li.done span { background: var(--ok); color: #000; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0 18px; }
.field.wide { grid-column: 1 / -1; }
.field label i { color: var(--err); font-style: normal; margin-left: 2px; }
.secret { display: flex; gap: 6px; width: 100%; }
.secret input { flex: 1; width: 100%; min-width: 0; }
.eye { border: 0; background: var(--card); border-radius: 10px; width: 46px; cursor: pointer; }
.alert { padding: 12px 14px; border-radius: 12px; background: rgba(255, 69, 58, 0.12); color: var(--err); font-size: 14px; }
.result { display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: 12px; margin: 12px 0; background: rgba(255, 69, 58, 0.12); color: var(--err); }
.result.ok { background: rgba(48, 209, 88, 0.12); color: var(--ok); }
.ri { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; border: 2px solid currentColor; font-weight: 700; flex: none; }
.opts { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
.switch { display: flex; align-items: center; gap: 12px; min-height: 48px; font-size: 16px; cursor: pointer; }
.switch input { display: none; }
.switch span { width: 46px; height: 28px; border-radius: 999px; background: rgba(148, 163, 184, 0.3); position: relative; transition: background 0.2s; flex: none; }
.switch span::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: transform 0.2s; }
.switch input:checked + span { background: var(--ok); }
.switch input:checked + span::after { transform: translateX(18px); }
.actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); }
.ghost { background: transparent; }
@media (max-width: 600px) { .kpis { gap: 18px; } .cards, .tiles { grid-template-columns: 1fr; } }
</style>
