import { cap, measurement } from '../model.js'
import { JsonWs } from './jsonws.js'

const ATTR = {
  '6/0': ['onoff', () => cap('onoff', 'onoff'), v => !!v, 'switch'],
  '8/0': ['brightness', () => cap('brightness', 'brightness'), v => Math.round((v ?? 0) / 254 * 100), 'light'],
  '1026/0': ['temperature', () => measurement('temperature'), v => v == null ? null : v / 100, 'sensor'],
  '1029/0': ['humidity', () => measurement('humidity'), v => v == null ? null : v / 100, 'sensor'],
  '1024/0': ['illuminance', () => measurement('illuminance'), v => v ? Math.round(10 ** ((v - 1) / 10000)) : 0, 'sensor'],
  '1030/0': ['motion', () => cap('motion', 'binary'), v => !!(v & 1), 'motion'],
  '69/0': ['contact', () => cap('contact', 'binary'), v => !v, 'door'],
  '257/0': ['lock', () => cap('lock', 'lock'), v => v === 1, 'lock'],
  '258/14': ['position', () => cap('position', 'position'), v => v == null ? null : 100 - Math.round(v / 100), 'cover'],
  '513/0': ['temperature', () => measurement('temperature'), v => v == null ? null : v / 100, 'thermostat'],
  '513/18': ['target_temperature', () => cap('target_temperature', 'target_temperature', { min: 5, max: 30, step: 0.5, unit: '°C' }), v => v / 100, 'thermostat'],
  '47/12': ['battery', () => measurement('battery'), v => Math.round(v / 2), null],
  '144/8': ['power', () => measurement('power'), v => v == null ? null : v / 1000, 'energy_meter'],
}
const PRIORITY = ['thermostat', 'lock', 'cover', 'light', 'switch', 'energy_meter', 'motion', 'door', 'sensor']

export function mapNode(node) {
  const eps = new Map()
  for (const [path, value] of Object.entries(node.attributes ?? {})) {
    const [ep, cl, at] = path.split('/')
    const def = ATTR[`${cl}/${at}`]
    if (!def || ep === '0') continue
    if (!eps.has(ep)) eps.set(ep, { caps: [], state: {}, types: new Set() })
    const e = eps.get(ep)
    if (e.caps.some(c => c.id === def[0])) continue
    e.caps.push(def[1]()); e.state[def[0]] = def[2](value)
    if (def[3]) e.types.add(def[3])
  }
  const battery = node.attributes?.['0/47/12'] ?? Object.entries(node.attributes ?? {}).find(([p]) => p.endsWith('/47/12'))?.[1]
  return [...eps].map(([ep, e]) => ({ ep, capabilities: e.caps, state: e.state, type: PRIORITY.find(t => e.types.has(t)) ?? 'sensor', battery: battery != null ? Math.round(battery / 2) : null }))
}

export default class MatterAdapter {
  static fields = [{ key: 'url', type: 'url', required: true }]

  static actions = { commission: 'commission' }

  constructor(integration, ctx) {
    this.cfg = integration.config
    this.ctx = ctx
    this.ws = new JsonWs(this.cfg.url || 'ws://localhost:5580/ws', {
      onMessage: m => this.onMessage(m),
      onClose: e => this.ctx.setStatus(e ? 'error' : 'disconnected', e ?? null),
    })
  }

  async start() { this.ws.connect() }

  onMessage(m) {
    if (m.fabric_id !== undefined && m.schema_version !== undefined) return this.onReady().catch(e => this.ctx.setStatus('error', e.message))
    if (m.message_id !== undefined) return this.ws.settle(m.message_id, m.error_code === undefined, m.result, m.details ?? m.error_code)
    if (m.event === 'attribute_updated') {
      const [nodeId, path, value] = m.data
      const [ep, cl, at] = path.split('/')
      const def = ATTR[`${cl}/${at}`]
      if (def) this.ctx.update(`${nodeId}-${ep}`, { [def[0]]: def[2](value) }, { connection: 'online' })
    } else if (m.event === 'node_added' || m.event === 'node_updated') this.addNode(m.data)
    else if (m.event === 'node_removed') this.ctx.update(`${m.data}-1`, null, { connection: 'offline' })
  }

  async onReady() {
    const nodes = await this.ws.send({ command: 'start_listening' }, 'message_id')
    let n = 0
    for (const node of nodes) n += this.addNode(node)
    this.ctx.setStatus('connected', null, { devices: n })
  }

  addNode(node) {
    const a = node.attributes ?? {}
    const label = a['0/40/5'] || a['0/40/3'] || `Matter ${node.node_id}`
    const eps = mapNode(node)
    for (const e of eps) {
      const id = `${node.node_id}-${e.ep}`
      this.ctx.upsert(id, {
        name: eps.length > 1 ? `${label} ${e.ep}` : label, type: e.type, capabilities: e.capabilities,
        manufacturer: a['0/40/1'] ?? null, model: a['0/40/3'] ?? null, meta: { protocol: 'matter', node: node.node_id, endpoint: Number(e.ep) },
      })
      this.ctx.update(id, e.state, { connection: node.available === false ? 'offline' : 'online', battery: e.battery })
    }
    return eps.length
  }

  cmd(node_id, endpoint_id, cluster_id, command_name, payload = {}) {
    return this.ws.send({ command: 'device_command', args: { node_id, endpoint_id, cluster_id, command_name, payload } }, 'message_id')
  }

  async command(device, capId, value) {
    const { node, endpoint } = device.meta
    if (capId === 'onoff') return this.cmd(node, endpoint, 6, value ? 'On' : 'Off')
    if (capId === 'brightness') return this.cmd(node, endpoint, 8, 'MoveToLevelWithOnOff', { level: Math.round(value / 100 * 254), transitionTime: 0, optionsMask: 0, optionsOverride: 0 })
    if (capId === 'lock') return this.cmd(node, endpoint, 257, value ? 'LockDoor' : 'UnlockDoor', {})
    if (capId === 'position') return this.cmd(node, endpoint, 258, 'GoToLiftPercentage', { liftPercent100thsValue: (100 - value) * 100 })
    if (capId === 'target_temperature') return this.ws.send({ command: 'write_attribute', args: { node_id: node, attribute_path: `${endpoint}/513/18`, value: Math.round(value * 100) } }, 'message_id')
    throw new Error('unsupported')
  }

  commission(code) {
    return this.ws.send({ command: 'commission_with_code', args: { code, network_only: false } }, 'message_id')
  }

  async stop() { this.ws.close() }
}
