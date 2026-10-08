import mqtt from 'mqtt'
import { cap, measurement, typeForSensor, typeForBinary } from '../model.js'

const COMPONENTS = ['light', 'switch', 'sensor', 'binary_sensor', 'cover', 'lock']

export function renderTemplate(tpl, payload) {
  if (!tpl) return payload
  const m = tpl.match(/^\s*\{\{\s*(value_json(?:\.[\w-]+|\[['"][^'"]+['"]\])*|value)\s*((?:\|\s*\w+(?:\(\s*\d+\s*\))?\s*)*)\}\}\s*$/)
  if (!m) return payload
  let v
  if (m[1] === 'value') v = payload
  else {
    let obj
    try { obj = JSON.parse(payload) } catch { return undefined }
    const path = [...m[1].slice('value_json'.length).matchAll(/\.([\w-]+)|\[['"]([^'"]+)['"]\]/g)].map(x => x[1] ?? x[2])
    v = path.reduce((o, k) => (o == null ? undefined : o[k]), obj)
  }
  for (const f of m[2].split('|').map(s => s.trim()).filter(Boolean)) {
    const [name, arg] = f.replace(')', '').split('(')
    if (name === 'float' || name === 'int') v = name === 'int' ? parseInt(v, 10) : parseFloat(v)
    if (name === 'round') v = Number(Number(v).toFixed(Number(arg ?? 0)))
  }
  return v
}

const num = v => (v === '' || v == null ? v : Number.isFinite(Number(v)) ? Number(v) : v)

export function mapConfig(component, c) {
  const on = c.payload_on ?? 'ON'
  const off = c.payload_off ?? 'OFF'
  switch (component) {
    case 'light': {
      const json = c.schema === 'json'
      const caps = [cap('onoff', 'onoff')]
      if (json ? c.brightness !== false : c.brightness_command_topic) caps.push(cap('brightness', 'brightness'))
      return { type: 'light', capabilities: caps }
    }
    case 'switch':
      return { type: c.device_class === 'outlet' ? 'outlet' : 'switch', capabilities: [cap('onoff', 'onoff')], on, off }
    case 'sensor': {
      const q = c.device_class || 'value'
      return { type: typeForSensor(q), capabilities: [measurement(q, c.unit_of_measurement)], q }
    }
    case 'binary_sensor': {
      const m = typeForBinary(c.device_class)
      return { type: m.type, capabilities: [cap(m.id, 'binary')], id: m.id, on, off }
    }
    case 'cover': {
      const caps = [cap('cover', 'cover')]
      if (c.set_position_topic) caps.push(cap('position', 'position'))
      return { type: 'cover', capabilities: caps }
    }
    case 'lock':
      return { type: 'lock', capabilities: [cap('lock', 'lock')] }
  }
  return null
}

export function parseState(component, c, mapped, payload) {
  const raw = renderTemplate(c.value_template ?? c.state_value_template, payload)
  switch (component) {
    case 'light': {
      if (c.schema === 'json') {
        let j
        try { j = JSON.parse(payload) } catch { return null }
        const s = { onoff: String(j.state).toUpperCase() === 'ON' }
        if (j.brightness != null) s.brightness = Math.round((j.brightness / (c.brightness_scale ?? 255)) * 100)
        return s
      }
      return { onoff: String(raw) === String(c.payload_on ?? 'ON') }
    }
    case 'switch': return { onoff: String(raw) === String(c.state_on ?? mapped.on) }
    case 'sensor': return { [mapped.q]: num(raw) }
    case 'binary_sensor': return { [mapped.id]: String(raw) === String(mapped.on) }
    case 'cover': return { cover: String(raw).toLowerCase() }
    case 'lock': return { lock: String(raw) === String(c.state_locked ?? 'LOCKED') }
  }
  return null
}

export default class MqttAdapter {
  static fields = [
    { key: 'url', type: 'url', required: true },
    { key: 'username', type: 'text' },
    { key: 'password', type: 'secret' },
    { key: 'discovery_prefix', type: 'text' },
  ]

  constructor(integration, ctx) {
    this.cfg = integration.config
    this.ctx = ctx
    this.entities = new Map()
    this.topics = new Map()
  }

  async start() {
    const prefix = this.cfg.discovery_prefix || 'homeassistant'
    this.client = mqtt.connect(this.cfg.url, {
      username: this.cfg.username || undefined, password: this.cfg.password || undefined,
      reconnectPeriod: 5000, connectTimeout: 10000, clientId: `smartboard-${Math.random().toString(16).slice(2, 10)}`,
    })
    this.client.on('connect', () => {
      this.ctx.setStatus('connected')
      this.client.subscribe(`${prefix}/+/+/config`)
      this.client.subscribe(`${prefix}/+/+/+/config`)
      for (const t of this.topics.keys()) this.client.subscribe(t)
    })
    this.client.on('close', () => this.ctx.setStatus('disconnected'))
    this.client.on('error', e => this.ctx.setStatus('error', e.message))
    this.client.on('message', (topic, buf) => this.onMessage(topic, buf.toString(), prefix))
  }

