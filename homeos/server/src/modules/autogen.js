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
  kueche: 'Küche', buero: 'Büro', wohnzimmer: 'Wohnzimmer', schlafzimmer: 'Schlafzimmer', bad: 'Bad', flur: 'Flur', keller: 'Keller', kinderzimmer: 'Kinderzimmer', haustuer: 'Haustür', tuer: 'Tür', aussen: 'Außen',
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

const ROOM_WORDS = [[/wohnzimmer|living/i, 'Wohnzimmer'], [/küche|kueche|kitchen/i, 'Küche'], [/schlafzimmer|bedroom/i, 'Schlafzimmer'], [/kinderzimmer|kids?room/i, 'Kinderzimmer'], [/bad(ezimmer)?\b|bathroom|\bwc\b/i, 'Bad'], [/büro|buero|office|arbeitszimmer/i, 'Büro'], [/flur|diele|hallway|eingang/i, 'Flur'], [/keller|basement/i, 'Keller'], [/garage/i, 'Garage'], [/garten|terrasse|balkon|outdoor|außen|aussen/i, 'Außen'], [/esszimmer|dining/i, 'Esszimmer'], [/dachboden|attic/i, 'Dachboden'], [/technik|hauswirtschaft|hwr/i, 'Technik']]
const ROLE = {
  pv: /\bpv\b|solar|photovolt|wechselrichter|inverter|erzeugung|production|yield/i,
  grid: /\bnetz|grid|bezug|einspeis|import|export|zähler|zaehler|meter/i,
  home: /haus|home|verbrauch|consumption|\bload\b/i,
  battery: /batter|akku|speicher|storage/i,
  wallbox: /wallbox|ladestation|charger|evcc|auto|fahrzeug|vehicle/i,
}

export function roomFromName(name) {
  return ROOM_WORDS.find(([re]) => re.test(name))?.[1] ?? null
}

export function topicOf(d) {
  const n = `${d.name} ${d.nice ?? ''}`
  const qs = d.capabilities.filter(c => c.kind === 'measurement').map(c => c.quantity)
  if (d.meta?.proxmox) return 'server'
  if (['pv', 'battery', 'wallbox', 'energy_meter', 'vehicle'].includes(d.type) || qs.includes('power') || qs.includes('energy') || Object.values(ROLE).some(re => re.test(n) && qs.length)) return 'energy'
  if (['door', 'window', 'motion', 'smoke', 'lock'].includes(d.type)) return 'security'
  if (qs.some(q => ['temperature', 'humidity', 'co2', 'pressure', 'illuminance'].includes(q))) return 'climate'
  if (['light', 'switch', 'outlet', 'cover', 'blind', 'thermostat', 'heating', 'media'].includes(d.type)) return 'control'
  return 'other'
}

function roleOf(d) {
  if (d.type === 'pv') return 'pv'
  if (d.type === 'battery') return 'battery'
  if (d.type === 'wallbox' || d.type === 'vehicle') return 'wallbox'
  const n = `${d.name} ${d.nice}`
  for (const r of ['battery', 'wallbox', 'pv', 'grid', 'home']) if (ROLE[r].test(n)) return r
  return 'other'
}

function energyDashboard(devs) {
  const cap = (d, q) => d.capabilities.find(c => c.kind === 'measurement' && c.quantity === q)
  const by = r => devs.filter(d => roleOf(d) === r)
  const items = []
  const kpi = (d, c, title, color, w = 3) => items.push({ type: 'kpi', title, w, h: 2, config: { device_id: d.id, capability: c.id, color, unit: c.unit, decimals: c.unit === 'kWh' ? 1 : 0 } })
  const roles = [['pv', 'PV-Leistung', '#22C55E'], ['home', 'Hausverbrauch', '#F59E0B'], ['grid', 'Netz', '#3B82F6'], ['wallbox', 'Wallbox', '#EC4899']]
  for (const [r, label, color] of roles) { const d = by(r).find(x => cap(x, 'power')); if (d) kpi(d, cap(d, 'power'), by(r).length > 1 ? d.nice : label, color) }
  for (const d of by('battery')) { const c = cap(d, 'battery'); if (c) items.push({ type: 'gauge', title: d.nice, w: 3, h: 3, config: { device_id: d.id, capability: c.id, color: '#22C55E', min: 0, max: 100, unit: '%' } }) }
  const pv = by('pv').find(x => cap(x, 'power'))
  if (pv) items.push({ type: 'chart', title: 'PV-Erzeugung · Verlauf', w: 6, h: 3, config: { device_id: pv.id, capability: cap(pv, 'power').id, style: 'line', color: '#22C55E', unit: 'W' } })
  const home = by('home').find(x => cap(x, 'power'))
  if (home) items.push({ type: 'chart', title: 'Verbrauch · Verlauf', w: 6, h: 3, config: { device_id: home.id, capability: cap(home, 'power').id, style: 'line', color: '#F59E0B', unit: 'W' } })
  const grid = by('grid').find(x => cap(x, 'power'))
  if (grid) items.push({ type: 'chart', title: 'Netz · Verlauf', w: 6, h: 3, config: { device_id: grid.id, capability: cap(grid, 'power').id, style: 'line', color: '#3B82F6', unit: 'W' } })
  const used = new Set(items.map(w => `${w.config.device_id}:${w.config.capability}`))
  for (const d of devs) for (const c of measures(d)) {
    if (items.length >= 24 || used.has(`${d.id}:${c.id}`)) continue
    if (c.quantity === 'energy') { kpi(d, c, d.nice, '#22C55E'); used.add(`${d.id}:${c.id}`) }
    else if (c.quantity === 'power' && !used.has(`${d.id}:${c.id}`)) { kpi(d, c, d.nice, '#F59E0B'); used.add(`${d.id}:${c.id}`) }
  }
  for (const d of devs.filter(d => d.capabilities.some(c => c.writable))) if (items.length < 24) items.push({ type: 'device', title: d.nice, w: 3, h: 2, config: { device_id: d.id } })
  return items
}

