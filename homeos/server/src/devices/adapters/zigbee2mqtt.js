import mqtt from 'mqtt'
import { cap, measurement, typeForSensor } from '../model.js'

const QUANTITIES = ['temperature', 'humidity', 'power', 'energy', 'voltage', 'current', 'illuminance', 'co2', 'pressure', 'battery']
const BINARY = { contact: 'door', occupancy: 'motion', presence: 'motion', water_leak: 'sensor', smoke: 'smoke', gas: 'smoke', vibration: 'sensor', tamper: 'sensor' }

function flatten(exposes) {
  const out = []
  for (const e of exposes ?? []) {
    if (e.features) out.push(...flatten(e.features).map(f => ({ ...f, parent: e.type })))
    else out.push(e)
  }
  return out
}

export function mapExposes(exposes) {
  const caps = []
  const props = {}
  let type = null
  for (const f of flatten(exposes)) {
    const p = f.property
    if (!p || f.endpoint) continue
    const writable = !!(f.access & 2)
    if (f.parent === 'light' || f.parent === 'switch') {
      if (p === 'state') { caps.push(cap('onoff', 'onoff')); props.onoff = f; type ??= f.parent }
      if (p === 'brightness') { caps.push(cap('brightness', 'brightness')); props.brightness = f; type = 'light' }
      if (p === 'color_hs') { caps.push(cap('color', 'color')); props.color = f }
    } else if (f.parent === 'cover') {
      if (p === 'state') { caps.push(cap('cover', 'cover')); props.cover = f; type = 'cover' }
      if (p === 'position') { caps.push(cap('position', 'position')); props.position = f }
    } else if (f.parent === 'lock' && p === 'state') {
      caps.push(cap('lock', 'lock')); props.lock = f; type = 'lock'
    } else if (f.parent === 'climate') {
      if (p === 'current_heating_setpoint' || p === 'occupied_heating_setpoint') { caps.push(cap('target_temperature', 'target_temperature', { min: f.value_min ?? 5, max: f.value_max ?? 30, step: f.value_step ?? 0.5, unit: '°C' })); props.target_temperature = f; type = 'thermostat' }
      if (p === 'local_temperature') { caps.push(measurement('temperature')); props.temperature = f }
    } else if (f.type === 'numeric' && QUANTITIES.includes(p) && !props[p]) {
      caps.push(measurement(p, f.unit)); props[p] = f; type ??= typeForSensor(p)
    } else if (f.type === 'binary' && BINARY[p] && !writable) {
      caps.push(cap(p, 'binary')); props[p] = f; type ??= BINARY[p]
    }
  }
  if (!caps.length) return null
  return { type: type ?? 'sensor', capabilities: caps, props }
}

function stateFrom(mapped, msg) {
  const s = {}
  for (const [id, f] of Object.entries(mapped.props)) {
    const v = msg[f.property]
    if (v === undefined) continue
    if (id === 'onoff') s.onoff = v === (f.value_on ?? 'ON')
    else if (id === 'lock') s.lock = v === (f.value_on ?? 'LOCK')
    else if (id === 'brightness') s.brightness = Math.round((v / (f.value_max ?? 254)) * 100)
    else if (id === 'cover') continue
    else if (id === 'color') s.color = { h: v.hue ?? v.h, s: v.saturation ?? v.s }
    else if (f.type === 'binary') s[id] = id === 'contact' ? v === f.value_off : v === (f.value_on ?? true)
    else s[id] = v
  }
  return s
}

export default class Zigbee2MqttAdapter {
  static fields = [
    { key: 'url', type: 'url', required: true },
    { key: 'username', type: 'text' },
    { key: 'password', type: 'secret' },
    { key: 'base_topic', type: 'text' },
  ]

  static actions = { permit_join: 'permitJoin' }

  constructor(integration, ctx) {
    this.cfg = integration.config
    this.ctx = ctx
    this.base = this.cfg.base_topic || 'zigbee2mqtt'
    this.devices = new Map()
    this.byName = new Map()
  }

