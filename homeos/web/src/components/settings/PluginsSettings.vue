<script setup>
import { ref, computed, onMounted, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, ApiError } from '../../api.js'
import { errorText } from '../../i18n.js'
import { store, loadDevices } from '../../devices.js'
import { plugins, loadPlugins, loc } from '../../plugins.js'

const { t, te, d, locale } = useI18n()
const user = inject('user')
const canManage = computed(() => user.value?.permissions?.includes('plugins.manage'))
const meta = ref(null)
const open = ref(null)
const form = ref(null)
const msg = ref('')
const busy = ref(false)
const keysText = ref('')
const file = ref(null)

onMounted(async () => {
  await loadPlugins()
  meta.value = await api('GET', '/plugins/meta')
  keysText.value = meta.value.trustedKeys.join('\n')
  if (!store.loaded) loadDevices().catch(() => {})
})

const devices = computed(() => Object.values(store.devices).filter(x => x.adopted).sort((a, b) => a.name.localeCompare(b.name)))
const permText = p => te('plugins.perms.' + p.replace(':', '_')) ? t('plugins.perms.' + p.replace(':', '_')) : p
const stateText = s => t('plugins.state.' + (s?.state ?? 'stopped'))

function toggleOpen(p) {
  msg.value = ''
  if (open.value === p.id) { open.value = null; return }
  open.value = p.id
  const cfg = { ...p.config }
  for (const f of p.manifest.config ?? []) if (f.type === 'list') cfg[f.key] = (cfg[f.key] ?? []).join('\n')
  form.value = { config: cfg, granted: [...p.granted] }
}

async function update(p, body) {
  msg.value = ''
  try {
    const r = await api('PUT', `/plugins/${encodeURIComponent(p.id)}`, body)
    Object.assign(p, r)
    return r
  } catch (e) { msg.value = errorText(e) }
}

async function saveConfig(p) {
  const config = { ...form.value.config }
  for (const f of p.manifest.config ?? []) if (f.type === 'list') config[f.key] = String(config[f.key] ?? '').split('\n').map(s => s.trim()).filter(Boolean)
  if (await update(p, { config, granted: form.value.granted })) msg.value = t('plugins.saved')
}

const togglePerm = perm => {
  const g = form.value.granted
  form.value.granted = g.includes(perm) ? g.filter(x => x !== perm) : [...g, perm]
}

async function restart(p) {
  await api('POST', `/plugins/${encodeURIComponent(p.id)}/restart`)
}

async function remove(p) {
  if (!confirm(t('plugins.confirm_remove', { name: loc(p.manifest.name, locale.value) }))) return
  await api('DELETE', `/plugins/${encodeURIComponent(p.id)}`)
  open.value = null
  await loadPlugins()
}

async function install(trust = false) {
  const f = file.value?.files?.[0]
  if (!f) return
  busy.value = true
  msg.value = ''
  try {
    const res = await fetch(`/api/v1/plugins/install${trust ? '?trust=true' : ''}`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: f, credentials: 'same-origin' })
    const body = await res.json()
    if (!res.ok) throw new ApiError(res.status, body.error, body.details)
    file.value.value = ''
    await loadPlugins()
    msg.value = t('plugins.installed', { name: loc(body.manifest.name, locale.value) })
  } catch (e) {
    if (e.code === 'plugin.unverified' && !trust) {
      const m = e.details.manifest
      const perms = (m.permissions ?? []).map(permText).join(', ') || '—'
      if (confirm(t(e.details.signed ? 'plugins.confirm_untrusted' : 'plugins.confirm_unsigned', { name: loc(m.name, locale.value), perms }))) return install(true)
    } else msg.value = errorText(e) + (e.details?.message ? ` (${e.details.message})` : '')
  } finally { busy.value = false }
}

async function saveSecurity() {
  await api('PUT', '/plugins/meta', { allowUnsigned: meta.value.allowUnsigned, trustedKeys: keysText.value.split('\n').map(s => s.trim()).filter(Boolean) })
  msg.value = t('plugins.saved')
}
</script>

