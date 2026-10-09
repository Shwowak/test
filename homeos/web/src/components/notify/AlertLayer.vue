<script setup>
import { inject, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { notes, ack } from '../../notifications.js'
import CameraWidget from '../../widgets/CameraWidget.vue'
let camTimer = null
watch(() => notes.camera, c => { clearTimeout(camTimer); if (c) camTimer = setTimeout(() => { notes.camera = null }, Math.max(5000, c.until - Date.now())) })

const { t, d } = useI18n()
const user = inject('user')
const canAck = () => user.value?.permissions?.includes('notifications.manage')
const close = n => notes.toasts.splice(notes.toasts.indexOf(n), 1)
const icon = { info: 'ℹ', warning: '⚠', critical: '⛔', emergency: '🚨' }
</script>

<template>
  <div class="toasts">
    <div v-for="n in notes.toasts" :key="n.id" class="toast" :class="n.level" @click="close(n)">
      <span class="ic">{{ icon[n.level] }}</span>
      <div><b>{{ n.title }}</b><p v-if="n.message">{{ n.message }}</p></div>
    </div>
  </div>

  <div v-if="notes.overlay.length" class="overlay" :class="notes.overlay[0].level" role="alertdialog">
    <div class="box">
      <div class="big">{{ icon[notes.overlay[0].level] }}</div>
      <div class="lvl">{{ t('notifications.levels.' + notes.overlay[0].level) }}</div>
      <h2>{{ notes.overlay[0].title }}</h2>
      <p v-if="notes.overlay[0].message">{{ notes.overlay[0].message }}</p>
      <small>{{ d(new Date(notes.overlay[0].ts), 'long') }}</small>
      <button v-if="canAck()" class="btn primary ackbtn" @click="ack([notes.overlay[0].id])">✓ {{ t('notifications.acknowledge') }}</button>
      <small v-if="notes.overlay.length > 1">{{ t('notifications.more', { n: notes.overlay.length - 1 }) }}</small>
    </div>
  </div>

  <div v-if="notes.camera" class="camov" @click.self="notes.camera = null">
    <div class="camwrap"><CameraWidget :camera-id="notes.camera.id" fill /></div>
    <button class="btn camclose" @click="notes.camera = null">✕</button>
  </div>

  <div v-if="notes.display !== 'on' && !notes.overlay.length" class="screen" :class="notes.display" @click="notes.display = 'on'" />
</template>

<style scoped>
.toasts { position: fixed; top: 16px; right: 16px; z-index: 1500; display: flex; flex-direction: column; gap: 10px; width: min(420px, calc(100vw - 32px)); }
.toast { display: flex; gap: 14px; align-items: flex-start; padding: 14px 18px; background: var(--glass-strong); border: 1px solid var(--line-strong); border-left: 4px solid var(--cyan); box-shadow: 0 10px 40px rgba(0,0,0,.5); cursor: pointer; animation: in .25s ease-out; }
.toast.warning { border-left-color: #f59e0b; }
.toast .ic { font-size: 24px; }
.toast p { margin: 4px 0 0; color: var(--dim); }
.overlay { position: fixed; inset: 0; z-index: 3000; display: flex; align-items: center; justify-content: center; background: rgba(40, 5, 10, .88); backdrop-filter: blur(8px); }
.overlay.emergency { animation: pulse 1.2s ease-in-out infinite; }
.box { text-align: center; max-width: 640px; padding: 32px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.big { font-size: 96px; line-height: 1; }
.lvl { letter-spacing: .3em; text-transform: uppercase; color: #fca5a5; }
.box h2 { font-size: 40px; font-weight: 400; margin: 0; }
.box p { font-size: 22px; color: #fecaca; margin: 0; }
.ackbtn { margin-top: 24px; font-size: 22px; min-height: 72px; min-width: 280px; }
.camov { position: fixed; inset: 0; z-index: 2800; background: rgba(0, 0, 0, .9); display: flex; align-items: center; justify-content: center; }
.camwrap { position: relative; width: 92vw; height: 86vh; }
.camclose { position: fixed; top: 16px; right: 16px; min-width: 64px; min-height: 64px; font-size: 26px; }
.screen { position: fixed; inset: 0; z-index: 2500; background: #000; }
.screen.dim { background: rgba(0, 0, 0, .7); }
@keyframes pulse { 50% { background: rgba(160, 10, 20, .92); } }
@keyframes in { from { transform: translateY(-12px); opacity: 0; } }
</style>
