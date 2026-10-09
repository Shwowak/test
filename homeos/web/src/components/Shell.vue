<script setup>
import { ref, computed, onMounted, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api.js'
import Board from './Board.vue'
import Sheet from './Sheet.vue'
import SourceManager from './SourceManager.vue'
import Settings from './settings/Settings.vue'
import DevicesView from './devices/DevicesView.vue'
import AutomationsView from './automations/AutomationsView.vue'
import AlertLayer from './notify/AlertLayer.vue'
import AlarmLayer from './alarm/AlarmLayer.vue'
import NotificationCenter from './notify/NotificationCenter.vue'
import { notes, unread, loadNotifications } from '../notifications.js'
import { startIdle, kiosk } from '../display.js'
import Assistant from './assistant/Assistant.vue'
import { voice } from '../speech.js'
import Unlock from './Unlock.vue'
import { features, loadFeatures } from '../features.js'
import { computed as comp2 } from 'vue'
import { startLive, stopLive, loadIntegrations, loadDevices } from '../devices.js'
import { onBeforeUnmount, watch } from 'vue'

const { t } = useI18n()
const user = inject('user')
const can = p => user.value?.permissions?.includes(p)
const setUser = inject('setUser')
const isViewer = comp2(() => user.value?.role === 'guest')
const unlock = ref(null)
function requireAdmin(action, perm) {
  if (can(perm)) return runAction(action)
  unlock.value = { action, perm }
}
function runAction(action) {
  if (action === 'settings') showSettings.value = true
  else if (action === 'edit') editing.value = !editing.value
}
function onUnlocked(u) {
  const pending = unlock.value
  unlock.value = null
  setUser(u)
  setTimeout(() => runAction(pending.action), 50)
}
let adminIdle = Date.now()
const bump = () => { adminIdle = Date.now() }
setInterval(() => {
  if (isViewer.value || !features.viewer || !features.admin_timeout) return
  if (Date.now() - adminIdle > features.admin_timeout * 60000) { showSettings.value = false; editing.value = false; emit('logout') }
}, 15000)
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, bump, { passive: true })
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || (window.__sheets ?? []).length || document.querySelector('.osk')) return
  if (notes.camera) { notes.camera = null; return }
  if (editing.value) { editing.value = false; return }
  if (view.value !== 'dashboard') { view.value = 'dashboard'; return }
  if (railHidden.value) toggleRail()
})
window.addEventListener('keydown', e => {
  if ((window.__sheets ?? []).length || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
  if (e.key === 'PageDown' || (e.ctrlKey && e.key === 'ArrowRight')) { e.preventDefault(); step(1) }
  else if (e.key === 'PageUp' || (e.ctrlKey && e.key === 'ArrowLeft')) { e.preventDefault(); step(-1) }
  else if (e.key === 'Home' && !e.ctrlKey) { e.preventDefault(); if (dashboards.value[0]) select(dashboards.value[0].id) }
})
const emit = defineEmits(['logout'])
const showSettings = ref(false)
const showNotes = ref(false)
const assistant = ref(null)
watch(() => notes.dashboard, x => { if (x && dashboards.value.some(d => d.id === x.id)) select(x.id) })
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
  if (can('notifications.view')) loadNotifications().catch(() => {})
  loadFeatures()
  startIdle()
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
let touchY = 0
function onTouchStart(e) {
  if (editing.value || view.value !== 'dashboard' || e.touches.length !== 1) return
  touchX = e.touches[0].clientX
  touchY = e.touches[0].clientY
}
function onTouchEnd(e) {
  if (touchX === null) return
  const dx = e.changedTouches[0].clientX - touchX
  touchX = null
  const dy = e.changedTouches[0].clientY - touchY
  if (touchY < 60 && dy > 120 && can('notifications.view')) { showNotes.value = true; return }
  if (Math.abs(dx) > 120) step(dx < 0 ? 1 : -1)
}

function fullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen?.()
}

