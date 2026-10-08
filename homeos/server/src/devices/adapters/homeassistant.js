import { cap, measurement, typeForSensor, typeForBinary } from '../model.js'

const hsFromAttr = a => Array.isArray(a?.hs_color) ? { h: a.hs_color[0], s: a.hs_color[1] } : undefined

export function mapEntity(st) {
  const [domain] = st.entity_id.split('.')
  const a = st.attributes ?? {}
  const unavailable = st.state === 'unavailable' || st.state === 'unknown'
  let type = 'other'
  let caps = []
  let state = {}
  switch (domain) {
    case 'light': {
      type = 'light'
      const modes = a.supported_color_modes ?? []
      caps = [cap('onoff', 'onoff')]
      if (modes.some(m => m !== 'onoff')) caps.push(cap('brightness', 'brightness'))
      if (modes.some(m => ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'].includes(m))) caps.push(cap('color', 'color'))
      state = { onoff: st.state === 'on' }
      if (a.brightness != null) state.brightness = Math.round((a.brightness / 255) * 100)
      else if (st.state === 'off') state.brightness = 0
      const hs = hsFromAttr(a)
      if (hs) state.color = hs
      break
    }
    case 'switch': case 'input_boolean': case 'fan':
      type = a.device_class === 'outlet' ? 'outlet' : 'switch'
      caps = [cap('onoff', 'onoff')]
      state = { onoff: st.state === 'on' }
      break
    case 'cover':
      type = ['blind', 'shade', 'shutter', 'curtain'].includes(a.device_class) ? 'blind' : 'cover'
      caps = [cap('cover', 'cover')]
      if (a.current_position != null) caps.push(cap('position', 'position'))
      state = { cover: st.state, position: a.current_position }
      break
    case 'climate':
      type = 'thermostat'
      caps = [cap('target_temperature', 'target_temperature', { min: a.min_temp ?? 5, max: a.max_temp ?? 30, step: a.target_temp_step ?? 0.5, unit: '°C' })]
      if (a.current_temperature != null) caps.push(measurement('temperature'))
      state = { target_temperature: a.temperature, temperature: a.current_temperature, mode: st.state }
      break
    case 'lock':
      type = 'lock'
      caps = [cap('lock', 'lock')]
      state = { lock: st.state === 'locked' }
      break
    case 'sensor': {
      const q = a.device_class || 'value'
      type = typeForSensor(q)
      caps = [measurement(q, a.unit_of_measurement)]
      const n = Number(st.state)
      state = { [q]: Number.isFinite(n) ? n : st.state }
      break
    }
    case 'binary_sensor': {
      const m = typeForBinary(a.device_class)
      type = m.type
      caps = [cap(m.id, 'binary')]
      state = { [m.id]: st.state === 'on' }
      break
    }
    case 'camera':
      type = 'camera'
      caps = [cap('state', 'text')]
      state = { state: st.state }
      break
    case 'media_player':
      type = 'media'
      caps = [cap('onoff', 'onoff'), cap('state', 'text')]
      state = { onoff: st.state !== 'off', state: st.state }
      break
    default:
      return null
  }
  if (a.battery_level != null) state.battery = a.battery_level
  return { type, capabilities: caps, state, name: a.friendly_name ?? st.entity_id, connection: unavailable ? 'offline' : 'online', domain }
}

export function serviceFor(device, capId, value) {
  const id = device.native_id
  const domain = id.split('.')[0]
  const data = { entity_id: id }
  if (capId === 'onoff') return { domain: domain === 'light' || domain === 'switch' || domain === 'fan' || domain === 'input_boolean' || domain === 'media_player' ? domain : 'homeassistant', service: value ? 'turn_on' : 'turn_off', data }
  if (capId === 'brightness') return value === 0 ? { domain: 'light', service: 'turn_off', data } : { domain: 'light', service: 'turn_on', data: { ...data, brightness_pct: value } }
  if (capId === 'color') return { domain: 'light', service: 'turn_on', data: { ...data, hs_color: [value.h, value.s] } }
  if (capId === 'position') return { domain: 'cover', service: 'set_cover_position', data: { ...data, position: value } }
  if (capId === 'cover') return { domain: 'cover', service: { open: 'open_cover', close: 'close_cover', stop: 'stop_cover' }[value], data }
  if (capId === 'target_temperature') return { domain: 'climate', service: 'set_temperature', data: { ...data, temperature: value } }
  if (capId === 'lock') return { domain: 'lock', service: value ? 'lock' : 'unlock', data }
  return null
}

export default class HomeAssistantAdapter {
  static fields = [
    { key: 'url', type: 'url', required: true },
    { key: 'token', type: 'secret', required: true },
  ]

  constructor(integration, ctx) {
    this.cfg = integration.config
    this.ctx = ctx
    this.ws = null
    this.nextId = 1
    this.pending = new Map()
    this.stopped = false
    this.retry = 1000
    this.registry = { entities: new Map(), devices: new Map(), areas: new Map() }
  }

  wsUrl() {
    return this.cfg.url.replace(/\/$/, '').replace(/^http/, 'ws') + '/api/websocket'
  }

  send(msg) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) return reject(new Error('not connected'))
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, ...msg }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('timeout'))
      }, 15000)
    })
  }

  async start() {
    this.stopped = false
    this.connect()
  }

  connect() {
    if (this.stopped) return
    let ws
    try {
      ws = new WebSocket(this.wsUrl())
    } catch (e) {
      this.ctx.setStatus('error', e.message)
      return this.reconnect()
    }
    this.ws = ws
    ws.onmessage = ev => this.onMessage(JSON.parse(ev.data))
    ws.onclose = () => {
      this.ctx.setStatus('disconnected')
      for (const p of this.pending.values()) p.reject(new Error('closed'))
      this.pending.clear()
      this.reconnect()
    }
    ws.onerror = () => {}
  }

  reconnect() {
    if (this.stopped) return
    setTimeout(() => this.connect(), this.retry)
    this.retry = Math.min(this.retry * 2, 60000)
  }

  async onMessage(m) {
    if (m.type === 'auth_required') return this.ws.send(JSON.stringify({ type: 'auth', access_token: this.cfg.token }))
    if (m.type === 'auth_invalid') {
      this.ctx.setStatus('error', 'auth_invalid')
      this.stopped = true
      return this.ws.close()
    }
    if (m.type === 'auth_ok') return this.onReady().catch(e => this.ctx.setStatus('error', e.message))
    if (m.type === 'result' && this.pending.has(m.id)) {
      const p = this.pending.get(m.id)
      this.pending.delete(m.id)
      return m.success ? p.resolve(m.result) : p.reject(new Error(m.error?.message ?? 'failed'))
    }
    if (m.type === 'event' && m.event?.event_type === 'state_changed') {
      const ns = m.event.data.new_state
      if (ns) this.applyState(ns)
      else this.ctx.update(m.event.data.entity_id, null, { connection: 'offline' })
    }
  }

  async onReady() {
    this.retry = 1000
    await this.loadRegistry()
    const states = await this.send({ type: 'get_states' })
    for (const st of states) this.applyState(st, true)
    await this.send({ type: 'subscribe_events', event_type: 'state_changed' })
    this.ctx.setStatus('connected', null, { entities: states.length })
  }

  async loadRegistry() {
    try {
      const [ents, devs, areas] = await Promise.all([
        this.send({ type: 'config/entity_registry/list' }),
        this.send({ type: 'config/device_registry/list' }),
        this.send({ type: 'config/area_registry/list' }),
      ])
      this.registry.entities = new Map(ents.map(e => [e.entity_id, e]))
      this.registry.devices = new Map(devs.map(d => [d.id, d]))
      this.registry.areas = new Map(areas.map(a => [a.area_id, a.name]))
    } catch {}
  }

  applyState(st, initial = false) {
    const mapped = mapEntity(st)
    if (!mapped) return
    const ent = this.registry.entities.get(st.entity_id)
    if (ent?.hidden_by || ent?.disabled_by || ent?.entity_category) return
    const dev = ent?.device_id ? this.registry.devices.get(ent.device_id) : null
    const area = this.registry.areas.get(ent?.area_id ?? dev?.area_id)
    this.ctx.upsert(st.entity_id, {
      name: mapped.name, type: mapped.type, capabilities: mapped.capabilities,
      manufacturer: dev?.manufacturer ?? null, model: dev?.model ?? null,
      meta: { domain: mapped.domain, area: area ?? null, ha_device: dev?.name_by_user ?? dev?.name ?? null },
    }, mapped.state, { connection: mapped.connection, battery: mapped.state.battery, initial })
  }

  async command(device, capId, value) {
    const s = serviceFor(device, capId, value)
    if (!s) throw new Error('unsupported')
    await this.send({ type: 'call_service', domain: s.domain, service: s.service, service_data: s.data })
  }

  async stop() {
    this.stopped = true
    this.ws?.close()
  }
}
