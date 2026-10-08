<script setup>
import { ref, computed, onMounted, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api.js'
import Board from './Board.vue'
import Sheet from './Sheet.vue'
import SourceManager from './SourceManager.vue'
import Settings from './settings/Settings.vue'
import DevicesView from './devices/DevicesView.vue'
import { startLive, stopLive, loadIntegrations } from '../devices.js'
import { onBeforeUnmount } from 'vue'

const { t } = useI18n()
const user = inject('user')
const can = p => user.value?.permissions?.includes(p)
const emit = defineEmits(['logout'])
const showSettings = ref(false)
const view = ref('dashboard')

const dashboards = ref([])
const activeId = ref(null)
const editing = ref(false)
const railHidden = ref(false)
try { railHidden.value = localStorage.getItem('homeos.railHidden') === '1' } catch {}
function toggleRail() {
  railHidden.value = !railHidden.value
  try { localStorage.setItem('homeos.railHidden', railHidden.value ? '1' : '0') } catch {}
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
}
const meta = ref(null)
const sources = ref([])
const showSources = ref(false)
const dashForm = ref(null)

const active = computed(() => dashboards.value.find(d => d.id === activeId.value))

async function loadDashboards() {
  dashboards.value = await api('GET', '/dashboards')
  if (!dashboards.value.some(d => d.id === activeId.value)) activeId.value = dashboards.value[0]?.id ?? null
}

async function loadSources() {
  sources.value = can('sources.view') ? await api('GET', '/sources') : []
}

onBeforeUnmount(stopLive)

onMounted(async () => {
  if (can('devices.view')) { startLive(); loadIntegrations().catch(() => {}) }
  meta.value = await api('GET', '/meta')
  const saved = Number(localStorage.getItem('homeos.dashboard'))
  await Promise.all([loadDashboards(), loadSources()])
  if (dashboards.value.some(d => d.id === saved)) activeId.value = saved
})

function select(id) {
  view.value = 'dashboard'
  activeId.value = id
  try { localStorage.setItem('homeos.dashboard', String(id)) } catch {}
}

function step(dir) {
  const i = dashboards.value.findIndex(d => d.id === activeId.value)
  const next = dashboards.value[i + dir]
  if (next) select(next.id)
}

let touchX = null
function onTouchStart(e) {
  if (editing.value || view.value !== 'dashboard' || e.touches.length !== 1) return
  touchX = e.touches[0].clientX
}
function onTouchEnd(e) {
  if (touchX === null) return
  const dx = e.changedTouches[0].clientX - touchX
  touchX = null
  if (Math.abs(dx) > 120) step(dx < 0 ? 1 : -1)
}

function fullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen?.()
}

function newDashboard() {
  dashForm.value = { name: '', icon: '◈', style: 'seamless' }
}
function editDashboard() {
  dashForm.value = { ...active.value }
}
async function saveDashboard() {
  const f = dashForm.value
  const d = f.id ? await api('PUT', `/dashboards/${f.id}`, f) : await api('POST', '/dashboards', f)
  dashForm.value = null
  await loadDashboards()
  select(d.id)
}
async function cycleStyle() {
  if (!can('dashboards.edit')) return
  const keys = meta.value.dashboardStyles
  const next = keys[(keys.indexOf(active.value.style) + 1) % keys.length]
  await api('PUT', `/dashboards/${active.value.id}`, { style: next })
  active.value.style = next
}

async function deleteDashboard() {
  if (!confirm(t('dashboard.confirm_delete', { name: dashForm.value.name }))) return
  await api('DELETE', `/dashboards/${dashForm.value.id}`)
  dashForm.value = null
  await loadDashboards()
}

const icons = ['⌂', '◈', '⚡', '☀', '♨', '☎', '♫', '⚙', '⛨', '✦', '❄', '☕', '⌁', '◉', '▤', '♥']
</script>

