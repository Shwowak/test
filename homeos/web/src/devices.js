import { reactive, ref } from 'vue'
import { api } from './api.js'

export const store = reactive({ devices: {}, rooms: [], integrations: [], registry: null, loaded: false })
export const connected = ref(false)

export const listeners = new Set()
let ws = null
let retry = 1000
let started = false

export async function loadDevices() {
  const [devices, rooms, registry] = await Promise.all([
    api('GET', '/devices'), api('GET', '/rooms'), store.registry ? store.registry : api('GET', '/devices/meta/registry'),
  ])
  store.devices = Object.fromEntries(devices.map(d => [d.id, d]))
  store.rooms = rooms
  store.registry = registry
  store.loaded = true
}

export async function loadIntegrations() {
  store.integrations = await api('GET', '/integrations')
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/api/v1/events`)
  ws.onopen = () => { connected.value = true; retry = 1000; loadDevices().catch(() => {}) }
  ws.onclose = () => {
    connected.value = false
    if (!started) return
    setTimeout(connect, retry)
    retry = Math.min(retry * 2, 30000)
  }
  ws.onmessage = ev => {
    const { type, payload } = JSON.parse(ev.data)
    for (const fn of listeners) fn(type, payload)
    if (type === 'device.state') {
      const d = store.devices[payload.id]
      if (d) Object.assign(d, { state: payload.state, connection: payload.connection, battery: payload.battery ?? d.battery, last_seen: payload.last_seen })
    } else if (type === 'device.discovered' || (type === 'config.changed' && ['device', 'room', 'integration', 'system'].includes(payload.entity))) {
      loadDevices().catch(() => {})
      if (type !== 'device.discovered') loadIntegrations().catch(() => {})
    } else if (type === 'integration.status') {
      const i = store.integrations.find(x => x.id === payload.id)
      if (i) i.status = { ...i.status, status: payload.status, error: payload.error }
    }
  }
}

export function startLive() {
  if (started) return
  started = true
  connect()
}

export function stopLive() {
  started = false
  ws?.close()
}

export async function command(id, capability, value) {
  const d = store.devices[id]
  const prev = d ? { ...d.state } : null
  if (d) d.state = { ...d.state, [capability]: value, ...(capability === 'brightness' ? { onoff: value > 0 } : {}) }
  try {
    await api('POST', `/devices/${id}/command`, { capability, value })
  } catch (e) {
    if (d && prev) d.state = prev
    throw e
  }
}

export const TYPE_ICONS = {
  light: '💡', switch: '⏻', outlet: '🔌', thermostat: '🌡', heating: '♨', cover: '▤', blind: '▤', door: '🚪', window: '🪟',
  lock: '🔒', camera: '📷', sensor: '◉', smoke: '🔥', motion: '🏃', energy_meter: '⚡', pv: '☀', battery: '🔋',
  wallbox: '🔌', vehicle: '🚗', media: '♫', other: '◈',
}
