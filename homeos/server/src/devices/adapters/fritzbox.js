import { createHash, pbkdf2Sync } from 'node:crypto'
import { cap, measurement } from '../model.js'

const tag = (xml, name) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]
const block = (xml, name) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]
const num = v => (v === undefined || v === '' ? null : Number(v))

export function loginResponse(challenge, password) {
  if (challenge.startsWith('2$')) {
    const [, iter1, salt1, iter2, salt2] = challenge.split('$')
    const h1 = pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from(salt1, 'hex'), Number(iter1), 32, 'sha256')
    const h2 = pbkdf2Sync(h1, Buffer.from(salt2, 'hex'), Number(iter2), 32, 'sha256')
    return `${salt2}$${h2.toString('hex')}`
  }
  return `${challenge}-${createHash('md5').update(Buffer.from(`${challenge}-${password}`, 'utf16le')).digest('hex')}`
}

const hkrTemp = v => { const n = num(v); return n == null || n >= 253 ? null : n / 2 }

export function parseDevices(xml) {
  const out = []
  for (const m of xml.matchAll(/<device ([^>]*)>([\s\S]*?)<\/device>/g)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1], a[2]]))
    const body = m[2]
    const caps = []
    const state = {}
    let type = 'sensor'
    const sw = block(body, 'switch')
    if (sw) { caps.push(cap('onoff', 'onoff')); state.onoff = tag(sw, 'state') === '1'; type = 'outlet' }
    const pm = block(body, 'powermeter')
    if (pm) {
      caps.push(measurement('power', 'W'), measurement('energy', 'kWh'), measurement('voltage', 'V'))
      state.power = num(tag(pm, 'power')) / 1000
      state.energy = Math.round(num(tag(pm, 'energy'))) / 1000
      state.voltage = Math.round(num(tag(pm, 'voltage')) / 100) / 10
    }
    const t = block(body, 'temperature')
    if (t && tag(t, 'celsius') !== undefined) { caps.push(measurement('temperature', '°C')); state.temperature = num(tag(t, 'celsius')) / 10 }
    const hu = block(body, 'humidity')
    if (hu) { caps.push(measurement('humidity', '%')); state.humidity = num(tag(hu, 'rel_humidity')) }
    const hkr = block(body, 'hkr')
    if (hkr) {
      type = 'thermostat'
      caps.push(cap('target_temperature', 'target_temperature', { min: 8, max: 28, step: 0.5, unit: '°C' }))
      state.target_temperature = hkrTemp(tag(hkr, 'tsoll'))
      if (!state.temperature) { caps.push(measurement('temperature', '°C')); state.temperature = hkrTemp(tag(hkr, 'tist')) }
      if (tag(hkr, 'battery') !== undefined) { caps.push(measurement('battery', '%')); state.battery = num(tag(hkr, 'battery')) }
      if (tag(hkr, 'windowopenactiv') !== undefined) { caps.push(cap('window', 'binary')); state.window = tag(hkr, 'windowopenactiv') === '1' }
    }
    const so = block(body, 'simpleonoff')
    if (so && !sw) { caps.push(cap('onoff', 'onoff')); state.onoff = tag(so, 'state') === '1'; type = 'light' }
    const lv = block(body, 'levelcontrol')
    if (lv) { caps.push(cap('brightness', 'brightness')); state.brightness = num(tag(lv, 'levelpercentage')); type = 'light' }
    if (!caps.length) continue
    out.push({
      ain: attrs.identifier.replace(/\s/g, ''), name: tag(body, 'name') || attrs.productname, type, capabilities: caps, state,
      present: tag(body, 'present') === '1', manufacturer: attrs.manufacturer || 'AVM', model: attrs.productname, battery: state.battery ?? null,
    })
  }
  return out
}

export default class FritzboxAdapter {
  static fields = [
    { key: 'url', type: 'url', required: true },
    { key: 'username', type: 'text' },
    { key: 'password', type: 'secret', required: true },
    { key: 'interval', type: 'number' },
  ]

  constructor(integration, ctx) {
    this.cfg = integration.config
    this.ctx = ctx
    this.base = String(this.cfg.url || 'http://fritz.box').replace(/\/+$/, '')
    this.sid = null
    this.known = new Set()
  }

  async get(path) {
    const r = await fetch(`${this.base}${path}`, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.text()
  }

  async login() {
    const info = await this.get('/login_sid.lua?version=2')
    const challenge = tag(info, 'Challenge')
    const user = this.cfg.username || tag(info, 'User') || ''
    const res = await this.get(`/login_sid.lua?version=2&username=${encodeURIComponent(user)}&response=${encodeURIComponent(loginResponse(challenge, this.cfg.password || ''))}`)
    const sid = tag(res, 'SID')
    if (!sid || /^0+$/.test(sid)) throw new Error('login failed')
    this.sid = sid
  }

  async aha(cmd, ain = '', param = '') {
    if (!this.sid) await this.login()
    const q = `/webservices/homeautoswitch.lua?switchcmd=${cmd}&sid=${this.sid}${ain ? `&ain=${encodeURIComponent(ain)}` : ''}${param !== '' ? `&param=${param}` : ''}`
    try { return await this.get(q) } catch (e) {
      if (!/403/.test(e.message)) throw e
      await this.login()
      return this.get(q.replace(/sid=[^&]+/, `sid=${this.sid}`))
    }
  }

  async poll() {
    try {
      const devs = parseDevices(await this.aha('getdevicelistinfos'))
      for (const d of devs) {
        if (!this.known.has(d.ain)) {
          this.ctx.upsert(d.ain, { name: d.name, type: d.type, capabilities: d.capabilities, manufacturer: d.manufacturer, model: d.model, meta: { ain: d.ain } })
          this.known.add(d.ain)
        }
        this.ctx.update(d.ain, d.state, { connection: d.present ? 'online' : 'offline', battery: d.battery })
      }
      this.ctx.setStatus('connected', null, { devices: devs.length })
    } catch (e) {
      this.sid = null
      this.ctx.setStatus('error', e.message)
    }
  }

  async start() {
    await this.poll()
    this.timer = setInterval(() => this.poll(), Math.max(10, Number(this.cfg.interval) || 30) * 1000)
  }

  async command(device, capId, value) {
    const ain = device.meta?.ain ?? device.native_id
    if (capId === 'onoff') {
      if (device.type === 'light') await this.aha('setsimpleonoff', ain, value ? 1 : 0)
      else await this.aha(value ? 'setswitchon' : 'setswitchoff', ain)
    } else if (capId === 'brightness') await this.aha('setlevelpercentage', ain, Math.round(value))
    else if (capId === 'target_temperature') await this.aha('sethkrtsoll', ain, Math.round(value * 2))
    else throw new Error('unsupported')
    this.ctx.update(device.native_id, { [capId]: value })
  }

  async stop() { clearInterval(this.timer) }
}
