<script setup>
import { ref, computed, onMounted, onBeforeUnmount, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { errorText } from '../../i18n.js'
import { store, listeners, loadDevices } from '../../devices.js'
import Sheet from '../Sheet.vue'
import { cams, loadCameras } from '../../cameras.js'

const { t, d, te } = useI18n()
const user = inject('user')
const canEdit = computed(() => user.value?.permissions?.includes('automations.manage'))
const list = ref([])
const meta = ref(null)
const dashboards = ref([])
const form = ref(null)
const runs = ref(null)
const err = ref('')
const days = [1, 2, 3, 4, 5, 6, 0]

async function load() {
  list.value = await api('GET', '/automations')
}
onMounted(async () => {
  ;[meta.value, dashboards.value] = await Promise.all([api('GET', '/automations/meta'), api('GET', '/dashboards'), load()])
  if (!store.loaded) loadDevices().catch(() => {})
  if (!cams.loaded) loadCameras().catch(() => {})
})
const onEv = type => { if (type === 'automation.ran' || type === 'config.changed') load().catch(() => {}) }
listeners.add(onEv)
onBeforeUnmount(() => listeners.delete(onEv))

const devices = computed(() => Object.values(store.devices).sort((a, b) => a.name.localeCompare(b.name)))
const caps = (blk, f) => store.devices[blk.device_id]?.capabilities.filter(c => !f.writable || c.writable !== false) ?? []
const capOf = blk => store.devices[blk.device_id]?.capabilities.find(c => c.id === blk.capability)
const lbl = (group, k) => te(`automations.${group}.${k}`) ? t(`automations.${group}.${k}`) : k
const capLabel = id => te('capabilities.' + id) ? t('capabilities.' + id) : id

function edit(a) {
  err.value = ''
  form.value = a ? JSON.parse(JSON.stringify(a)) : { name: '', enabled: true, cooldown: 0, triggers: [{ type: 'time', at: '07:00', days: [] }], conditions: [], actions: [{ type: 'notify', level: 'info', title: '', message: '' }] }
}
function addBlock(group, type) {
  const blk = { type }
  for (const f of meta.value[group][type].fields) blk[f.key] = f.type === 'weekdays' ? [] : f.type === 'select' ? f.options[0] : f.type === 'time' ? '07:00' : f.type === 'number' ? 0 : ''
  form.value[group].push(blk)
}
const toggleDay = (blk, k, n) => { blk[k] = blk[k].includes(n) ? blk[k].filter(x => x !== n) : [...blk[k], n] }

function normalize(blk, group) {
  const out = { ...blk }
  for (const f of meta.value[group][blk.type].fields) {
    if (['number', 'device', 'dashboard', 'automation', 'camera'].includes(f.type) && out[f.key] !== '') out[f.key] = Number(out[f.key])
  }
  return out
}
async function save() {
  err.value = ''
  const f = form.value
  const body = { name: f.name, enabled: f.enabled, cooldown: Number(f.cooldown) || 0,
    triggers: f.triggers.map(b => normalize(b, 'triggers')), conditions: f.conditions.map(b => normalize(b, 'conditions')), actions: f.actions.map(b => normalize(b, 'actions')) }
  try {
    if (f.id) await api('PUT', `/automations/${f.id}`, body)
    else await api('POST', '/automations', body)
    form.value = null
    await load()
  } catch (e) { err.value = errorText(e) }
}
async function remove() {
  if (!confirm(t('automations.confirm_delete', { name: form.value.name }))) return
  await api('DELETE', `/automations/${form.value.id}`)
  form.value = null
  await load()
}
async function toggle(a) {
  await api('PUT', `/automations/${a.id}`, { enabled: !a.enabled })
  a.enabled = !a.enabled
}
async function run(a) {
  try { await api('POST', `/automations/${a.id}/run`) } catch (e) { alert(errorText(e)) }
  await load()
}
async function history(a) {
  runs.value = { name: a.name, items: await api('GET', `/automations/${a.id}/runs`) }
}
const summary = a => a.triggers.map(x => lbl('triggers', x.type)).join(', ') + ' → ' + a.actions.map(x => lbl('actions', x.type)).join(', ')
</script>

<template>
  <div class="auto">
    <div class="head">
      <p class="hint">{{ t('automations.hint') }}</p>
      <button v-if="canEdit && meta" class="btn primary" @click="edit(null)">＋ {{ t('automations.new') }}</button>
    </div>
    <p v-if="!list.length" class="empty">{{ t('automations.empty') }}</p>
    <div v-for="a in list" :key="a.id" class="row" :class="{ off: !a.enabled }">
      <button class="sw" :class="{ on: a.enabled }" :disabled="!canEdit" :aria-label="t('automations.enabled')" @click="toggle(a)"><span /></button>
      <div class="info" @click="canEdit && meta && edit(a)">
        <b>{{ a.name }}</b>
        <small>{{ summary(a) }}</small>
        <small>{{ a.last_run ? t('automations.last_run', { date: d(new Date(a.last_run), 'long'), n: a.run_count }) : t('automations.never') }}</small>
      </div>
      <button class="btn icon" :aria-label="t('automations.history')" @click="history(a)">☰</button>
      <button v-if="canEdit" class="btn" @click="run(a)">▶ {{ t('automations.run') }}</button>
    </div>

    <Sheet v-if="form" :title="form.id ? t('automations.edit') : t('automations.new')" wide @close="form = null">
      <form @submit.prevent="save">
        <div class="grid2">
          <div class="field"><label>{{ t('common.name') }}</label><input v-model="form.name" required maxlength="80"></div>
          <div class="field"><label>{{ t('automations.cooldown') }}</label><input v-model="form.cooldown" type="number" min="0" max="86400"></div>
        </div>

        <section v-for="group in ['triggers', 'conditions', 'actions']" :key="group" class="grp" :class="group">
          <h3>{{ t('automations.groups.' + group) }}</h3>
          <div v-for="(blk, i) in form[group]" :key="i" class="blk">
            <div class="bh"><b>{{ lbl(group, blk.type) }}</b><button type="button" class="btn icon" :aria-label="t('common.delete')" @click="form[group].splice(i, 1)">✕</button></div>
            <div class="fields">
              <div v-for="f in meta[group][blk.type].fields" :key="f.key" class="field" :class="{ wide: f.type === 'weekdays' || (f.type === 'text' && f.key === 'message') }">
                <label>{{ lbl('fields', f.key) }}</label>
                <input v-if="f.type === 'time'" v-model="blk[f.key]" type="time" required>
                <input v-else-if="f.type === 'number'" v-model="blk[f.key]" type="number" step="any">
                <input v-else-if="f.type === 'text'" v-model="blk[f.key]" :placeholder="f.key === 'message' ? '{device.name}: {value}' : ''">
                <select v-else-if="f.type === 'select'" v-model="blk[f.key]">
                  <option v-for="o in f.options" :key="o" :value="o">{{ lbl('options', o) }}</option>
                </select>
                <div v-else-if="f.type === 'weekdays'" class="days">
                  <button v-for="n in days" :key="n" type="button" class="btn" :class="{ active: blk[f.key].includes(n) }" @click="toggleDay(blk, f.key, n)">{{ t('automations.days.' + n) }}</button>
                </div>
                <select v-else-if="f.type === 'device'" v-model="blk[f.key]" required>
                  <option v-for="dv in devices" :key="dv.id" :value="dv.id">{{ dv.name }}</option>
                </select>
                <select v-else-if="f.type === 'capability'" v-model="blk[f.key]" required>
                  <option v-for="c in caps(blk, f)" :key="c.id" :value="c.id">{{ capLabel(c.id) }}</option>
                </select>
                <select v-else-if="f.type === 'value' && capOf(blk)?.value === 'boolean'" v-model="blk[f.key]">
                  <option :value="true">{{ t('automations.options.true') }}</option><option :value="false">{{ t('automations.options.false') }}</option>
                </select>
                <input v-else-if="f.type === 'value'" v-model="blk[f.key]">
                <select v-else-if="f.type === 'dashboard'" v-model="blk[f.key]" required>
                  <option v-for="db in dashboards" :key="db.id" :value="db.id">{{ db.icon }} {{ db.name }}</option>
                </select>
                <select v-else-if="f.type === 'camera'" v-model="blk[f.key]" required>
                  <option v-for="c in cams.list" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
                <select v-else-if="f.type === 'automation'" v-model="blk[f.key]" required>
                  <option v-for="x in list.filter(x => x.id !== form.id)" :key="x.id" :value="x.id">{{ x.name }}</option>
                </select>
              </div>
            </div>
          </div>
          <div class="adds">
            <button v-for="(m, k) in meta[group]" :key="k" type="button" class="btn" @click="addBlock(group, k)">＋ {{ lbl(group, k) }}</button>
          </div>
        </section>

        <p v-if="err" class="err">{{ err }}</p>
        <div class="foot">
          <button v-if="form.id" type="button" class="btn danger" @click="remove">{{ t('common.delete') }}</button>
          <label class="chk"><input v-model="form.enabled" type="checkbox"> {{ t('automations.enabled') }}</label>
          <span class="grow" />
          <button class="btn primary">{{ t('common.save') }}</button>
        </div>
      </form>
    </Sheet>

    <Sheet v-if="runs" :title="runs.name" @close="runs = null">
      <p v-if="!runs.items.length" class="empty">{{ t('automations.never') }}</p>
      <div v-for="r in runs.items" :key="r.id" class="run" :class="{ bad: !r.ok }">
        <span>{{ r.ok ? '✓' : '✕' }}</span>
        <div><b>{{ d(new Date(r.ts), 'long') }}</b><small>{{ r.trigger }} · {{ r.duration_ms }} ms</small><small v-if="r.error" class="err">{{ r.error }}</small></div>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.auto { padding: 0 20px 40px; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 10px; }
.hint, .empty { color: var(--dim); }
.row { display: flex; align-items: center; gap: 16px; padding: 16px 4px; border-bottom: 1px solid var(--line); }
.row.off .info { opacity: .5; }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; cursor: pointer; }
.info b { font-size: 20px; font-weight: 400; }
.info small, .run small { color: var(--dim); display: block; }
.sw { width: 64px; height: 36px; border-radius: 18px; border: 1px solid var(--line-strong); background: rgba(255,255,255,.06); position: relative; cursor: pointer; flex: none; }
.sw span { position: absolute; top: 3px; left: 3px; width: 28px; height: 28px; border-radius: 50%; background: var(--dim); transition: .2s; }
.sw.on { background: rgba(34,211,238,.25); border-color: var(--cyan); }
.sw.on span { left: 31px; background: var(--cyan); box-shadow: 0 0 12px var(--cyan); }
.grid2 { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; }
.grp { margin: 18px 0; padding-left: 14px; border-left: 3px solid var(--cyan); }
.grp.conditions { border-left-color: #a78bfa; }
.grp.actions { border-left-color: #34d399; }
.grp h3 { margin: 0 0 10px; font-weight: 400; letter-spacing: .2em; text-transform: uppercase; font-size: 15px; }
.blk { background: rgba(255,255,255,.03); border: 1px solid var(--line); padding: 10px 12px; margin-bottom: 10px; }
.bh { display: flex; justify-content: space-between; align-items: center; }
.fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.field.wide { grid-column: 1 / -1; }
.days { display: flex; gap: 6px; flex-wrap: wrap; }
.days .btn { min-width: 52px; }
.adds { display: flex; flex-wrap: wrap; gap: 6px; }
.adds .btn { font-size: 14px; }
.foot { display: flex; gap: 12px; align-items: center; margin-top: 20px; }
.grow { flex: 1; }
.chk { display: flex; gap: 8px; align-items: center; }
.err { color: #f87171; }
.run { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.run.bad > span { color: #f87171; }
@media (max-width: 700px) { .grid2 { grid-template-columns: 1fr; } .head { flex-direction: column; align-items: stretch; } }
</style>
