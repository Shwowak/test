const ROLES = ['pv', 'grid', 'battery', 'soc', 'house']
let totals = null
let lastTick = null
let tz = 'UTC'
let socWarned = false
let pending = null

const dayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())

function readPower(dev, wantSoc) {
  if (!dev) return null
  const caps = dev.capabilities.filter(c => c.kind === 'measurement')
  const c = wantSoc
    ? caps.find(c => c.quantity === 'battery') ?? caps.find(c => c.unit === '%')
    : caps.find(c => c.quantity === 'power') ?? caps.find(c => ['W', 'kW'].includes(c.unit))
  if (!c) return null
  const v = Number(dev.state?.[c.id])
  if (!Number.isFinite(v)) return null
  return !wantSoc && c.unit === 'kW' ? v * 1000 : v
}

async function snapshot() {
  const out = {}
  for (const r of ROLES) {
    const id = sdk.config[r]
    out[r] = id ? readPower(await sdk.devices.get(id), r === 'soc') : null
  }
  if (out.grid !== null && sdk.config.grid_invert) out.grid = -out.grid
  if (out.battery !== null && sdk.config.battery_invert) out.battery = -out.battery
  if (out.house === null && (out.pv !== null || out.grid !== null)) out.house = Math.max(0, (out.pv ?? 0) + (out.grid ?? 0) - (out.battery ?? 0))
  return out
}

async function tick() {
  const p = await snapshot()
  const configured = ROLES.some(r => sdk.config[r])
  const key = dayKey()
  if (!totals || totals.day !== key) {
    if (totals) {
      const hist = (await sdk.storage.get('history')) ?? []
      hist.push(totals)
      await sdk.storage.set('history', hist.slice(-400))
    }
    totals = (await sdk.storage.get('today'))?.day === key ? await sdk.storage.get('today') : { day: key, pv: 0, import: 0, export: 0, charge: 0, discharge: 0, house: 0 }
  }
  const now = Date.now()
  if (lastTick && now - lastTick < 300000) {
    const h = (now - lastTick) / 3600000
    const kwh = w => (w ?? 0) * h / 1000
    totals.pv += kwh(Math.max(0, p.pv ?? 0))
    totals.import += kwh(Math.max(0, p.grid ?? 0))
    totals.export += kwh(Math.max(0, -(p.grid ?? 0)))
    totals.charge += kwh(Math.max(0, p.battery ?? 0))
    totals.discharge += kwh(Math.max(0, -(p.battery ?? 0)))
    totals.house += kwh(p.house)
  }
  lastTick = now
  await sdk.storage.set('today', totals)
  const self = totals.house > 0 ? Math.max(0, Math.min(100, (1 - totals.import / totals.house) * 100)) : null
  const cost = (totals.import * (Number(sdk.config.price_import) || 0) - totals.export * (Number(sdk.config.price_export) || 0)) / 100
  await sdk.publish('energy', { configured, power: p, today: { ...totals, selfSufficiency: self, cost }, updated: new Date().toISOString() })
  const warn = Number(sdk.config.soc_warn) || 0
  if (warn && p.soc !== null && sdk.permissions.includes('notifications')) {
    if (p.soc < warn && !socWarned) { socWarned = true; await sdk.notify({ level: 'warning', title: sdk.lang === 'en' ? 'Battery low' : 'Batterie fast leer', message: `${Math.round(p.soc)} %` }) }
    if (p.soc > warn + 5) socWarned = false
  }
}

sdk.location().then(l => { tz = l.timezone || 'UTC' }).catch(() => {}).finally(() => {
  sdk.every(10, tick)
  sdk.on('device.state', e => {
    if (!ROLES.some(r => Number(sdk.config[r]) === e.id) || pending) return
    pending = setTimeout(() => { pending = null; tick().catch(() => {}) }, 2000)
  })
})
sdk.onConfig(() => tick().catch(() => {}))
sdk.onAction('history', async () => ((await sdk.storage.get('history')) ?? []).concat(totals ? [totals] : []))
