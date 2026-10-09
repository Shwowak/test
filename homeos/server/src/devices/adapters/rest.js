import { cap, measurement, typeForSensor } from '../model.js'
import { pick } from '../../modules/sources-adapters.js'

export const REST_DEVICE_FIELDS = [
  { key: 'kind', type: 'select', options: ['sensor', 'switch'], required: true },
  { key: 'state_url', type: 'url', required: true },
  { key: 'state_path', type: 'text' },
  { key: 'quantity', type: 'text', for: ['sensor'] },
  { key: 'unit', type: 'text', for: ['sensor'] },
  { key: 'on_value', type: 'text', for: ['switch'] },
  { key: 'on_url', type: 'url', for: ['switch'] },
  { key: 'off_url', type: 'url', for: ['switch'] },
  { key: 'method', type: 'select', options: ['POST', 'GET', 'PUT'], for: ['switch'] },
]

export function restDefinition(meta) {
  if (meta.kind === 'switch') return { type: 'switch', capabilities: [cap('onoff', 'onoff')] }
  return { type: typeForSensor(meta.quantity), capabilities: [measurement(meta.quantity || 'value', meta.unit)] }
}

export default class RestAdapter {
  static fields = [
    { key: 'headers', type: 'json' },
    { key: 'interval', type: 'number' },
  ]

  static manualDevices = true
  static deviceFields = REST_DEVICE_FIELDS
  static definition = restDefinition

  constructor(integration, ctx) {
    this.cfg = integration.config
    this.ctx = ctx
    this.timer = null
  }

  async fetchJson(url) {
    const res = await fetch(url, { headers: this.cfg.headers ?? {}, signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    try { return JSON.parse(text) } catch { return text }
  }

  async poll() {
    let ok = 0
    const devices = this.ctx.devices()
    for (const d of devices) {
      const m = d.meta
      try {
        const v = pick(await this.fetchJson(m.state_url), m.state_path)
        const state = m.kind === 'switch'
          ? { onoff: String(v) === String(m.on_value ?? 'true') || v === true }
          : { [m.quantity || 'value']: Number.isFinite(Number(v)) ? Number(v) : v }
        this.ctx.update(d.native_id, state, { connection: 'online' })
        ok++
      } catch {
        this.ctx.update(d.native_id, null, { connection: 'offline' })
      }
    }
    this.ctx.setStatus(devices.length && !ok ? 'error' : 'connected', null, { devices: devices.length })
  }

  async start() {
    await this.poll()
    this.timer = setInterval(() => this.poll(), Math.max(5, Number(this.cfg.interval) || 30) * 1000)
  }

  async command(device, capId, value) {
    if (capId !== 'onoff') throw new Error('unsupported')
    const url = value ? device.meta.on_url : device.meta.off_url
    if (!url) throw new Error('no_url')
    const res = await fetch(url, { method: device.meta.method || 'POST', headers: this.cfg.headers ?? {}, signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    this.ctx.update(device.native_id, { onoff: value })
    setTimeout(() => this.poll(), 1000)
  }

  async stop() {
    clearInterval(this.timer)
  }
}