<template>
  <div class="shell" :class="{ 'no-rail': railHidden }" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
    <nav v-show="!railHidden" class="rail">
      <button class="tab" :aria-label="t('nav.hide')" @click="toggleRail"><span class="ico">⟨</span><span class="nm">{{ t('nav.hide') }}</span></button>
      <button v-for="d in dashboards" :key="d.id" class="tab" :class="{ on: view === 'dashboard' && d.id === activeId }" @click="select(d.id)">
        <span class="ico">{{ d.icon }}</span><span class="nm">{{ d.name }}</span>
      </button>
      <button v-if="editing" class="tab add" @click="newDashboard"><span class="ico">＋</span><span class="nm">{{ t('common.new') }}</span></button>
      <div class="spacer" />
      <button v-if="can('devices.view')" class="tab" :class="{ on: view === 'devices' }" @click="view = 'devices'; editing = false"><span class="ico">▦</span><span class="nm">{{ t('nav.devices') }}</span></button>
      <button v-if="can('sources.view')" class="tab" @click="showSources = true"><span class="ico">⌬</span><span class="nm">{{ t('nav.sources') }}</span></button>
      <button class="tab" @click="showSettings = true"><span class="ico">⚙</span><span class="nm">{{ t('nav.settings') }}</span></button>
      <button class="tab" @click="fullscreen"><span class="ico">⛶</span><span class="nm">{{ t('nav.fullscreen') }}</span></button>
      <button class="tab" @click="emit('logout')"><span class="ico">⏻</span><span class="nm">{{ t('nav.logout') }}</span></button>
    </nav>

    <section class="main">
      <header class="top">
        <div>
          <div class="label">{{ view === 'devices' ? t('nav.devices') : t('dashboard.label') }}</div>
          <h1>{{ view === 'devices' ? t('devices.title') : active?.name ?? '—' }}</h1>
        </div>
        <div class="actions">
          <button v-if="railHidden" class="btn icon" :aria-label="t('nav.show')" @click="toggleRail">☰</button>
          <button v-if="view === 'dashboard' && active && meta" class="btn" @click="cycleStyle">◐ {{ t('styles.' + active.style) }}</button>
          <button v-if="editing && active" class="btn" @click="editDashboard">{{ t('dashboard.label') }} ✎</button>
          <button v-if="view === 'dashboard' && can('dashboards.edit')" class="btn" :class="{ active: editing, primary: editing }" @click="editing = !editing">
            {{ editing ? t('common.done') : '✎ ' + t('common.edit') }}
          </button>
        </div>
      </header>

      <DevicesView v-if="view === 'devices'" />
      <Board v-else-if="active && meta" :key="active.id" :dashboard="active" :editing="editing" :meta="meta" :sources="sources" />
      <p v-else-if="meta" class="empty">{{ t('dashboard.empty') }}</p>
    </section>

    <Sheet v-if="showSources" :title="t('sources.title')" @close="showSources = false">
      <SourceManager :meta="meta" :sources="sources" @changed="loadSources" />
    </Sheet>

    <Sheet v-if="showSettings" :title="t('settings.title')" wide @close="showSettings = false">
      <Settings :meta="meta" @changed="loadDashboards" />
    </Sheet>

    <Sheet v-if="dashForm" :title="dashForm.id ? t('dashboard.edit') : t('dashboard.new')" @close="dashForm = null">
      <form @submit.prevent="saveDashboard">
        <div class="field"><label>{{ t('common.name') }}</label><input v-model="dashForm.name" required :placeholder="t('dashboard.name_placeholder')"></div>
        <div class="field">
          <label>{{ t('dashboard.style') }}</label>
          <div class="styles">
            <button v-for="k in meta.dashboardStyles" :key="k" type="button" class="btn" :class="{ active: dashForm.style === k }" @click="dashForm.style = k">{{ t('styles.' + k) }}</button>
          </div>
        </div>
        <div class="field">
          <label>{{ t('dashboard.icon') }}</label>
          <div class="icons">
            <button v-for="i in icons" :key="i" type="button" class="btn icon" :class="{ active: dashForm.icon === i }" @click="dashForm.icon = i">{{ i }}</button>
          </div>
        </div>
        <div class="row">
          <button v-if="dashForm.id" type="button" class="btn danger" @click="deleteDashboard">{{ t('common.delete') }}</button>
          <span class="grow" />
          <button class="btn primary">{{ t('common.save') }}</button>
        </div>
      </form>
    </Sheet>
  </div>
</template>

<style scoped>
.shell { display: flex; height: 100vh; height: 100dvh; }
.rail {
  width: 104px; flex: none; display: flex; flex-direction: column; gap: 8px; padding: 16px 10px;
  border-right: 1px solid var(--line); background: rgba(2, 6, 23, 0.55); backdrop-filter: blur(14px); overflow-y: auto;
}
.tab {
  min-height: 80px; border: 1px solid transparent; border-radius: 16px; background: none; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--dim);
}
.tab .ico { font-size: 28px; line-height: 1; }
.tab .nm { font-size: 12px; max-width: 84px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab.on { color: var(--text); border-color: var(--line-strong); background: rgba(34, 211, 238, 0.08); box-shadow: 0 0 22px rgba(34, 211, 238, 0.2); }
.tab.on .ico { color: var(--cyan); text-shadow: 0 0 12px var(--cyan); }
.tab:active { transform: scale(0.95); }
.tab.add { border: 1px dashed var(--line-strong); color: var(--cyan); }
.spacer { flex: 1; }
.main { flex: 1; min-width: 0; overflow-y: auto; padding: 0; }
.top { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding: 16px 20px; }
.top h1 { margin: 4px 0 0; font-size: 34px; font-weight: 300; letter-spacing: 0.02em; }
.actions { display: flex; gap: 10px; }
.empty { color: var(--dim); font-size: 20px; padding: 40px 6px; }
.icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); gap: 8px; }
.styles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.row { display: flex; gap: 12px; align-items: center; }
.grow { flex: 1; }
@media (max-width: 700px) {
  .shell { flex-direction: column-reverse; }
  .rail { width: auto; flex-direction: row; padding: 6px; border-right: 0; border-top: 1px solid var(--line); overflow-x: auto; }
  .tab { min-width: 76px; min-height: 64px; }
  .spacer { display: none; }
  .top h1 { font-size: 26px; }
}
</style>
