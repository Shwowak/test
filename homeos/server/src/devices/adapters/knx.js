import dgram from 'node:dgram'
import { cap, measurement, typeForSensor } from '../model.js'

export const KNX_DEVICE_FIELDS = [
  { key: 'kind', type: 'select', options: ['sensor', 'binary', 'switch', 'dimmer', 'cover'], required: true },
  { key: 'ga_state', type: 'text', required: true },
  { key: 'ga_write', type: 'text', for: ['switch', 'dimmer', 'cover'] },
  { key: 'ga_brightness', type: 'text', for: ['dimmer'] },
  { key: 'dpt', type: 'select', options: ['9', '5.001', '7', '13', '14'], for: ['sensor'] },
  { key: 'quantity', type: 'text', for: ['sensor'] },
  { key: 'unit', type: 'text', for: ['sensor'] },
]

export function knxDefinition(m) {
  if (m.kind === 'switch') return { type: 'switch', capabilities: [cap('onoff', 'onoff')] }
  if (m.kind === 'dimmer') return { type: 'light', capabilities: [cap('onoff', 'onoff'), cap('brightness', 'brightness')] }
  if (m.kind === 'cover') return { type: 'cover', capabilities: [cap('position', 'position')] }
  if (m.kind === 'binary') return { type: 'sensor', capabilities: [cap('state', 'binary')] }
  return { type: typeForSensor(m.quantity), capabilities: [measurement(m.quantity || 'value', m.unit)] }
}

export function parseGa(s) {
  const p = String(s ?? '').trim().split('/').map(Number)
  if (p.some(n => !Number.isInteger(n))) return null
  if (p.length === 3) return (p[0] << 11) | (p[1] << 8) | p[2]
  if (p.length === 2) return (p[0] << 11) | p[1]
  return p[0]
}

export function encodeDpt(dpt, v) {
  if (dpt === '1') return { small: v ? 1 : 0 }
  if (dpt === '5.001') return { data: Buffer.from([Math.round(Math.max(0, Math.min(100, v)) * 255 / 100)]) }
  if (dpt === '9') {
    let m = Math.round(v * 100), e = 0
    while (m < -2048 || m > 2047) { m = Math.round(m / 2); e++ }
    const raw = (m < 0 ? 0x8000 : 0) | (e << 11) | (m & 0x7ff)
    return { data: Buffer.from([raw >> 8, raw & 0xff]) }
  }
  if (dpt === '14') { const b = Buffer.alloc(4); b.writeFloatBE(v); return { data: b } }
  const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff); return { data: b }
}

export function decodeDpt(dpt, small, data) {
  if (dpt === '1') return !!(data.length ? data[0] & 1 : small & 1)
  if (dpt === '5.001') return Math.round(data[0] * 100 / 255)
  if (dpt === '9') {
    const raw = data.readUInt16BE(0)
    let m = raw & 0x7ff
    if (raw & 0x8000) m -= 2048
    return Math.round(m * (1 << ((raw >> 11) & 0xf)) * 0.01 * 100) / 100
  }
  if (dpt === '7') return data.readUInt16BE(0)
  if (dpt === '13') return data.readInt32BE(0)
  if (dpt === '14') return Math.round(data.readFloatBE(0) * 1000) / 1000
  return data[0]
}

function header(service, body) {
  const h = Buffer.from([0x06, 0x10, service >> 8, service & 0xff, 0, 0])
  h.writeUInt16BE(6 + body.length, 4)
  return Buffer.concat([h, body])
}

function cemi(code, ga, apci, enc) {
  const payload = enc.data ? Buffer.concat([Buffer.from([0x00, apci]), enc.data]) : Buffer.from([0x00, apci | (enc.small ?? 0)])
  const b = Buffer.from([code, 0x00, 0xbc, 0xe0, 0, 0, ga >> 8, ga & 0xff, payload.length - 1])
  return Buffer.concat([b, payload])
}

export function parseCemi(c) {
  const add = c[1]
  const o = 2 + add
  if (!(c[o + 1] & 0x80)) return null
  const ga = c.readUInt16BE(o + 4)
  const len = c[o + 6]
  const apdu = c.subarray(o + 7, o + 8 + len)
  const apci = ((apdu[0] & 0x03) << 2) | (apdu[1] >> 6)
  return { ga, apci, small: apdu[1] & 0x3f, data: apdu.subarray(2) }
}

const HPAI = Buffer.from([0x08, 0x01, 0, 0, 0, 0, 0, 0])

export default class KnxAdapter {
  static fields = [
    { key: 'host', type: 'text' },
    { key: 'port', type: 'number' },
    { key: 'mode', type: 'select', options: ['tunneling', 'routing'] },
  ]

  static manualDevices = true
  static deviceFields = KNX_DEVICE_FIELDS
  static definition = knxDefinition

  constructor(integration, ctx) {
    this.cfg = integration.config
    this.ctx = ctx
    this.routing = this.cfg.mode === 'routing' || !this.cfg.host
    this.host = this.cfg.host || '224.0.23.12'
    this.port = Number(this.cfg.port) || 3671
    this.channel = null
    this.seq = 0
    this.queue = Promise.resolve()
    this.acks = new Map()
  }

