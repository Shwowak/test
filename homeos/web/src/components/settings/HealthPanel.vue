<script setup>
import { ref, computed, onMounted, onBeforeUnmount, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { errorText } from '../../i18n.js'
import { setLite } from '../../display.js'

const { t, te, d } = useI18n()
const user = inject('user')
const canManage = computed(() => user.value?.permissions?.includes('system.manage'))
const h = ref(null)
const msg = ref('')
const lite = ref(document.documentElement.classList.contains('lite'))
let timer = null

async function load() { try { h.value = await api('GET', '/system/health') } catch {} }
onMounted(() => { load(); timer = setInterval(load, 10000) })
onBeforeUnmount(() => clearInterval(timer))

const status = computed(() => !h.value ? 'ok' : h.value.findings.some(f => f.level === 'error') ? 'error' : h.value.findings.length ? 'warning' : 'ok')
const ftext = f => te('health.f.' + f.id) ? t('health.f.' + f.id, f.data) : f.id
async function fix(name) {
  msg.value = ''
  try { const r = await api('POST', '/system/health/fix', { fix: name }); msg.value = `✓ ${t('health.fixes.' + name)} – ${r.result}`; load() } catch (e) { msg.value = errorText(e) }
}
async function toggleAuto() { await api('PUT', '/system/health', { autofix: !h.value.autofix }); load() }
function toggleLite() { lite.value = !lite.value; setLite(lite.value) }
const spark = key => {
  const v = (h.value?.history ?? []).map(x => x[key] ?? 0)
  if (v.length < 2) return ''
  const max = Math.max(...v, key === 'mem' ? 1 : 0.001)
  return v.map((x, i) => `${(i / (v.length - 1)) * 100},${30 - (x / max) * 28}`).join(' ')
}
const mb = b => b ? Math.round(b / 1048576) + ' MB' : '—'
</script>

<template>
  <div v-if="h" class="hp">
    <div class="head">
      <span class="lamp" :class="status" />
      <b>{{ t('health.status.' + status) }}</b>
      <span class="grow" />
      <a v-if="canManage" class="btn" href="/api/v1/system/diagnostics" download>⇣ {{ t('health.export') }}</a>
    </div>

    <div v-for="f in h.findings" :key="f.id" class="find" :class="f.level">
      <span>{{ f.level === 'error' ? '⛔' : '⚠' }}</span>
      <div class="grow">{{ ftext(f) }}</div>
      <button v-if="canManage && f.fix" class="btn" @click="fix(f.fix)">🛠 {{ t('health.fixes.' + f.fix) }}</button>
    </div>
    <p v-if="!h.findings.length" class="okmsg">✓ {{ t('health.all_ok') }}</p>
    <p v-if="msg" class="msg">{{ msg }}</p>

    <div class="grid">
      <div class="m"><div class="k">{{ t('health.loop') }}</div><div class="v">{{ h.current?.loop_p99_ms }} ms</div><svg viewBox="0 0 100 30" preserveAspectRatio="none"><polyline :points="spark('loop')" /></svg></div>
      <div class="m"><div class="k">{{ t('system.cpu') }}</div><div class="v">{{ h.current?.load?.toFixed(2) }}</div><svg viewBox="0 0 100 30" preserveAspectRatio="none"><polyline :points="spark('load')" /></svg></div>
      <div class="m"><div class="k">{{ t('system.memory') }}</div><div class="v">{{ Math.round((1 - h.current.mem.free / h.current.mem.total) * 100) }} %</div><svg viewBox="0 0 100 30" preserveAspectRatio="none"><polyline :points="spark('mem')" /></svg></div>
      <div class="m"><div class="k">{{ t('health.temp') }}</div><div class="v">{{ h.current?.temp ? Math.round(h.current.temp) + ' °C' : '—' }}</div><svg viewBox="0 0 100 30" preserveAspectRatio="none"><polyline :points="spark('temp')" /></svg></div>
      <div v-if="h.current?.browser_mem" class="m"><div class="k">{{ t('health.browser') }}</div><div class="v">{{ mb(h.current.browser_mem) }}</div></div>
    </div>

    <div v-if="canManage" class="opts">
      <label class="chk"><input type="checkbox" :checked="h.autofix" @change="toggleAuto"> {{ t('health.autofix') }}</label>
      <label class="chk"><input type="checkbox" :checked="lite" @change="toggleLite"> {{ t('health.lite') }}</label>
      <div class="row">
        <button class="btn" @click="fix('restart_kiosk')">⟳ {{ t('health.fixes.restart_kiosk') }}</button>
        <button class="btn" @click="fix('restart_plugins')">⟳ {{ t('health.fixes.restart_plugins') }}</button>
        <button class="btn" @click="fix('cleanup')">🧹 {{ t('health.fixes.cleanup') }}</button>
      </div>
    </div>

    <template v-if="h.fixes.length">
      <h4>{{ t('health.history') }}</h4>
      <div v-for="(x, i) in h.fixes.slice(0, 8)" :key="i" class="fx">{{ d(new Date(x.ts), 'long') }} · {{ t('health.fixes.' + x.name) }} · {{ x.by === 'auto' ? t('health.auto') : x.by }} · {{ x.result }}</div>
    </template>
    <template v-if="h.slow.length">
      <h4>{{ t('health.slow') }}</h4>
      <div v-for="(x, i) in h.slow.slice(-5).reverse()" :key="i" class="fx">{{ x.url }} · {{ x.ms }} ms</div>
    </template>
  </div>
</template>

<style scoped>
.hp { margin-bottom: 22px; }
.head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 18px; }
.lamp { width: 16px; height: 16px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 12px var(--ok); }
.lamp.warning { background: var(--warn); box-shadow: 0 0 12px var(--warn); }
.lamp.error { background: var(--err); box-shadow: 0 0 12px var(--err); }
.grow { flex: 1; min-width: 0; }
.find { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-left: 3px solid var(--warn); background: rgba(245, 158, 11, .08); margin-bottom: 6px; }
.find.error { border-color: var(--err); background: rgba(239, 68, 68, .08); }
.okmsg { color: var(--ok); }
.msg { color: var(--cyan); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin: 12px 0; }
.m { padding: 10px; border: 1px solid var(--line); }
.k { font-size: 11px; letter-spacing: .15em; text-transform: uppercase; color: var(--dim); }
.v { font-family: var(--mono); font-size: 22px; margin: 4px 0; }
.m svg { width: 100%; height: 30px; }
.m polyline { fill: none; stroke: var(--cyan); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.opts { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; }
.chk { display: flex; gap: 8px; align-items: center; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
h4 { margin: 14px 0 6px; font-weight: 400; letter-spacing: .12em; text-transform: uppercase; font-size: 12px; color: var(--dim); }
.fx { font-size: 13px; color: var(--dim); padding: 3px 0; }
</style>
