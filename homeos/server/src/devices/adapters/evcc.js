import { cap, measurement } from '../model.js'

const MODES = ['off', 'pv', 'minpv', 'now']
const num = v => (typeof v === 'number' ? Math.round(v * 10) / 10 : typeof v?.power === 'number' ? Math.round(v.power * 10) / 10 : null)

export function siteDevices(s) {
  const out = []
  const pv = num(s.pvPower)
  if (pv != null) out.push(['pv', { name: 'PV-Anlage', type: 'pv', capabilities: [measurement('power', 'W'), measurement('energy', 'kWh')] }, { power: pv, energy: s.pvEnergy != null ? Math.round(s.pvEnergy / 100) / 10 : null }])
  const grid = num(s.gridPower ?? s.grid)
  if (grid != null) out.push(['grid', { name: 'Netz', type: 'energy_meter', capabilities: [measurement('power', 'W')] }, { power: grid }])
  const home = num(s.homePower)
  if (home != null) out.push(['home', { name: 'Hausverbrauch', type: 'energy_meter', capabilities: [measurement('power', 'W')] }, { power: home }])
  const soc = s.batterySoc ?? s.battery?.soc
  if (soc != null) out.push(['battery', { name: 'Hausspeicher', type: 'battery', capabilities: [measurement('battery', '%'), measurement('power', 'W')] }, { battery: Math.round(soc), power: num(s.batteryPower ?? s.battery?.power) }])
  ;(s.loadpoints ?? []).forEach((lp, i) => {
    out.push([`lp${i + 1}`, {
      name: lp.title || `Wallbox ${i + 1}`, type: 'wallbox',
      capabilities: [cap('mode', 'select', { options: MODES }), measurement('power', 'W'), measurement('energy', 'kWh'), measurement('battery', '%'), cap('charging', 'binary'), cap('connected', 'binary'), cap('vehicle', 'text')],
      meta: { loadpoint: i + 1 },
    }, {
      mode: lp.mode, power: num(lp.chargePower) ?? 0, energy: lp.chargedEnergy != null ? Math.round(lp.chargedEnergy / 100) / 10 : null,
      battery: lp.vehicleSoc != null ? Math.round(lp.vehicleSoc) : null, charging: !!lp.charging, connected: !!lp.connected, vehicle: lp.vehicleTitle || lp.vehicleName || null,
    }])
  })
  return out
}

export default class EvccAdapter {
  static fields = [
    { key: 'url', type: 'url', required: true },
    { key: 'password', type: 'secret' },
    { key: 'interval', type: 'number' },
  ]

  constructor(integration, ctx) {
    this.cfg = integration.config
    this.ctx = ctx
    this.base = String(this.cfg.url || '').replace(/\/+$/, '')
    this.known = new Set()
    this.cookie = ''
  }

  async poll() {
    try {
      const r = await fetch(`${this.base}/api/state`, { signal: AbortSignal.timeout(8000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const body = await r.json()
      const s = body.result ?? body
      const devs = siteDevices(s)
      for (const [id, def, state] of devs) {
        if (!this.known.has(id)) { this.ctx.upsert(id, { manufacturer: 'evcc', model: def.type, meta: {}, ...def }); this.known.add(id) }
        this.ctx.update(id, state, { connection: 'online', battery: def.type === 'battery' ? state.battery : null })
      }
      this.ctx.setStatus('connected', null, { devices: devs.length, site: s.siteTitle ?? null })
    } catch (e) {
      for (const id of this.known) this.ctx.update(id, null, { connection: 'offline' })
      this.ctx.setStatus('error', e.message)
    }
  }

  async login() {
    if (!this.cfg.password) return
    const r = await fetch(`${this.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: this.cfg.password }), signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error('evcc login failed')
    this.cookie = (r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie')]).filter(Boolean).map(c => c.split(';')[0]).join('; ')
  }

  async post(path) {
    const go = () => fetch(`${this.base}${path}`, { method: 'POST', headers: this.cookie ? { cookie: this.cookie } : {}, signal: AbortSignal.timeout(8000) })
    let r = await go()
    if (r.status === 401 || r.status === 403) { await this.login(); r = await go() }
    if (!r.ok) throw new Error(`evcc HTTP ${r.status}`)
  }

  async start() {
    await this.poll()
    this.timer = setInterval(() => this.poll(), Math.max(3, Number(this.cfg.interval) || 5) * 1000)
  }

  async command(device, capId, value) {
    const lp = device.meta?.loadpoint
    if (capId !== 'mode' || !lp || !MODES.includes(value)) throw new Error('unsupported')
    await this.post(`/api/loadpoints/${lp}/mode/${value}`)
    this.ctx.update(device.native_id, { mode: value })
  }

  async stop() { clearInterval(this.timer) }
}
