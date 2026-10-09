import { reactive, watch } from 'vue'
import { api } from './api.js'
import { notes } from './notifications.js'

export const hw = reactive({ info: null })

let kioskFlag = false
try {
  if (new URLSearchParams(location.search).get('kiosk') === '1') sessionStorage.setItem('homeos.kiosk', '1')
  kioskFlag = sessionStorage.getItem('homeos.kiosk') === '1'
} catch {}
export const kiosk = kioskFlag
if (kiosk) {
  const root = document.documentElement
  root.classList.add('kiosk')
  window.addEventListener('pointermove', e => root.classList.toggle('touch-only', e.pointerType === 'touch'), { passive: true })
  window.addEventListener('pointerdown', e => root.classList.toggle('touch-only', e.pointerType === 'touch'), { passive: true })
}

export function defaultScale() {
  if (kiosk || !matchMedia('(pointer: fine)').matches) return 1
  const w = innerWidth
  return w < 1100 ? 0.7 : w < 1500 ? 0.75 : w < 1900 ? 0.85 : 0.95
}
const stored = () => { try { return localStorage.getItem('homeos.scale') } catch { return null } }
window.addEventListener('resize', () => {
  if (stored()) return
  const v = defaultScale()
  if (String(v) !== document.documentElement.style.zoom) { document.documentElement.style.zoom = String(v); document.documentElement.style.setProperty('--zoom', String(v)) }
})
export function getScale() {
  try { const v = Number(localStorage.getItem('homeos.scale')); if (v >= 0.5 && v <= 1.5) return v } catch {}
  return defaultScale()
}
export function resetScale() {
  try { localStorage.removeItem('homeos.scale') } catch {}
  setScale(defaultScale(), false)
}
export function setScale(v, save = true) {
  document.documentElement.style.zoom = String(v)
  document.documentElement.style.setProperty('--zoom', String(v))
  if (save) try { localStorage.setItem('homeos.scale', String(v)) } catch {}
  window.dispatchEvent(new Event('resize'))
}
document.documentElement.style.zoom = String(getScale())
document.documentElement.style.setProperty('--zoom', String(getScale()))

export function setLite(on) {
  document.documentElement.classList.toggle('lite', !!on)
  try { localStorage.setItem('homeos.lite', on ? '1' : '0') } catch {}
}
try {
  const saved = localStorage.getItem('homeos.lite')
  if (saved === '1' || (saved === null && kiosk)) document.documentElement.classList.add('lite')
} catch {}

export async function loadHardware() {
  try { hw.info = await api('GET', '/hardware') } catch { hw.info = { device: false, display: {} } }
  return hw.info
}

const power = on => { if (hw.info?.device) api('POST', '/hardware/display/power', { on }).catch(() => {}) }

let lastActivity = Date.now()
let started = false

export function startIdle() {
  if (started) return
  started = true
  loadHardware()
  const wake = () => {
    lastActivity = Date.now()
    if (notes.display !== 'on') notes.display = 'on'
  }
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) window.addEventListener(ev, wake, { capture: true, passive: true })
  setInterval(() => {
    const s = hw.info?.display ?? {}
    const idle = (Date.now() - lastActivity) / 60000
    if (s.idle > 0 && idle >= s.idle && notes.display !== 'off' && !notes.overlay.length) notes.display = 'off'
    else if (s.dim > 0 && s.idle > 0 && idle >= s.idle * 0.75 && notes.display === 'on' && !notes.overlay.length) notes.display = 'dim'
  }, 10000)
  watch(() => notes.display, (v, old) => {
    if (v === 'off') power(false)
    else if (old === 'off') power(true)
    if (v === 'on') lastActivity = Date.now()
  })
}