const autogen = ref(null)
const autogenBusy = ref(false)
const autogenRooms = ref(true)
async function newDashboard() {
  dashForm.value = { name: '', icon: '◈', style: 'seamless' }
  autogen.value = null
  autogen.value = await api('POST', '/dashboards/generate', { dryRun: true }).catch(() => null)
}
async function runAutogen() {
  autogenBusy.value = true
  try {
    const r = await api('POST', '/dashboards/generate', { rooms: autogenRooms.value, replace: true })
    autogen.value = { ...r, done: true }
    await loadDashboards()
    if (r.first) select(r.first)
    dashForm.value = null
    loadDevices().catch(() => {})
  } finally { autogenBusy.value = false }
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
      <button v-if="can('devices.view') && !isViewer" class="tab" :class="{ on: view === 'devices' }" @click="view = 'devices'; editing = false"><span class="ico">▦</span><span class="nm">{{ t('nav.devices') }}</span></button>
      <button v-if="can('automations.view') && features.automations && !isViewer" class="tab" :class="{ on: view === 'automations' }" @click="view = 'automations'; editing = false"><span class="ico">⟳</span><span class="nm">{{ t('nav.automations') }}</span></button>
      <button v-if="can('ai.use') && features.assistant" class="tab" @click="assistant = { listen: false }"><span class="ico">✦</span><span class="nm">{{ t('nav.assistant') }}</span></button>
      <button v-if="can('sources.view')" class="tab" @click="showSources = true"><span class="ico">⌬</span><span class="nm">{{ t('nav.sources') }}</span></button>
      <button class="tab" @click="requireAdmin('settings', 'system.view')"><span class="ico">{{ isViewer ? '🔒' : '⚙' }}</span><span class="nm">{{ t('nav.settings') }}</span></button>
      <button v-if="!kiosk" class="tab" @click="fullscreen"><span class="ico">⛶</span><span class="nm">{{ t('nav.fullscreen') }}</span></button>
      <button v-if="!isViewer" class="tab" @click="emit('logout')"><span class="ico">{{ features.viewer ? '🔒' : '⏻' }}</span><span class="nm">{{ features.viewer ? t('nav.lock') : t('nav.logout') }}</span></button>
    </nav>

    <button v-if="railHidden" class="edge" :aria-label="t('nav.show')" @click="toggleRail">›</button>
    <section class="main">
      <header class="top">
        <div>
          <div class="label">{{ view === 'devices' ? t('nav.devices') : view === 'automations' ? t('nav.automations') : t('dashboard.label') }}</div>
          <h1>{{ view === 'devices' ? t('devices.title') : view === 'automations' ? t('automations.title') : active?.name ?? '—' }}</h1>
        </div>
        <div class="actions">
          <span v-if="voice.recording" class="recind" :title="t('assistant.listening')">● 🎙</span>
          <button v-if="can('ai.use') && features.assistant" class="btn icon" :aria-label="t('assistant.speak')" @click="assistant = { listen: true }">🎙</button>
          <button v-if="can('notifications.view')" class="btn icon bell" :class="{ hot: unread }" :aria-label="t('notifications.title')" @click="showNotes = true">🔔<span v-if="unread" class="badge">{{ unread }}</span></button>
          <button v-if="railHidden" class="btn icon" :aria-label="t('nav.show')" @click="toggleRail">☰</button>
          <button v-if="view === 'dashboard' && active && meta && !isViewer" class="btn" @click="cycleStyle">◐ {{ t('styles.' + active.style) }}</button>
          <button v-if="editing && active" class="btn" @click="editDashboard">{{ t('dashboard.label') }} ✎</button>
          <button v-if="view === 'dashboard' && (can('dashboards.edit') || isViewer)" class="btn" :class="{ active: editing, primary: editing }" @click="requireAdmin('edit', 'dashboards.edit')">
            {{ editing ? t('common.done') : '✎ ' + t('common.edit') }}
          </button>
        </div>
      </header>

      <DevicesView v-if="view === 'devices'" />
      <AutomationsView v-else-if="view === 'automations'" />
      <Board v-else-if="active && meta" :key="active.id" :dashboard="active" :editing="editing" :meta="meta" :sources="sources" />
      <p v-else-if="meta" class="empty">{{ t('dashboard.empty') }}</p>
    </section>

    <Sheet v-if="unlock" :title="t('unlock.title')" @close="unlock = null">
      <Unlock @unlocked="onUnlocked" />
    </Sheet>
    <Sheet v-if="showNotes" :title="t('notifications.title')" @close="showNotes = false">
      <NotificationCenter />
    </Sheet>
    <Sheet v-if="assistant" :title="t('nav.assistant')" @close="assistant = null">
      <Assistant :auto-listen="assistant.listen" />
    </Sheet>
    <AlertLayer />
    <AlarmLayer />

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
      <div v-if="!dashForm.id" class="autogen">
        <div class="label sec">{{ t('autogen.title') }}</div>
        <p class="hint">{{ t('autogen.hint') }}</p>
        <p v-if="autogen" class="hint">{{ autogen.done ? t('autogen.done', autogen) : t('autogen.preview', autogen) }}</p>
        <label class="check"><input v-model="autogenRooms" type="checkbox"> {{ t('autogen.per_room') }}</label>
        <div class="row">
          <span class="grow" />
          <button type="button" class="btn primary" :disabled="autogenBusy" @click="runAutogen">✦ {{ t('autogen.run') }}</button>
        </div>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.shell { display: flex; height: calc(100vh / var(--zoom, 1)); height: calc(100dvh / var(--zoom, 1)); }
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
.actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; min-width: 0; }
.top > div:first-child { min-width: 0; }
.edge { position: fixed; left: 0; top: 0; bottom: 0; width: 22px; z-index: 50; background: linear-gradient(90deg, rgba(34, 211, 238, .18), transparent); border: 0; color: var(--cyan); font-size: 20px; cursor: pointer; opacity: .6; }
.edge:hover, .edge:focus { opacity: 1; }
.empty { color: var(--dim); font-size: 20px; padding: 40px 6px; }
.icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); gap: 8px; }
.styles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.row { display: flex; gap: 12px; align-items: center; }
.grow { flex: 1; }
.bell { position: relative; }
.recind { color: #ef4444; align-self: center; font-size: 14px; letter-spacing: .1em; animation: recblink 1s infinite; }
@keyframes recblink { 50% { opacity: .3; } }
.bell.hot { box-shadow: 0 0 16px rgba(34, 211, 238, 0.35); }
.badge { position: absolute; top: -6px; right: -6px; min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px; background: #ef4444; color: #fff; font-size: 13px; line-height: 22px; }
@media (max-width: 700px) {
  .shell { flex-direction: column-reverse; }
  .rail { width: auto; flex-direction: row; padding: 6px; border-right: 0; border-top: 1px solid var(--line); overflow-x: auto; }
  .tab { min-width: 76px; min-height: 64px; }
  .spacer { display: none; }
  .top h1 { font-size: 26px; }
}
</style>
