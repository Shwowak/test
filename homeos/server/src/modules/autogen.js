import { db, json } from '../core/db.js'
import { getSetting, setSetting } from '../core/settings.js'
import { invalidate } from '../devices/engine.js'

const QUANTITIES = ['temperature', 'humidity', 'power', 'energy', 'co2', 'illuminance', 'pressure', 'cpu', 'memory', 'disk']
const ENERGY_TYPES = ['pv', 'battery', 'wallbox', 'energy_meter']
const ORDER = ['light', 'switch', 'outlet', 'cover', 'blind', 'thermostat', 'heating', 'lock', 'media', 'door', 'window', 'motion', 'smoke', 'energy_meter', 'pv', 'battery', 'wallbox', 'sensor', 'vehicle', 'other']
const ROOM_ICONS = [[/wohn|living/i, '⌂'], [/küche|kitchen/i, '☕'], [/schlaf|bed/i, '☾'], [/bad|bath/i, '♒'], [/kind|kid/i, '✦'], [/büro|office|arbeit/i, '▤'], [/garten|garden|außen|outdoor|terrasse/i, '☀'], [/garage|keller|basement|technik|server/i, '⚙'], [/flur|diele|hall/i, '◈']]

const WORDS = {
  battery: 'Batterie', batterie: 'Batterie', discharge: 'Entladung', discharging: 'Entladung', charge: 'Ladung', charging: 'Laden',
  energy: 'Energie', energie: 'Energie', power: 'Leistung', grid: 'Netz', import: 'Bezug', export: 'Einspeisung', feed: 'Einspeisung', in: '', out: '',
  solar: 'Solar', pv: 'PV', yield: 'Ertrag', production: 'Erzeugung', consumption: 'Verbrauch', load: 'Last', house: 'Haus', home: 'Haus',
  temperature: 'Temperatur', temp: 'Temperatur', humidity: 'Luftfeuchte', voltage: 'Spannung', current: 'Strom', frequency: 'Frequenz',
  today: 'heute', daily: 'heute', total: 'gesamt', monthly: 'Monat', yearly: 'Jahr', soc: 'Ladestand', state: 'Status', level: 'Stand',
  light: 'Licht', lamp: 'Lampe', switch: 'Schalter', plug: 'Steckdose', socket: 'Steckdose', outlet: 'Steckdose', door: 'Tür', window: 'Fenster',
  motion: 'Bewegung', presence: 'Anwesenheit', living: 'Wohn', room: 'Zimmer', kitchen: 'Küche', bedroom: 'Schlafzimmer', bathroom: 'Bad',
  office: 'Büro', garage: 'Garage', garden: 'Garten', outdoor: 'Außen', indoor: 'Innen', inverter: 'Wechselrichter', heat: 'Wärme', pump: 'Pumpe',
  wallbox: 'Wallbox', car: 'Auto', vehicle: 'Fahrzeug', water: 'Wasser', gas: 'Gas', heating: 'Heizung', thermostat: 'Thermostat', co2: 'CO₂',
}

export function niceName(name) {
  const raw = String(name ?? '').trim()
  if (!raw || (/\s/.test(raw) && !/_/.test(raw) && !/^[a-z0-9.]+$/.test(raw))) return raw
  const words = raw.replace(/^[a-z_]+\./, '').split(/[_.\-\s]+/).filter(Boolean)
  const out = []
  for (const w of words) {
    const t = WORDS[w.toLowerCase()]
    const v = t === undefined ? (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)) : t
    if (v && out.at(-1) !== v) out.push(v)
  }
  return out.join(' ').replace(/\s+/g, ' ').trim() || raw
}

export function relevant(d) {
  if (d.hidden || d.type === 'camera') return false
  const caps = d.capabilities
  if (caps.some(c => c.writable)) return true
  if (caps.some(c => c.kind === 'binary')) return ['door', 'window', 'motion', 'smoke', 'lock'].includes(d.type)
  return caps.some(c => c.kind === 'measurement' && QUANTITIES.includes(c.quantity)) || ENERGY_TYPES.includes(d.type)
}

function roomFor(name) {
  const r = db.prepare('SELECT id FROM rooms WHERE lower(name) = lower(?)').get(name)
  if (r) return r.id
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM rooms').get().p
  return db.prepare('INSERT INTO rooms (name, position) VALUES (?, ?)').run(name, pos).lastInsertRowid
}

const rank = d => (ORDER.indexOf(d.type) + 1 || 99)

