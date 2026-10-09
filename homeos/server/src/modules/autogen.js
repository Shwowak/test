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

export function generate({ replace = true, rooms: perRoom = true, dryRun = false } = {}) {
  const all = db.prepare('SELECT d.* FROM devices d JOIN integrations i ON i.id = d.integration_id WHERE i.enabled = 1').all()
    .map(r => ({ ...r, capabilities: json(r.capabilities || '[]'), meta: json(r.meta), hidden: !!r.hidden, adopted: !!r.adopted }))
  const picked = all.filter(relevant)
  const plan = new Map()
  for (const d of picked) {
    const room = d.room_id ?? (d.meta.area ? (dryRun ? `new:${d.meta.area}` : roomFor(d.meta.area)) : null)
    d.room = room
    if (room != null) plan.set(room, [...(plan.get(room) ?? []), d])
  }
  const summary = { devices_total: all.length, devices_used: picked.length, rooms: plan.size, dashboards: 0 }
  if (dryRun) return summary

  db.exec('BEGIN')
  try {
    const upd = db.prepare('UPDATE devices SET adopted = 1, room_id = ? WHERE id = ?')
    for (const d of picked) upd.run(d.room ?? null, d.id)

    if (replace) for (const id of getSetting('autogen_dashboards') ?? []) db.prepare('DELETE FROM dashboards WHERE id = ?').run(id)
    const created = []
    let pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM dashboards').get().p
    const dash = (name, icon) => {
      const id = db.prepare("INSERT INTO dashboards (name, icon, position, style) VALUES (?, ?, ?, 'seamless')").run(name, icon, pos++).lastInsertRowid
      created.push(id)
      return id
    }
    const widget = db.prepare('INSERT INTO widgets (dashboard_id, type, title, x, y, w, h, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    const roomName = id => db.prepare('SELECT name FROM rooms WHERE id = ?').get(id)?.name ?? ''
    const rooms = [...plan].sort((a, b) => b[1].length - a[1].length)

    const home = dash('Übersicht', '⌂')
    widget.run(home, 'clock', '', 0, 0, 3, 2, '{}')
    const energy = picked.filter(d => ENERGY_TYPES.includes(d.type) || d.capabilities.some(c => c.quantity === 'power')).sort((a, b) => rank(a) - rank(b)).slice(0, 3)
    energy.forEach((d, i) => widget.run(home, 'device', d.name, 3 + i * 3, 0, 3, 2, JSON.stringify({ device_id: d.id })))
    const cols = [2, 2, 2]
    for (const [room, devs] of rooms) {
      const c = cols.indexOf(Math.min(...cols))
      const h = Math.max(3, Math.min(9, 1 + Math.ceil(devs.length * 0.6)))
      widget.run(home, 'room', roomName(room), c * 4, cols[c], 4, h, JSON.stringify({ room_id: room }))
      cols[c] += h
    }

    if (perRoom) {
      for (const [room, devs] of rooms.filter(([, d]) => d.length >= 3).slice(0, 12)) {
        const name = roomName(room)
        const id = dash(name, ROOM_ICONS.find(([re]) => re.test(name))?.[1] ?? '◈')
        devs.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 24).forEach((d, i) =>
          widget.run(id, 'device', d.name, (i % 4) * 3, Math.floor(i / 4) * 2, 3, 2, JSON.stringify({ device_id: d.id })))
      }
    }
    setSetting('autogen_dashboards', created)
    db.exec('COMMIT')
    summary.dashboards = created.length
    summary.first = home
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  invalidate()
  return summary
}