  async start() {
    this.client = mqtt.connect(this.cfg.url, {
      username: this.cfg.username || undefined, password: this.cfg.password || undefined,
      reconnectPeriod: 5000, connectTimeout: 10000, clientId: `smartboard-z2m-${Math.random().toString(16).slice(2, 10)}`,
    })
    this.client.on('connect', () => {
      this.client.subscribe(`${this.base}/#`)
      this.ctx.setStatus('connected')
    })
    this.client.on('close', () => this.ctx.setStatus('disconnected'))
    this.client.on('error', e => this.ctx.setStatus('error', e.message))
    this.client.on('message', (t, buf) => this.onMessage(t.slice(this.base.length + 1), buf.toString()))
  }

  onMessage(topic, payload) {
    if (topic === 'bridge/devices') return this.onDevices(payload)
    if (topic.startsWith('bridge/')) return
    const avail = topic.endsWith('/availability')
    const name = avail ? topic.slice(0, -13) : topic
    const d = this.byName.get(name)
    if (!d) return
    let msg
    try { msg = JSON.parse(payload) } catch { msg = payload }
    if (avail) return this.ctx.update(d.ieee, null, { connection: (msg?.state ?? msg) === 'online' ? 'online' : 'offline' })
    if (typeof msg !== 'object' || !msg) return
    this.ctx.update(d.ieee, stateFrom(d.mapped, msg), { connection: 'online', battery: typeof msg.battery === 'number' ? msg.battery : null })
  }

  onDevices(payload) {
    let list
    try { list = JSON.parse(payload) } catch { return }
    this.byName.clear()
    let n = 0
    for (const dev of list) {
      if (dev.type === 'Coordinator' || !dev.definition) continue
      const mapped = mapExposes(dev.definition.exposes)
      if (!mapped) continue
      const d = { ieee: dev.ieee_address, name: dev.friendly_name, mapped }
      this.devices.set(d.ieee, d)
      this.byName.set(d.name, d)
      n++
      this.ctx.upsert(d.ieee, {
        name: dev.friendly_name, type: mapped.type, capabilities: mapped.capabilities,
        manufacturer: dev.definition.vendor ?? dev.manufacturer ?? null, model: dev.definition.model ?? dev.model_id ?? null,
        meta: { protocol: 'zigbee', friendly_name: dev.friendly_name },
      })
      if (dev.friendly_name) this.client.publish(`${this.base}/${dev.friendly_name}/get`, JSON.stringify(Object.fromEntries(Object.values(mapped.props).filter(f => f.access & 4).map(f => [f.property, '']))))
    }
    this.ctx.setStatus('connected', null, { devices: n })
  }

  publish(topic, payload) {
    return new Promise((res, rej) => this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, e => (e ? rej(e) : res())))
  }

  async command(device, capId, value) {
    const d = this.devices.get(device.native_id)
    if (!d) throw new Error('not_discovered')
    const f = d.mapped.props[capId]
    const set = body => this.publish(`${this.base}/${d.name}/set`, body)
    if (capId === 'onoff') return set({ [f.property]: value ? (f.value_on ?? 'ON') : (f.value_off ?? 'OFF') })
    if (capId === 'brightness') return set(value === 0 ? { state: 'OFF' } : { state: 'ON', brightness: Math.round((value / 100) * (f.value_max ?? 254)) })
    if (capId === 'color') return set({ color: { hue: value.h, saturation: value.s } })
    if (capId === 'cover') return set({ state: value.toUpperCase() })
    if (capId === 'position') return set({ position: value })
    if (capId === 'lock') return set({ state: value ? 'LOCK' : 'UNLOCK' })
    if (capId === 'target_temperature') return set({ [f.property]: value })
    throw new Error('unsupported')
  }

  permitJoin(seconds = 254) {
    return this.publish(`${this.base}/bridge/request/permit_join`, { value: seconds > 0, time: seconds })
  }

  async stop() {
    await new Promise(r => this.client ? this.client.end(true, {}, r) : r())
  }
}
