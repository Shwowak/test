import { cpus, totalmem, freemem, uptime, loadavg, hostname } from 'node:os'
import { readFileSync, statfsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { cap, measurement } from '../model.js'

const DATA = dirname(resolve(process.env.HOMEOS_DB ?? './data/homeos.db'))
const readNum = p => { try { return Number(readFileSync(p, 'utf8').trim()) } catch { return null } }
const round = v => (v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10)

function cpuTimes() {
  return cpus().reduce((a, c) => {
    const t = c.times
    a.idle += t.idle
    a.total += t.user + t.nice + t.sys + t.idle + t.irq
    return a
  }, { idle: 0, total: 0 })
}

export default class SystemAdapter {
  static fields = [{ key: 'interval', type: 'number' }]
  static hidden = true

  constructor(integration, ctx) {
    this.cfg = integration.config
    this.ctx = ctx
    this.prev = cpuTimes()
  }

  sample() {
    const now = cpuTimes()
    const dt = now.total - this.prev.total
    const cpu = dt > 0 ? (1 - (now.idle - this.prev.idle) / dt) * 100 : null
    this.prev = now
    let disk = null, diskFree = null
    try { const f = statfsSync(DATA); disk = (1 - f.bavail / f.blocks) * 100; diskFree = (f.bavail * f.bsize) / 1073741824 } catch {}
    const temp = readNum('/sys/class/thermal/thermal_zone0/temp')
    const up = uptime()
    return {
      cpu: round(cpu), memory: round((1 - freemem() / totalmem()) * 100), memory_used: round((totalmem() - freemem()) / 1073741824),
      disk: round(disk), disk_free: round(diskFree), temperature: temp ? round(temp / 1000) : null,
      load: round(loadavg()[0]), uptime: `${Math.floor(up / 86400)} d ${Math.floor(up % 86400 / 3600)} h`,
    }
  }

  async start() {
    const s = this.sample()
    const caps = [measurement('cpu', '%'), measurement('memory', '%'), measurement('memory_used', 'GB'), measurement('disk', '%'), measurement('disk_free', 'GB'), measurement('load', ''), cap('uptime', 'text')]
    if (s.temperature != null) caps.push(measurement('temperature', '°C'))
    this.ctx.upsert('smartboard', { name: `SmartBoard (${hostname()})`, type: 'other', capabilities: caps, manufacturer: 'SmartBoard', model: 'System', meta: { area: 'Server', system: true } })
    const tick = () => this.ctx.update('smartboard', this.sample(), { connection: 'online' })
    tick()
    this.timer = setInterval(tick, Math.max(5, Number(this.cfg.interval) || 10) * 1000)
    this.ctx.setStatus('connected', null, { devices: 1 })
  }

  async command() { throw new Error('readonly') }

  async stop() { clearInterval(this.timer) }
}