const COLORS = { temperature: '#22D3EE', humidity: '#3B82F6', power: '#F59E0B', energy: '#22C55E', battery: '#22C55E', cpu: '#8B5CF6', memory: '#22D3EE', disk: '#EC4899', co2: '#A3E635', illuminance: '#FACC15', pressure: '#94A3B8' }
const GAUGE = ['cpu', 'memory', 'disk', 'humidity', 'battery', 'co2']
const PRIMARY = ['power', 'temperature', 'cpu', 'memory', 'disk', 'humidity', 'energy', 'battery', 'co2', 'illuminance', 'pressure']

function packer() {
  const cols = Array(12).fill(0)
  return (w, h) => {
    let best = null
    for (let x = 0; x + w <= 12; x++) {
      const y = Math.max(...cols.slice(x, x + w))
      if (!best || y < best.y) best = { x, y }
    }
    for (let i = best.x; i < best.x + w; i++) cols[i] = best.y + h
    return best
  }
}

function measures(d) {
  return d.capabilities.filter(c => c.kind === 'measurement' && PRIMARY.includes(c.quantity)).sort((a, b) => PRIMARY.indexOf(a.quantity) - PRIMARY.indexOf(b.quantity))
}

function valueWidget(d, c, title) {
  const q = c.quantity
  const color = COLORS[q] ?? '#0A84FF'
  const bind = { device_id: d.id, capability: c.id, color }
  if (q === 'power') return { type: 'chart', title, w: 6, h: 3, config: { ...bind, style: 'line', unit: c.unit } }
  if (GAUGE.includes(q)) return { type: 'gauge', title, w: 3, h: 3, config: { ...bind, min: 0, max: q === 'co2' ? 2000 : 100, unit: c.unit } }
  return { type: 'kpi', title, w: 3, h: 2, config: { ...bind, unit: c.unit, decimals: q === 'temperature' ? 1 : 0 } }
}

function deviceWidgets(d) {
  const ms = measures(d)
  if (d.capabilities.some(c => c.writable) || !ms.length) return [{ type: 'device', title: d.nice, w: 3, h: 2, config: { device_id: d.id } }]
  if (d.meta?.proxmox === 'node') {
    const by = q => ms.find(c => c.quantity === q)
    return [
      ...['cpu', 'memory', 'disk'].filter(by).map(q => valueWidget(d, by(q), `${d.nice} · ${q === 'cpu' ? 'CPU' : q === 'memory' ? 'RAM' : 'Speicher'}`)),
      by('cpu') && { type: 'chart', title: `${d.nice} · CPU-Verlauf`, w: 6, h: 3, config: { device_id: d.id, capability: by('cpu').id, style: 'line', color: COLORS.cpu, unit: '%' } },
    ].filter(Boolean)
  }
  return [valueWidget(d, ms[0], d.nice)]
}

function layout(items) {
  const place = packer()
  return items.map(w => ({ ...w, ...place(w.w, w.h) }))
}

