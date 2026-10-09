<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { listeners } from '../../devices.js'
import { notes, playTone } from '../../notifications.js'

const { t } = useI18n()
const alarm = ref(null)
const now = ref(Date.now())
let soundTimer = null
let clock = null

const elapsed = computed(() => {
  if (!alarm.value) return ''
  const s = Math.max(0, Math.floor((now.value - new Date(alarm.value.started)) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})
const mapUrl = computed(() => alarm.value?.address ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(alarm.value.address)}` : '')

function stopSound() { clearInterval(soundTimer); soundTimer = null }
function show(a) {
  stopSound()
  alarm.value = a
  if (!a) return
  notes.display = 'on'
  if (a.sound) {
    playTone('alarm')
    soundTimer = setInterval(() => playTone('alarm'), 3000)
    setTimeout(stopSound, (a.sound_seconds ?? 20) * 1000)
  }
}
const on = (type, p) => { if (type === 'alarm') show(p) }
async function end() { stopSound(); alarm.value = null; await api('POST', '/alarm/end').catch(() => {}) }
const key = e => { if (alarm.value && e.key === 'Escape') { e.stopImmediatePropagation(); stopSound() } }

onMounted(async () => {
  listeners.add(on)
  window.addEventListener('keydown', key, true)
  clock = setInterval(() => { now.value = Date.now() }, 1000)
  const r = await api('GET', '/alarm').catch(() => null)
  if (r?.active) show({ ...r.active, sound: false })
})
onBeforeUnmount(() => { listeners.delete(on); window.removeEventListener('keydown', key, true); clearInterval(clock); stopSound() })
</script>

<template>
  <div v-if="alarm" class="alarm" @pointerdown="stopSound">
    <iframe v-if="alarm.monitor_url" :src="alarm.monitor_url" referrerpolicy="no-referrer" allow="geolocation" />
    <div class="head" :class="{ bar: alarm.monitor_url }">
      <span class="badge">{{ t('alarm.badge') }}</span>
      <b class="title">{{ alarm.title }}</b>
      <span class="time">{{ elapsed }}</span>
      <button class="btn" @click="end">{{ t('alarm.end') }}</button>
    </div>
    <div v-if="!alarm.monitor_url" class="body">
      <p v-if="alarm.text" class="text">{{ alarm.text }}</p>
      <p v-if="alarm.address" class="addr">⌖ {{ alarm.address }}</p>
      <p v-if="alarm.units" class="units">{{ alarm.units }}</p>
      <a v-if="mapUrl" class="btn" :href="mapUrl" target="_blank" rel="noopener">{{ t('alarm.map') }}</a>
    </div>
  </div>
</template>

<style scoped>
.alarm { position: fixed; inset: 0; z-index: 9000; background: #1a0004; color: #fff; display: flex; flex-direction: column; }
.alarm iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
.head { position: relative; display: flex; align-items: center; gap: 16px; padding: 18px 24px; background: linear-gradient(90deg, #d0001c, #ff3b30); animation: pulse 1.2s ease-in-out infinite alternate; }
.head.bar { position: absolute; left: 0; right: 0; bottom: 0; padding: 8px 16px; opacity: .92; animation: none; }
.badge { font-weight: 800; letter-spacing: .2em; font-size: 14px; border: 2px solid #fff; padding: 4px 10px; border-radius: 6px; }
.title { flex: 1; font-size: clamp(28px, 5vw, 64px); line-height: 1.1; }
.head.bar .title { font-size: 22px; }
.time { font-variant-numeric: tabular-nums; font-size: 28px; }
.body { flex: 1; padding: 32px; display: flex; flex-direction: column; gap: 20px; overflow: auto; }
.text { font-size: clamp(22px, 3vw, 40px); white-space: pre-wrap; margin: 0; }
.addr { font-size: clamp(24px, 3.4vw, 46px); font-weight: 700; margin: 0; color: #ffd60a; }
.units { font-size: 22px; opacity: .85; margin: 0; }
.body .btn { align-self: flex-start; font-size: 20px; }
@keyframes pulse { from { filter: brightness(1); } to { filter: brightness(1.35); } }
</style>
