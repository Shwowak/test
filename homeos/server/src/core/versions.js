import { db, tx } from './db.js'
import { bus } from './events.js'
import { log } from './logger.js'
import { invalidate, startAll } from '../devices/engine.js'

const TABLES = ['rooms', 'integrations', 'devices', 'dashboards', 'widgets', 'data_sources', 'automations', 'plugins']
const KEEP = Number(process.env.HOMEOS_VERSIONS_KEEP ?? 1000)

function snapshot() {
  const out = {}
  for (const t of TABLES) out[t] = db.prepare(`SELECT * FROM ${t}`).all()
  return out
}

export function recordChange(user, entity, entityId, action, summary = null) {
  db.prepare(`INSERT INTO config_versions (ts, user_id, user_name, entity, entity_id, action, summary, snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    new Date().toISOString(), user?.id ?? null, user?.name ?? null, entity, entityId ?? null, action, summary, JSON.stringify(snapshot()))
  db.prepare('DELETE FROM config_versions WHERE id <= (SELECT MAX(id) FROM config_versions) - ?').run(KEEP)
  bus.emit('config.changed', { entity, entityId, action })
}

export function listVersions(limit = 100) {
  return db.prepare(`SELECT id, ts, user_name, entity, entity_id, action, summary FROM config_versions
    ORDER BY id DESC LIMIT ?`).all(Math.min(Number(limit), 1000))
}

export function restoreVersion(id, user) {
  const row = db.prepare('SELECT * FROM config_versions WHERE id = ?').get(id)
  if (!row) return false
  const snap = JSON.parse(row.snapshot)
  tx(() => {
    db.exec('PRAGMA defer_foreign_keys = ON')
    for (const t of [...TABLES].reverse()) if (snap[t]) db.exec(`DELETE FROM ${t}`)
    for (const t of TABLES) {
      if (!snap[t]) continue
      for (const r of snap[t]) {
        const cols = Object.keys(r)
        db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => r[c]))
      }
    }
  })
  invalidate()
  startAll()
  bus.emit('config.restored')
  log('system', 'warning', 'version.restored', { version: id, from: row.ts }, user?.id)
  recordChange(user, 'system', null, 'restore', `#${id} (${row.ts})`)
  return true
}
