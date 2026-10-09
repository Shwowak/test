import { db, json } from '../core/db.js'
import { getSetting, setSetting } from '../core/settings.js'
import { invalidate } from '../devices/engine.js'

const QUANTITIES = ['temperature', 'humidity', 'power', 'energy', 'co2', 'illuminance', 'pressure']
const ENERGY_TYPES = ['pv', 'battery', 'wallbox', 'energy_meter']
const ORDER = ['light', 'switch', 'outlet', 'cover', 'blind', 'thermostat', 'heating', 'lock', 'media', 'door', 'window', 'motion', 'smoke', 'energy_meter', 'pv', 'battery', 'wallbox', 'sensor', 'vehicle', 'other']
const ROOM_ICONS = [[/wohn|living/i, '⌂'], [/küche|kitchen/i, '☕'], [/schlaf|bed/i, '☾'], [/bad|bath/i, '♒'], [/kind|kid/i, '✦'], [/büro|office|arbeit/i, '▤'], [/garten|garden|außen|outdoor|terrasse/i, '☀'], [/garage|keller|basement|technik/i, '⚙'], [/flur|diele|hall/i, '◈']]

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

function buildPlan(picked, perRoom) {
  const roomNames = new Map(db.prepare('SELECT id, name FROM rooms').all().map(r => [r.id, r.name]))
  const byRoom = new Map()
  for (const d of picked) {
    d.roomName = d.room_id != null ? roomNames.get(d.room_id) : d.meta.area || null
    if (d.roomName) byRoom.set(d.roomName, [...(byRoom.get(d.roomName) ?? []), d])
  }
  const rooms = [...byRoom].sort((a, b) => b[1].length - a[1].length)
  const home = { name: 'Übersicht', icon: '⌂', widgets: [{ type: 'clock', title: '', x: 0, y: 0, w: 3, h: 2, config: {} }] }
  picked.filter(d => ENERGY_TYPES.includes(d.type) || d.capabilities.some(c => c.quantity === 'power')).sort((a, b) => rank(a) - rank(b)).slice(0, 3)
    .forEach((d, i) => home.widgets.push({ type: 'device', title: d.name, x: 3 + i * 3, y: 0, w: 3, h: 2, config: { device_id: d.id } }))
  const cols = [2, 2, 2]
  for (const [name, devs] of rooms) {
    const c = cols.indexOf(Math.min(...cols))
    const h = Math.max(3, Math.min(9, 1 + Math.ceil(devs.length * 0.6)))
    home.widgets.push({ type: 'room', title: name, x: c * 4, y: cols[c], w: 4, h, room: name, devices: devs.map(d => d.id) })
    cols[c] += h
  }
  const dashboards = [home]
  if (perRoom) {
    for (const [name, devs] of rooms.filter(([, d]) => d.length >= 3).slice(0, 12)) {
      dashboards.push({
        name, icon: ROOM_ICONS.find(([re]) => re.test(name))?.[1] ?? '◈',
        widgets: devs.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 24)
          .map((d, i) => ({ type: 'device', title: d.name, x: (i % 4) * 3, y: Math.floor(i / 4) * 2, w: 3, h: 2, config: { device_id: d.id } })),
      })
    }
  }
  return { dashboards, rooms: byRoom.size }
}

export function generate({ replace = true, rooms: perRoom = true, dryRun = false } = {}) {
  const all = db.prepare('SELECT d.* FROM devices d JOIN integrations i ON i.id = d.integration_id WHERE i.enabled = 1').all()
    .map(r => ({ ...r, capabilities: json(r.capabilities || '[]'), meta: json(r.meta), hidden: !!r.hidden, adopted: !!r.adopted }))
  const picked = all.filter(relevant)
  const plan = buildPlan(picked, perRoom)
  const summary = { devices_total: all.length, devices_used: picked.length, rooms: plan.rooms, dashboards: plan.dashboards.length, created: !!(getSetting('autogen_dashboards') ?? []).length }
  if (dryRun) return { ...summary, plan: plan.dashboards }

  db.exec('BEGIN')
  try {
    const upd = db.prepare('UPDATE devices SET adopted = 1, room_id = ? WHERE id = ?')
    for (const d of picked) upd.run(d.roomName ? roomFor(d.roomName) : null, d.id)
    if (replace) for (const id of getSetting('autogen_dashboards') ?? []) db.prepare('DELETE FROM dashboards WHERE id = ?').run(id)
    const created = []
    let pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM dashboards').get().p
    const widget = db.prepare('INSERT INTO widgets (dashboard_id, type, title, x, y, w, h, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    for (const d of plan.dashboards) {
      const id = db.prepare("INSERT INTO dashboards (name, icon, position, style) VALUES (?, ?, ?, 'glass')").run(d.name, d.icon, pos++).lastInsertRowid
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
