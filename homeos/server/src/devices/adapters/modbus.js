import net from 'node:net'
import { cap, measurement, typeForSensor } from '../model.js'

export const MODBUS_DEVICE_FIELDS = [
  { key: 'kind', type: 'select', options: ['sensor', 'switch', 'binary'], required: true },
  { key: 'table', type: 'select', options: ['holding', 'input', 'coil', 'discrete'], required: true },
  { key: 'address', type: 'number', required: true },
  { key: 'datatype', type: 'select', options: ['uint16', 'int16', 'uint32', 'int32', 'float32'], for: ['sensor'] },
  { key: 'word_order', type: 'select', options: ['big', 'little'], for: ['sensor'] },
  { key: 'scale', type: 'number', for: ['sensor'] },
  { key: 'quantity', type: 'text', for: ['sensor'] },
  { key: 'unit', type: 'text', for: ['sensor'] },
  { key: 'unit_id', type: 'number' },
]

export function modbusDefinition(meta) {
  if (meta.kind === 'switch') return { type: 'switch', capabilities: [cap('onoff', 'onoff')] }
  if (meta.kind === 'binary') return { type: 'sensor', capabilities: [cap('state', 'binary')] }
  return { type: typeForSensor(meta.quantity), capabilities: [measurement(meta.quantity || 'value', meta.unit)] }
}

const WORDS = { uint16: 1, int16: 1, uint32: 2, int32: 2, float32: 2 }

export function decode(regs, type = 'uint16', order = 'big') {
  const words = order === 'little' ? [...regs].reverse() : regs
  const b = Buffer.alloc(words.length * 2)
  words.forEach((w, i) => b.writeUInt16BE(w, i * 2))
  switch (type) {
    case 'int16': return b.readInt16BE(0)
    case 'uint32': return b.readUInt32BE(0)
    case 'int32': return b.readInt32BE(0)
    case 'float32': return b.readFloatBE(0)
    default: return b.readUInt16BE(0)
  }
}

export class ModbusClient {
  constructor(host, port = 502, timeout = 3000) {
    this.host = host; this.port = port; this.timeout = timeout
    this.tx = 0; this.pending = new Map(); this.buf = Buffer.alloc(0); this.sock = null; this.chain = Promise.resolve()
  }

  connect() {
    if (this.sock && !this.sock.destroyed) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const s = net.connect({ host: this.host, port: this.port })
      const t = setTimeout(() => { s.destroy(); reject(new Error('timeout')) }, this.timeout)
      s.once('connect', () => { clearTimeout(t); this.sock = s; resolve() })
      s.once('error', e => { clearTimeout(t); reject(e) })
      s.on('data', d => this.onData(d))
      s.on('close', () => {
        this.sock = null; this.buf = Buffer.alloc(0)
        for (const p of this.pending.values()) p.reject(new Error('closed'))
        this.pending.clear()
      })
      s.on('error', () => {})
    })
  }

  onData(d) {
    this.buf = Buffer.concat([this.buf, d])
    while (this.buf.length >= 7) {
      const len = this.buf.readUInt16BE(4)
      if (this.buf.length < 6 + len) return
      const frame = this.buf.subarray(0, 6 + len)
      this.buf = this.buf.subarray(6 + len)
      const p = this.pending.get(frame.readUInt16BE(0))
      if (!p) continue
      this.pending.delete(frame.readUInt16BE(0))
      const fc = frame[7]
      if (fc & 0x80) p.reject(new Error(`modbus exception ${frame[8]}`))
      else p.resolve(frame.subarray(8))
    }
  }

  request(unit, fc, data) {
    const run = async () => {
      await this.connect()
      const id = this.tx = (this.tx + 1) & 0xffff
      const h = Buffer.alloc(8)
      h.writeUInt16BE(id, 0); h.writeUInt16BE(0, 2); h.writeUInt16BE(data.length + 2, 4); h[6] = unit; h[7] = fc
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { this.pending.delete(id); reject(new Error('timeout')) }, this.timeout)
        this.pending.set(id, { resolve: v => { clearTimeout(t); resolve(v) }, reject: e => { clearTimeout(t); reject(e) } })
        this.sock.write(Buffer.concat([h, data]))
      })
    }
    const p = this.chain.then(run, run)
    this.chain = p.catch(() => {})
    return p
  }

  async readRegisters(unit, table, addr, count) {
    const d = Buffer.alloc(4); d.writeUInt16BE(addr, 0); d.writeUInt16BE(count, 2)
    const r = await this.request(unit, table === 'input' ? 4 : 3, d)
    return Array.from({ length: count }, (_, i) => r.readUInt16BE(1 + i * 2))
  }

  async readBits(unit, table, addr, count = 1) {
    const d = Buffer.alloc(4); d.writeUInt16BE(addr, 0); d.writeUInt16BE(count, 2)
    const r = await this.request(unit, table === 'discrete' ? 2 : 1, d)
    return Array.from({ length: count }, (_, i) => !!(r[1 + (i >> 3)] & (1 << (i & 7))))
  }

  writeCoil(unit, addr, on) {
    const d = Buffer.alloc(4); d.writeUInt16BE(addr, 0); d.writeUInt16BE(on ? 0xff00 : 0, 2)
    return this.request(unit, 5, d)
  }

  writeRegister(unit, addr, value) {
    const d = Buffer.alloc(4); d.writeUInt16BE(addr, 0); d.writeUInt16BE(value & 0xffff, 2)
    return this.request(unit, 6, d)
  }

  close() { this.sock?.destroy() }
}

