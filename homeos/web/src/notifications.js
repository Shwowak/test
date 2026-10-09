import { reactive, computed } from 'vue'
import { api } from './api.js'
import { listeners } from './devices.js'
import { speak } from './speech.js'

export const notes = reactive({ list: [], toasts: [], overlay: [], display: 'on', dashboard: null, camera: null })
export const unread = computed(() => notes.list.filter(n => !n.acknowledged_at).length)

let audio = null
export function playTone(tone = 'chime') {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)()
    const seq = { chime: [[880, 0.15], [1320, 0.25]], alert: [[660, 0.2], [660, 0.2], [990, 0.3]], alarm: [[960, 0.25], [640, 0.25], [960, 0.25], [640, 0.25], [960, 0.25], [640, 0.25]] }[tone] ?? [[880, 0.2]]
    let at = audio.currentTime
    for (const [f, d] of seq) {
      const o = audio.createOscillator()
      const g = audio.createGain()
      o.type = tone === 'alarm' ? 'square' : 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(0.3, at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, at + d)
      o.connect(g).connect(audio.destination)
      o.start(at)
      o.stop(at + d + 0.02)
      at += d + 0.05
    }
  } catch {}
}

let alarmTimer = null
function syncAlarm() {
  const em = notes.overlay.some(n => n.level === 'emergency')
  if (em && !alarmTimer) { playTone('alarm'); alarmTimer = setInterval(() => playTone('alarm'), 4000) }
  if (!em && alarmTimer) { clearInterval(alarmTimer); alarmTimer = null }
}

function toast(n) {
  notes.toasts.push(n)
  setTimeout(() => { const i = notes.toasts.indexOf(n); if (i >= 0) notes.toasts.splice(i, 1) }, n.level === 'warning' ? 9000 : 5000)
}

function add(n) {
  if (notes.list.some(x => x.id === n.id)) return
  notes.list.unshift(n)
  if (n.level === 'critical' || n.level === 'emergency') {
    notes.overlay.push(n)
    notes.display = 'on'
    if (n.level === 'critical') playTone('alert')
    syncAlarm()
  } else {
    toast(n)
    if (n.level === 'warning') playTone('chime')
  }
}

export async function loadNotifications() {
  notes.list = await api('GET', '/notifications?limit=100')
  notes.overlay = notes.list.filter(n => !n.acknowledged_at && (n.level === 'critical' || n.level === 'emergency'))
  syncAlarm()
}

export async function ack(ids) {
  await api('POST', '/notifications/ack', ids === 'all' ? { all: true } : { ids })
}

function applyAck(ids) {
  const ts = new Date().toISOString()
  for (const n of notes.list) if (ids.includes(n.id) && !n.acknowledged_at) n.acknowledged_at = ts
  notes.overlay = notes.overlay.filter(n => !ids.includes(n.id))
  syncAlarm()
}

listeners.add((type, p) => {
  if (type === 'notification') add(p)
  else if (type === 'notification.ack') applyAck(p.ids ?? [])
  else if (type === 'ui.command') {
    if (p.action === 'display') notes.display = p.state
    else if (p.action === 'sound') playTone(p.tone)
    else if (p.action === 'dashboard') notes.dashboard = { id: p.dashboard_id, at: Date.now() }
    else if (p.action === 'camera') { notes.display = 'on'; notes.camera = { id: p.camera_id, until: Date.now() + (p.seconds ?? 60) * 1000 } }
    else if (p.action === 'speak') speak(p.text)
  }
})