function buildPlan(picked, perRoom) {
  const roomNames = new Map(db.prepare('SELECT id, name FROM rooms').all().map(r => [r.id, r.name]))
  const byRoom = new Map()
  for (const d of picked) {
    d.roomName = d.room_id != null ? roomNames.get(d.room_id) : d.meta.area || null
    if (d.roomName) byRoom.set(d.roomName, [...(byRoom.get(d.roomName) ?? []), d])
  }
  const rooms = [...byRoom].sort((a, b) => b[1].length - a[1].length)
  const top = []
  const firstWith = q => picked.find(d => measures(d)[0]?.quantity === q || measures(d).some(c => c.quantity === q))
  const capOf = (d, q) => measures(d).find(c => c.quantity === q)
  const powers = picked.filter(d => capOf(d, 'power')).sort((a, b) => rank(a) - rank(b))
  const temp = firstWith('temperature')
  top.push({ type: 'clock', title: '', w: 3, h: 2, config: {} })
  const kpis = []
  if (temp) kpis.push([temp, capOf(temp, 'temperature')])
  for (const d of powers) kpis.push([d, capOf(d, 'power')])
  for (const d of picked) for (const c of measures(d)) if (!['power'].includes(c.quantity) && !kpis.some(([x, y]) => x === d && y === c) && !(c.quantity === 'temperature' && temp)) kpis.push([d, c])
  for (const [d, c] of kpis.slice(0, 3)) top.push({ type: 'kpi', title: d.nice, w: 3, h: 2, config: { device_id: d.id, capability: c.id, color: d.type === 'pv' ? COLORS.energy : COLORS[c.quantity] ?? '#0A84FF', unit: c.unit, decimals: c.quantity === 'temperature' ? 1 : 0 } })
  if (powers[0]) top.push({ type: 'chart', title: `${powers[0].nice} · Verlauf`, w: 8, h: 3, config: { device_id: powers[0].id, capability: capOf(powers[0], 'power').id, style: 'line', color: '#EC4899', unit: 'W' } })
  const gaugeDev = picked.find(d => measures(d).some(c => GAUGE.includes(c.quantity)))
  if (gaugeDev) { const used = top.filter(w => w.config?.device_id === gaugeDev.id).map(w => w.config.capability); const c = measures(gaugeDev).find(x => GAUGE.includes(x.quantity) && !used.includes(x.id)) ?? measures(gaugeDev).find(x => GAUGE.includes(x.quantity)); top.push({ ...valueWidget(gaugeDev, c, gaugeDev.nice), w: 4 }) }
  for (const [name, devs] of rooms) top.push({ type: 'room', title: name, w: 4, h: Math.max(3, Math.min(8, 1 + Math.ceil(devs.length * 0.6))), room: name, devices: devs.map(d => d.id) })
  const dashboards = [{ name: 'Übersicht', icon: '⌂', widgets: layout(top) }]
  if (perRoom) {
    for (const [name, devs] of rooms.filter(([, d]) => d.length >= 3).slice(0, 12)) {
      const sorted = devs.sort((a, b) => rank(a) - rank(b) || a.nice.localeCompare(b.nice))
      const items = sorted.flatMap(deviceWidgets).slice(0, 24)
      items.sort((a, b) => (b.w * b.h) - (a.w * a.h))
      dashboards.push({ name, icon: ROOM_ICONS.find(([re]) => re.test(name))?.[1] ?? '◈', widgets: layout(items) })
    }
  }
  return { dashboards, rooms: byRoom.size }
}

export function generate({ replace = true, rooms: perRoom = true, dryRun = false } = {}) {
  const all = db.prepare('SELECT d.* FROM devices d JOIN integrations i ON i.id = d.integration_id WHERE i.enabled = 1').all()
    .map(r => ({ ...r, capabilities: json(r.capabilities || '[]'), meta: json(r.meta), hidden: !!r.hidden, adopted: !!r.adopted }))
  const picked = all.filter(relevant)
  for (const d of picked) d.nice = niceName(d.name)
  const plan = buildPlan(picked, perRoom)
  const summary = { devices_total: all.length, devices_used: picked.length, rooms: plan.rooms, dashboards: plan.dashboards.length, created: !!(getSetting('autogen_dashboards') ?? []).length }
  if (dryRun) return { ...summary, plan: plan.dashboards, names: Object.fromEntries(picked.map(d => [d.id, d.nice])) }

  db.exec('BEGIN')
  try {
    const upd = db.prepare('UPDATE devices SET adopted = 1, room_id = ?, name = ? WHERE id = ?')
    for (const d of picked) upd.run(d.roomName ? roomFor(d.roomName) : null, d.nice, d.id)
    const style = db.prepare(`SELECT style FROM dashboards WHERE id NOT IN (${(getSetting('autogen_dashboards') ?? []).map(Number).join(',') || 0}) ORDER BY position, id LIMIT 1`).get()?.style ?? 'seamless'
    if (replace) for (const id of getSetting('autogen_dashboards') ?? []) db.prepare('DELETE FROM dashboards WHERE id = ?').run(id)
    const created = []
    let pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM dashboards').get().p
    const widget = db.prepare('INSERT INTO widgets (dashboard_id, type, title, x, y, w, h, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    for (const d of plan.dashboards) {
      const id = db.prepare('INSERT INTO dashboards (name, icon, position, style) VALUES (?, ?, ?, ?)').run(d.name, d.icon, pos++, style).lastInsertRowid
      created.push(id)
      for (const w of d.widgets) widget.run(id, w.type, w.title, w.x, w.y, w.w, w.h, JSON.stringify(w.room ? { room_id: roomFor(w.room) } : w.config))
    }
    setSetting('autogen_dashboards', created)
    db.exec('COMMIT')
    summary.dashboards = created.length
    summary.first = created[0]
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  invalidate()
  return summary
}