export default class ModbusAdapter {
  static fields = [
    { key: 'host', type: 'text', required: true },
    { key: 'port', type: 'number' },
    { key: 'unit_id', type: 'number' },
    { key: 'interval', type: 'number' },
  ]

  static manualDevices = true
  static deviceFields = MODBUS_DEVICE_FIELDS
  static definition = modbusDefinition

  constructor(integration, ctx) {
    this.cfg = integration.config
    this.ctx = ctx
    this.client = new ModbusClient(this.cfg.host, Number(this.cfg.port) || 502)
    this.timer = null
  }

  unit(m) { return Number(m.unit_id ?? this.cfg.unit_id ?? 1) || 0 }

  async read(m) {
    const addr = Number(m.address) || 0
    if (m.table === 'coil' || m.table === 'discrete') return (await this.client.readBits(this.unit(m), m.table, addr))[0]
    const regs = await this.client.readRegisters(this.unit(m), m.table, addr, WORDS[m.datatype] ?? 1)
    if (m.kind === 'switch' || m.kind === 'binary') return regs[0] !== 0
    const v = decode(regs, m.datatype, m.word_order) * (Number(m.scale) || 1)
    return Math.round(v * 1000) / 1000
  }

  async poll() {
    try {
      await this.client.connect()
    } catch (e) {
      for (const d of this.ctx.devices()) this.ctx.update(d.native_id, null, { connection: 'offline' })
      return this.ctx.setStatus('error', e.message)
    }
    let failed = 0
    const devices = this.ctx.devices()
    for (const d of devices) {
      try {
        const v = await this.read(d.meta)
        const id = d.capabilities[0]?.id ?? 'value'
        this.ctx.update(d.native_id, { [id]: v }, { connection: 'online' })
      } catch {
        failed++
        this.ctx.update(d.native_id, null, { connection: 'offline' })
      }
    }
    this.ctx.setStatus(devices.length && failed === devices.length ? 'error' : 'connected', null, { devices: devices.length })
  }

  async start() {
    await this.poll()
    this.timer = setInterval(() => this.poll(), Math.max(2, Number(this.cfg.interval) || 10) * 1000)
  }

  async command(device, capId, value) {
    const m = device.meta
    if (m.kind !== 'switch') throw new Error('readonly')
    if (m.table === 'coil') await this.client.writeCoil(this.unit(m), Number(m.address) || 0, !!value)
    else if (m.table === 'holding') await this.client.writeRegister(this.unit(m), Number(m.address) || 0, value ? 1 : 0)
    else throw new Error('readonly')
    this.ctx.update(device.native_id, { onoff: !!value })
  }

  async stop() {
    clearInterval(this.timer)
    this.client.close()
  }
}
