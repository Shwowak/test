import { cap, measurement, typeForSensor } from '../model.js'
import { JsonWs } from './jsonws.js'

const SENSOR = { 'Air temperature': 'temperature', Humidity: 'humidity', Illuminance: 'illuminance', Power: 'power', Voltage: 'voltage', Current: 'current', 'Carbon dioxide (CO2) level': 'co2', 'Atmospheric pressure': 'pressure' }
const METER_UNIT = { kWh: 'energy', W: 'power', V: 'voltage', A: 'current' }

const key = v => `${v.endpoint ?? 0}:${v.commandClass}:${v.property}:${v.propertyKey ?? ''}`

export function mapNode(node) {
  const caps = []
  const map = {}
  let type = null
  const add = (id, c, v, conv) => { if (map[id]) return; caps.push(c); map[id] = { v, conv } }
  for (const v of node.values ?? []) {
    const cc = v.commandClass
    const m = v.metadata ?? {}
    if (cc === 37 && v.property === 'currentValue') { add('onoff', cap('onoff', 'onoff'), v, x => !!x); type ??= 'switch' }
    else if (cc === 38 && v.property === 'currentValue') { add('brightness', cap('brightness', 'brightness'), v, x => Math.min(100, Math.round(x * 100 / 99))); add('onoff', cap('onoff', 'onoff'), v, x => x > 0); type = 'light' }
    else if (cc === 49 && SENSOR[v.property]) { const q = SENSOR[v.property]; add(q, measurement(q, m.unit), v, Number); type ??= typeForSensor(q) }
    else if (cc === 50 && v.property === 'value' && METER_UNIT[m.unit]) { const q = METER_UNIT[m.unit]; add(q, measurement(q, m.unit), v, Number); type ??= 'energy_meter' }
    else if (cc === 128 && v.property === 'level') add('battery', measurement('battery'), v, Number)
    else if (cc === 98 && v.property === 'currentMode') { add('lock', cap('lock', 'lock'), v, x => x === 255); type = 'lock' }
    else if (cc === 67 && v.property === 'setpoint' && v.propertyKey === 1) { add('target_temperature', cap('target_temperature', 'target_temperature', { min: m.min ?? 5, max: m.max ?? 30, step: 0.5, unit: m.unit || '°C' }), v, Number); type = 'thermostat' }
    else if (cc === 48 && v.property === 'Any') { add('state', cap('state', 'binary'), v, x => !!x); type ??= 'sensor' }
    else if (cc === 113 && v.property === 'Home Security' && v.propertyKey === 'Motion sensor status') { add('motion', cap('motion', 'binary'), v, x => x === 8); type ??= 'motion' }
    else if (cc === 113 && v.property === 'Access Control' && v.propertyKey === 'Door state') { add('contact', cap('contact', 'binary'), v, x => x === 22); type ??= 'door' }
    else if (cc === 113 && v.property === 'Smoke Alarm') { add('smoke', cap('smoke', 'binary'), v, x => x > 0); type ??= 'smoke' }
  }
  if (!caps.length) return null
  return { type: type ?? 'sensor', capabilities: caps, map }
}

export default class ZwaveJsAdapter {
  static fields = [{ key: 'url', type: 'url', required: true }]

  static actions = { permit_join: 'permitJoin' }

  constructor(integration, ctx) {
    this.cfg = integration.config
    this.ctx = ctx
    this.nodes = new Map()
    this.ws = new JsonWs(this.cfg.url || 'ws://localhost:3000', {
      onMessage: m => this.onMessage(m),
      onClose: e => this.ctx.setStatus(e ? 'error' : 'disconnected', e ?? null),
    })
  }

  async start() { this.ws.connect() }

  async onMessage(m) {
    if (m.type === 'version') return this.onReady().catch(e => this.ctx.setStatus('error', e.message))
    if (m.type === 'result') return this.ws.settle(m.messageId, m.success, m.result, m.errorCode ?? m.message)
    if (m.type !== 'event') return
    const e = m.event
    if (e.source === 'node' && e.event === 'value updated') {
      const n = this.nodes.get(e.nodeId)
      if (!n) return
      const k = key(e.args)
      for (const [id, x] of Object.entries(n.map)) if (key(x.v) === k) this.ctx.update(String(e.nodeId), { [id]: x.conv(e.args.newValue) }, { connection: 'online' })
    } else if (e.source === 'node' && (e.event === 'dead' || e.event === 'alive')) {
      this.ctx.update(String(e.nodeId), null, { connection: e.event === 'alive' ? 'online' : 'offline' })
    } else if (e.source === 'node' && (e.event === 'ready' || e.event === 'interview completed') && e.nodeState) {
      this.addNode(e.nodeState)
    } else if (e.source === 'controller' && e.event === 'node added' && e.node) {
      this.addNode(e.node)
    }
  }

  async onReady() {
    await this.ws.send({ command: 'set_api_schema', schemaVersion: 32 })
    const r = await this.ws.send({ command: 'start_listening' })
    for (const n of r.state.nodes) this.addNode(n)
    this.ctx.setStatus('connected', null, { devices: this.nodes.size })
  }

  addNode(n) {
    if (n.isControllerNode) return
    const mapped = mapNode(n)
    if (!mapped) return
    this.nodes.set(n.nodeId, mapped)
    const id = String(n.nodeId)
    this.ctx.upsert(id, {
      name: n.name || n.label || n.deviceConfig?.description || `Z-Wave ${n.nodeId}`,
      type: mapped.type, capabilities: mapped.capabilities,
      manufacturer: n.deviceConfig?.manufacturer ?? null, model: n.deviceConfig?.label ?? n.label ?? null,
      meta: { protocol: 'zwave', node: n.nodeId, area: n.location || null },
    })
    const state = {}
    for (const [cid, x] of Object.entries(mapped.map)) if (x.v.value !== undefined) state[cid] = x.conv(x.v.value)
    this.ctx.update(id, state, { connection: n.status === 3 ? 'offline' : 'online' })
  }

  async command(device, capId, value) {
    const n = this.nodes.get(Number(device.native_id))
    const x = n?.map[capId]
    if (!x) throw new Error('unsupported')
    const v = x.v
    let target = { commandClass: v.commandClass, endpoint: v.endpoint ?? 0, property: v.property, propertyKey: v.propertyKey }
    let val = value
    if (v.commandClass === 37) { target.property = 'targetValue'; val = !!value }
    if (v.commandClass === 38) { target.property = 'targetValue'; val = capId === 'onoff' ? (value ? 255 : 0) : Math.round(value * 99 / 100) }
    if (v.commandClass === 98) { target.property = 'targetMode'; val = value ? 255 : 0 }
    await this.ws.send({ command: 'node.set_value', nodeId: Number(device.native_id), valueId: target, value: val })
  }

  permitJoin() {
    return this.ws.send({ command: 'controller.begin_inclusion', options: { strategy: 0 } })
  }

  async stop() { this.ws.close() }
}