  async start() {
    this.sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.sock.on('message', m => this.onPacket(m))
    this.sock.on('error', e => this.ctx.setStatus('error', e.message))
    await new Promise(r => this.sock.bind(this.routing ? 3671 : 0, r))
    if (this.routing) {
      try { this.sock.addMembership(this.host) } catch (e) { return this.ctx.setStatus('error', e.message) }
      this.ready()
    } else {
      this.connect()
    }
  }

  connect() {
    clearTimeout(this.retry)
    this.channel = null
    this.sock.send(header(0x0205, Buffer.concat([HPAI, HPAI, Buffer.from([0x04, 0x04, 0x02, 0x00])])), this.port, this.host)
    this.retry = setTimeout(() => { this.ctx.setStatus('error', 'timeout'); this.connect() }, 10000)
  }

  ready() {
    this.ctx.setStatus('connected', null, { devices: this.ctx.devices().length })
    clearInterval(this.heartbeat)
    if (!this.routing) this.heartbeat = setInterval(() => this.sock.send(header(0x0207, Buffer.concat([Buffer.from([this.channel, 0]), HPAI])), this.port, this.host), 60000)
    for (const d of this.ctx.devices()) {
      const ga = parseGa(d.meta.ga_state)
      if (ga != null) this.send(ga, 0x00, {}).catch(() => {})
      if (d.meta.kind === 'dimmer' && parseGa(d.meta.ga_brightness) != null) this.send(parseGa(d.meta.ga_brightness), 0x00, {}).catch(() => {})
    }
  }

  onPacket(m) {
    if (m.length < 6 || m[0] !== 0x06) return
    const service = m.readUInt16BE(2)
    const body = m.subarray(6)
    if (service === 0x0206) {
      clearTimeout(this.retry)
      if (body[1] !== 0) { this.ctx.setStatus('error', `connect status ${body[1]}`); this.retry = setTimeout(() => this.connect(), 15000); return }
      this.channel = body[0]
      this.seq = 0
      return this.ready()
    }
    if (service === 0x0208 && body[1] !== 0) { this.ctx.setStatus('disconnected'); return this.connect() }
    if (service === 0x0209) { this.sock.send(header(0x020a, Buffer.from([body[0], 0])), this.port, this.host); this.ctx.setStatus('disconnected'); return this.connect() }
    if (service === 0x0421) { this.acks.get(body[2])?.(); return }
    if (service === 0x0420) {
      this.sock.send(header(0x0421, Buffer.from([0x04, body[1], body[2], 0])), this.port, this.host)
      return this.onCemi(body.subarray(4))
    }
    if (service === 0x0530) return this.onCemi(body)
  }

  onCemi(c) {
    if (c[0] !== 0x29) return
    let f
    try { f = parseCemi(c) } catch { return }
    if (!f || (f.apci !== 1 && f.apci !== 2)) return
    for (const d of this.ctx.devices()) {
      const m = d.meta
      const capId = d.capabilities[0]?.id
      if (parseGa(m.ga_state) === f.ga) {
        const dpt = m.kind === 'sensor' ? m.dpt || '9' : m.kind === 'cover' ? '5.001' : '1'
        this.ctx.update(d.native_id, { [m.kind === 'dimmer' ? 'onoff' : capId]: decodeDpt(dpt, f.small, f.data) }, { connection: 'online' })
      }
      if (m.kind === 'dimmer' && parseGa(m.ga_brightness) === f.ga) this.ctx.update(d.native_id, { brightness: decodeDpt('5.001', f.small, f.data) }, { connection: 'online' })
    }
  }

  send(ga, apci, enc) {
    const run = () => new Promise((resolve, reject) => {
      if (this.routing) {
        this.sock.send(header(0x0530, cemi(0x29, ga, apci, enc)), this.port, this.host, e => (e ? reject(e) : resolve()))
        return
      }
      if (this.channel == null) return reject(new Error('not_connected'))
      const seq = this.seq
      this.seq = (this.seq + 1) & 0xff
      const t = setTimeout(() => { this.acks.delete(seq); reject(new Error('timeout')) }, 1500)
      this.acks.set(seq, () => { clearTimeout(t); this.acks.delete(seq); setTimeout(resolve, 30) })
      this.sock.send(header(0x0420, Buffer.concat([Buffer.from([0x04, this.channel, seq, 0]), cemi(0x11, ga, apci, enc)])), this.port, this.host)
    })
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => {})
    return p
  }

  async command(device, capId, value) {
    const m = device.meta
    const write = parseGa(m.ga_write) ?? parseGa(m.ga_state)
    if (capId === 'onoff') await this.send(write, 0x80, encodeDpt('1', value))
    else if (capId === 'brightness') await this.send(parseGa(m.ga_brightness) ?? write, 0x80, encodeDpt('5.001', value))
    else if (capId === 'position') await this.send(write, 0x80, encodeDpt('5.001', value))
    else throw new Error('unsupported')
    this.ctx.update(device.native_id, { [capId]: value })
  }

  async stop() {
    clearTimeout(this.retry)
    clearInterval(this.heartbeat)
    if (this.channel != null) try { this.sock.send(header(0x0209, Buffer.concat([Buffer.from([this.channel, 0]), HPAI])), this.port, this.host) } catch {}
    await new Promise(r => setTimeout(r, 100))
    try { this.sock.close() } catch {}
  }
}