<template>
  <div class="plg">
    <p class="hint">{{ t('plugins.hint') }}</p>
    <p v-if="msg" class="msg">{{ msg }}</p>

    <div v-for="p in plugins.list" :key="p.id" class="card" :class="{ off: !p.enabled }">
      <div class="head" @click="toggleOpen(p)">
        <span class="ico">{{ p.manifest.icon ?? '◈' }}</span>
        <div class="txt">
          <b>{{ loc(p.manifest.name, locale) }}</b> <small>v{{ p.version }}</small>
          <small class="desc">{{ loc(p.manifest.description, locale) }}</small>
          <div class="chips">
            <span class="chip" :class="p.verified ? 'ok' : 'warn'">{{ p.source === 'builtin' ? t('plugins.builtin') : p.verified ? '✓ ' + t('plugins.verified') : '⚠ ' + t('plugins.unverified') }}</span>
            <span class="chip" :class="p.status?.state">{{ stateText(p.status) }}</span>
            <span v-if="p.status?.error" class="chip err">{{ p.status.error }}</span>
          </div>
        </div>
        <button v-if="canManage" class="sw" :class="{ on: p.enabled }" :aria-label="t('plugins.enabled')" @click.stop="update(p, { enabled: !p.enabled })"><span /></button>
      </div>

      <div v-if="open === p.id && form" class="body">
        <h4>{{ t('plugins.permissions') }}</h4>
        <p v-if="!(p.manifest.permissions ?? []).length" class="hint">{{ t('plugins.no_permissions') }}</p>
        <div class="perms">
          <button v-for="perm in p.manifest.permissions ?? []" :key="perm" type="button" class="btn" :class="{ active: form.granted.includes(perm) }" :disabled="!canManage" @click="togglePerm(perm)">
            {{ form.granted.includes(perm) ? '✓' : '✕' }} {{ permText(perm) }}
          </button>
        </div>

        <template v-if="(p.manifest.config ?? []).length">
          <h4>{{ t('plugins.config') }}</h4>
          <div v-for="f in p.manifest.config" :key="f.key" class="field">
            <label>{{ loc(f.label, locale) || f.key }}</label>
            <textarea v-if="f.type === 'list'" v-model="form.config[f.key]" rows="3" :disabled="!canManage" />
            <select v-else-if="f.type === 'select'" v-model="form.config[f.key]" :disabled="!canManage"><option v-for="o in f.options" :key="o" :value="o">{{ o }}</option></select>
            <label v-else-if="f.type === 'bool'" class="chk"><input v-model="form.config[f.key]" type="checkbox" :disabled="!canManage"> {{ t('plugins.on') }}</label>
            <select v-else-if="f.type === 'device'" v-model="form.config[f.key]" :disabled="!canManage">
              <option :value="null">—</option>
              <option v-for="dv in devices" :key="dv.id" :value="dv.id">{{ dv.name }}</option>
            </select>
            <select v-else-if="f.type === 'devices'" v-model="form.config[f.key]" multiple :disabled="!canManage">
              <option v-for="dv in devices" :key="dv.id" :value="dv.id">{{ dv.name }}</option>
            </select>
            <input v-else v-model="form.config[f.key]" :type="f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text'" step="any" :disabled="!canManage">
          </div>
        </template>

        <small class="hint">{{ p.id }} · {{ t('plugins.updated') }} {{ d(new Date(p.updated_at), 'long') }}{{ p.signer ? ' · ' + p.signer : '' }}</small>
        <div v-if="canManage" class="row">
          <button v-if="p.source !== 'builtin'" type="button" class="btn danger" @click="remove(p)">{{ t('plugins.remove') }}</button>
          <button v-if="p.enabled" type="button" class="btn" @click="restart(p)">⟳ {{ t('plugins.restart') }}</button>
          <span class="grow" />
          <button class="btn primary" @click="saveConfig(p)">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>

    <template v-if="canManage && meta">
      <h3>{{ t('plugins.install') }}</h3>
      <div class="row">
        <input ref="file" type="file" accept=".sbp,.zip">
        <button class="btn primary" :disabled="busy" @click="install()">⇪ {{ t('plugins.install') }}</button>
      </div>
      <h3>{{ t('plugins.security') }}</h3>
      <label class="chk"><input v-model="meta.allowUnsigned" type="checkbox"> {{ t('plugins.allow_unsigned') }}</label>
      <div class="field">
        <label>{{ t('plugins.trusted_keys') }}</label>
        <textarea v-model="keysText" rows="3" class="mono" />
      </div>
      <button class="btn" @click="saveSecurity">{{ t('common.save') }}</button>
    </template>
  </div>
</template>

<style scoped>
.hint { color: var(--dim); }
.msg { color: var(--cyan); }
.card { border-bottom: 1px solid var(--line); }
.card.off .head { opacity: .55; }
.head { display: flex; align-items: center; gap: 16px; padding: 14px 4px; cursor: pointer; }
.ico { font-size: 32px; width: 44px; text-align: center; }
.txt { flex: 1; min-width: 0; }
.txt b { font-size: 19px; font-weight: 400; }
.txt small { color: var(--dim); }
.desc { display: block; margin-top: 2px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.chip { font-size: 12px; padding: 2px 8px; border: 1px solid var(--line-strong); color: var(--dim); }
.chip.ok, .chip.running { color: var(--ok); border-color: var(--ok); }
.chip.warn, .chip.starting { color: var(--warn); border-color: var(--warn); }
.chip.err, .chip.error { color: var(--err); border-color: var(--err); }
.body { padding: 4px 4px 18px 64px; }
h4 { margin: 14px 0 8px; font-weight: 400; letter-spacing: .15em; text-transform: uppercase; font-size: 13px; color: var(--dim); }
h3 { margin: 28px 0 10px; font-weight: 400; }
.perms { display: flex; flex-wrap: wrap; gap: 6px; }
.perms .btn { font-size: 14px; }
.row { display: flex; gap: 12px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
.grow { flex: 1; }
.chk { display: flex; gap: 8px; align-items: center; }
.mono { font-family: var(--mono); font-size: 12px; }
.sw { width: 64px; height: 36px; border-radius: 18px; border: 1px solid var(--line-strong); background: rgba(255,255,255,.06); position: relative; cursor: pointer; flex: none; }
.sw span { position: absolute; top: 3px; left: 3px; width: 28px; height: 28px; border-radius: 50%; background: var(--dim); transition: .2s; }
.sw.on { background: rgba(34,211,238,.25); border-color: var(--cyan); }
.sw.on span { left: 31px; background: var(--cyan); box-shadow: 0 0 12px var(--cyan); }
@media (max-width: 700px) { .body { padding-left: 4px; } }
</style>