function climateDashboard(devs) {
  const items = []
  for (const d of devs.sort((a, b) => (a.roomName ?? '').localeCompare(b.roomName ?? ''))) {
    const title = d.roomName && !d.nice.includes(d.roomName) ? `${d.roomName} · ${d.nice}` : d.nice
    for (const c of measures(d)) {
      if (c.quantity === 'temperature') items.push({ type: 'kpi', title, w: 3, h: 2, config: { device_id: d.id, capability: c.id, color: COLORS.temperature, unit: c.unit, decimals: 1 } })
      else if (['humidity', 'co2'].includes(c.quantity)) items.push({ type: 'gauge', title, w: 3, h: 3, config: { device_id: d.id, capability: c.id, color: COLORS[c.quantity], min: 0, max: c.quantity === 'co2' ? 2000 : 100, unit: c.unit } })
    }
  }
  return items.slice(0, 24)
}

const TOPICS = [
  ['energy', 'Solar & Energie', '☀', energyDashboard],
  ['climate', 'Klima', '♨', climateDashboard],
  ['security', 'Sicherheit', '⛨', devs => devs.map(d => ({ type: 'device', title: d.nice, w: 3, h: 2, config: { device_id: d.id } }))],
  ['server', 'Server', '⚙', devs => devs.flatMap(deviceWidgets)],
]

function buildPlan(picked, perRoom) {
  const roomNames = new Map(db.prepare('SELECT id, name FROM rooms').all().map(r => [r.id, r.name]))
  const byRoom = new Map()
  for (const d of picked) {
    d.topic = topicOf(d)
    d.roomName = d.room_id != null ? roomNames.get(d.room_id) : d.meta.area || roomFromName(`${d.name} ${d.nice}`) || (d.topic === 'server' ? 'Server' : null)
    if (d.roomName) byRoom.set(d.roomName, [...(byRoom.get(d.roomName) ?? []), d])
  }
  const rooms = [...byRoom].filter(([n]) => n !== 'Server').sort((a, b) => b[1].length - a[1].length)
  const top = []
  const firstWith = q => picked.find(d => measures(d).some(c => c.quantity === q))
  const capOf = (d, q) => measures(d).find(c => c.quantity === q)
  const powers = picked.filter(d => capOf(d, 'power')).sort((a, b) => ['pv', 'home', 'grid', 'battery', 'wallbox', 'other'].indexOf(roleOf(a)) - ['pv', 'home', 'grid', 'battery', 'wallbox', 'other'].indexOf(roleOf(b)))
  const temp = firstWith('temperature')
  top.push({ type: 'clock', title: '', w: 3, h: 2, config: {} })
  const kpis = []
  for (const d of powers) kpis.push([d, capOf(d, 'power')])
  if (temp) kpis.splice(1, 0, [temp, capOf(temp, 'temperature')])
  for (const d of picked) for (const c of measures(d)) if (c.quantity !== 'power' && !kpis.some(([x, y]) => x === d && y === c) && !(c.quantity === 'temperature' && temp)) kpis.push([d, c])
  for (const [d, c] of kpis.slice(0, 3)) top.push({ type: 'kpi', title: d.nice, w: 3, h: 2, config: { device_id: d.id, capability: c.id, color: roleOf(d) === 'pv' ? COLORS.energy : COLORS[c.quantity] ?? '#0A84FF', unit: c.unit, decimals: c.quantity === 'temperature' ? 1 : 0 } })
  if (powers[0]) top.push({ type: 'chart', title: `${powers[0].nice} · Verlauf`, w: 8, h: 3, config: { device_id: powers[0].id, capability: capOf(powers[0], 'power').id, style: 'line', color: '#EC4899', unit: 'W' } })
  const gaugeDev = picked.find(d => measures(d).some(c => GAUGE.includes(c.quantity)))
  if (gaugeDev) { const used = top.filter(w => w.config?.device_id === gaugeDev.id).map(w => w.config.capability); const c = measures(gaugeDev).find(x => GAUGE.includes(x.quantity) && !used.includes(x.id)) ?? measures(gaugeDev).find(x => GAUGE.includes(x.quantity)); top.push({ ...valueWidget(gaugeDev, c, gaugeDev.nice), w: 4 }) }
  for (const [name, devs] of rooms) top.push({ type: 'room', title: name, w: 4, h: Math.max(3, Math.min(8, 1 + Math.ceil(devs.length * 0.6))), room: name, devices: devs.map(d => d.id) })
  const dashboards = [{ name: 'Übersicht', icon: '⌂', widgets: layout(top) }]
  for (const [topic, name, icon, build] of TOPICS) {
    const devs = picked.filter(d => d.topic === topic)
    if (devs.length < (topic === 'server' ? 1 : 2)) continue
    const items = build(devs).slice(0, 24)
    if (items.length) dashboards.push({ name, icon, widgets: layout(items) })
  }
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
    const upd = db.prepare('UPDATE devices SET adopted = 1, room_id = ?, name = ?, groups = ? WHERE id = ?')
    const GROUP = { energy: 'Energie', climate: 'Klima', security: 'Sicherheit', server: 'Server', control: 'Licht & Schalter' }
    for (const d of picked) upd.run(d.roomName ? roomFor(d.roomName) : null, d.nice, JSON.stringify([...new Set([...(JSON.parse(d.groups || '[]')), ...(GROUP[d.topic] ? [GROUP[d.topic]] : [])])]), d.id)
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
