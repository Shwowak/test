import https from 'node:https'
import http from 'node:http'
import { cap, measurement } from '../model.js'

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null)
const gb = v => (typeof v === 'number' ? Math.round(v / 1073741824 * 10) / 10 : null)

export function mapResource(r) {
  const running = r.status === 'running' || r.status === 'online' || r.status === 'available'
  if (r.type === 'node') {
    return {
      id: `node/${r.node}`, name: `Proxmox ${r.node}`, type: 'other',
      capabilities: [measurement('cpu', '%'), measurement('memory', '%'), measurement('disk', '%'), measurement('memory_used', 'GB'), cap('online', 'binary'), cap('uptime', 'text')],
      state: { cpu: r.cpu != null ? Math.round(r.cpu * 1000) / 10 : null, memory: pct(r.mem, r.maxmem), disk: pct(r.disk, r.maxdisk), memory_used: gb(r.mem), online: running, uptime: r.uptime ? `${Math.floor(r.uptime / 86400)} d ${Math.floor(r.uptime % 86400 / 3600)} h` : null },
      online: running,
    }
  }
  if (r.type === 'qemu' || r.type === 'lxc') {
    return {
      id: `${r.type}/${r.vmid}`, name: r.name || `${r.type === 'lxc' ? 'CT' : 'VM'} ${r.vmid}`, type: 'other',
      capabilities: [measurement('cpu', '%'), measurement('memory', '%'), measurement('memory_used', 'GB'), cap('running', 'binary')],
      state: { cpu: running && r.cpu != null ? Math.round(r.cpu * 1000) / 10 : 0, memory: running ? pct(r.mem, r.maxmem) : 0, memory_used: running ? gb(r.mem) : 0, running },
      online: true, model: `${r.type === 'lxc' ? 'LXC' : 'VM'} ${r.vmid} · ${r.node}`,
    }
  }
  if (r.type === 'storage') {
    return {
      id: `storage/${r.node}/${r.storage}`, name: `Speicher ${r.storage} (${r.node})`, type: 'sensor',
      capabilities: [measurement('disk', '%'), measurement('disk_free', 'GB')],
      state: { disk: pct(r.disk, r.maxdisk), disk_free: gb((r.maxdisk ?? 0) - (r.disk ?? 0)) },
      online: running,
    }
  }
  return null
}

export default class ProxmoxAdapter {
  static fields = [
    { key: 'url', type: 'url', required: true },
    { key: 'token_id', type: 'text', required: true },
    { key: 'token_secret', type: 'secret', required: true },
    { key: 'insecure', type: 'select', options: ['yes', 'no'] },
    { key: 'include', type: 'select', options: ['all', 'nodes', 'running'] },
    { key: 'interval', type: 'number' },
  ]

  constructor(integration, ctx) {
    this.cfg = integration.config
    this.ctx = ctx
    this.known = new Set()
  }

  get(path) {
    const u = new URL(path, String(this.cfg.url).replace(/\/+$/, '') + '/')
    const lib = u.protocol === 'http:' ? http : https
    return new Promise((resolve, reject) => {
      const req = lib.request(u, {
        headers: { Authorization: `PVEAPIToken=${this.cfg.token_id}=${this.cfg.token_secret}` },
        rejectUnauthorized: this.cfg.insecure === 'no', timeout: 10000,
      }, res => {
        let body = ''
        res.on('data', c => { body += c })
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`))
          try { resolve(JSON.parse(body).data) } catch (e) { reject(e) }
        })
      })
      req.on('timeout', () => req.destroy(new Error('timeout')))
      req.on('error', reject)
      req.end()
    })
  }

  async poll() {
    try {
      const list = await this.get('api2/json/cluster/resources')
      const include = this.cfg.include || 'all'
      let n = 0
      for (const r of list) {
        const m = mapResource(r)
        if (!m) continue
        if (include === 'nodes' && r.type !== 'node' && r.type !== 'storage') continue
        if (include === 'running' && (r.type === 'qemu' || r.type === 'lxc') && r.status !== 'running') continue
        n++
        if (!this.known.has(m.id)) {
          this.ctx.upsert(m.id, { name: m.name, type: m.type, capabilities: m.capabilities, manufacturer: 'Proxmox', model: m.model ?? r.type, meta: { area: 'Server', proxmox: r.type } })
          this.known.add(m.id)
        }
        this.ctx.update(m.id, m.state, { connection: m.online ? 'online' : 'offline' })
      }
      this.ctx.setStatus('connected', null, { devices: n })
    } catch (e) {
      this.ctx.setStatus('error', e.message)
    }
  }

  async start() {
    await this.poll()
    this.timer = setInterval(() => this.poll(), Math.max(5, Number(this.cfg.interval) || 15) * 1000)
  }

  async command() { throw new Error('readonly') }

  async stop() { clearInterval(this.timer) }
}