  onMessage(topic, payload, prefix) {
    if (topic.startsWith(prefix + '/') && topic.endsWith('/config')) return this.onConfig(topic, payload, prefix)
    for (const h of this.topics.get(topic) ?? []) h(payload)
  }

  listen(topic, handler) {
    if (!topic) return
    if (!this.topics.has(topic)) {
      this.topics.set(topic, new Set())
      this.client.subscribe(topic)
    }
    this.topics.get(topic).add(handler)
  }

  expand(c) {
    const base = c['~']
    if (!base) return c
    const out = {}
    for (const [k, v] of Object.entries(c)) out[k] = typeof v === 'string' ? v.replace(/^~|~$/g, m => (m === '~' ? base : m)) : v
    return out
  }

  onConfig(topic, payload, prefix) {
    const parts = topic.slice(prefix.length + 1).split('/')
    const component = parts[0]
    if (!COMPONENTS.includes(component)) return
    if (!payload) {
      const id = parts.slice(1, -1).join('/')
      this.entities.delete(id)
      return this.ctx.update(id, null, { connection: 'offline' })
    }
    let c
    try { c = this.expand(JSON.parse(payload)) } catch { return }
    const nativeId = c.unique_id || c.uniq_id || parts.slice(1, -1).join('/')
    const mapped = mapConfig(component, c)
    if (!mapped) return
    this.entities.set(nativeId, { component, c, mapped })
    const dev = c.device ?? c.dev ?? {}
    this.ctx.upsert(nativeId, {
      name: [dev.name, c.name].filter(Boolean).join(' ') || nativeId,
      type: mapped.type, capabilities: mapped.capabilities,
      manufacturer: dev.manufacturer ?? dev.mf ?? null, model: dev.model ?? dev.mdl ?? null,
      meta: { component, area: dev.suggested_area ?? dev.sa ?? null, via: dev.via_device ?? null },
    }, null, { initial: true })
    this.listen(c.state_topic ?? c.stat_t, p => {
      const s = parseState(component, c, mapped, p)
      if (s) this.ctx.update(nativeId, s, { connection: 'online' })
    })
    if (c.position_topic && component === 'cover') this.listen(c.position_topic, p => this.ctx.update(nativeId, { position: num(renderTemplate(c.position_template, p)) }))
    if (c.brightness_state_topic) this.listen(c.brightness_state_topic, p => this.ctx.update(nativeId, { brightness: Math.round((Number(p) / (c.brightness_scale ?? 255)) * 100) }))
    const avail = c.availability_topic ?? c.avty_t ?? c.availability?.[0]?.topic
    if (avail) this.listen(avail, p => this.ctx.update(nativeId, null, { connection: p === (c.payload_available ?? 'online') ? 'online' : 'offline' }))
  }

  publish(topic, payload) {
    return new Promise((res, rej) => this.client.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), { qos: 1 }, e => (e ? rej(e) : res())))
  }

  async command(device, capId, value) {
    const e = this.entities.get(device.native_id)
    if (!e) throw new Error('not_discovered')
    const { component, c } = e
    const cmd = c.command_topic ?? c.cmd_t
    if (component === 'light' && c.schema === 'json') {
      const body = capId === 'brightness'
        ? (value === 0 ? { state: 'OFF' } : { state: 'ON', brightness: Math.round((value / 100) * (c.brightness_scale ?? 255)) })
        : { state: value ? 'ON' : 'OFF' }
      return this.publish(cmd, body)
    }
    if (capId === 'onoff') return this.publish(cmd, value ? (c.payload_on ?? 'ON') : (c.payload_off ?? 'OFF'))
    if (capId === 'brightness') return this.publish(c.brightness_command_topic, String(Math.round((value / 100) * (c.brightness_scale ?? 255))))
    if (capId === 'cover') return this.publish(cmd, { open: c.payload_open ?? 'OPEN', close: c.payload_close ?? 'CLOSE', stop: c.payload_stop ?? 'STOP' }[value])
    if (capId === 'position') return this.publish(c.set_position_topic, String(value))
    if (capId === 'lock') return this.publish(cmd, value ? (c.payload_lock ?? 'LOCK') : (c.payload_unlock ?? 'UNLOCK'))
    throw new Error('unsupported')
  }

  async stop() {
    await new Promise(r => this.client ? this.client.end(true, {}, r) : r())
  }
}
