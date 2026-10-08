import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const file = process.env.HOMEOS_DB ?? './data/homeos.db'
mkdirSync(dirname(file), { recursive: true })
export const db = new DatabaseSync(file)

db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)

const MIGRATIONS = [
  () => db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS dashboards (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT DEFAULT '◈',
      position INTEGER NOT NULL DEFAULT 0, columns INTEGER NOT NULL DEFAULT 12);
    CREATE TABLE IF NOT EXISTS data_sources (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS widgets (
      id INTEGER PRIMARY KEY, dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
      type TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
      x INTEGER NOT NULL DEFAULT 0, y INTEGER NOT NULL DEFAULT 0, w INTEGER NOT NULL DEFAULT 3, h INTEGER NOT NULL DEFAULT 2,
      source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      config TEXT NOT NULL DEFAULT '{}');`),
  () => { if (!hasColumn('dashboards', 'style')) db.exec("ALTER TABLE dashboards ADD COLUMN style TEXT NOT NULL DEFAULT 'seamless'") },
  () => {
    if (!hasColumn('users', 'pin')) db.exec('ALTER TABLE users ADD COLUMN pin TEXT')
    if (!hasColumn('users', 'locale')) db.exec("ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'de'")
    if (!hasColumn('users', 'display_name')) db.exec('ALTER TABLE users ADD COLUMN display_name TEXT')
    if (!hasColumn('users', 'disabled')) db.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0')
    db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY, ts TEXT NOT NULL, level TEXT NOT NULL, category TEXT NOT NULL,
        message TEXT NOT NULL, data TEXT, user_id INTEGER);
      CREATE INDEX IF NOT EXISTS logs_ts ON logs(ts);
      CREATE INDEX IF NOT EXISTS logs_cat ON logs(category, level);
      CREATE TABLE IF NOT EXISTS config_versions (
        id INTEGER PRIMARY KEY, ts TEXT NOT NULL, user_id INTEGER, user_name TEXT,
        entity TEXT NOT NULL, entity_id INTEGER, action TEXT NOT NULL, summary TEXT, snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)
  },
  () => db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '▢', position INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS integrations (
      id INTEGER PRIMARY KEY, adapter TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY, integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
      native_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'sensor',
      manufacturer TEXT, model TEXT, room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
      groups TEXT NOT NULL DEFAULT '[]', capabilities TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL DEFAULT '{}',
      meta TEXT NOT NULL DEFAULT '{}', connection TEXT NOT NULL DEFAULT 'unknown', battery REAL, rssi REAL,
      last_seen TEXT, adopted INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
      UNIQUE (integration_id, native_id));
    CREATE INDEX IF NOT EXISTS devices_room ON devices(room_id);`),
  () => db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY, ts TEXT NOT NULL, level TEXT NOT NULL, title TEXT NOT NULL, message TEXT,
      source TEXT NOT NULL DEFAULT 'system', data TEXT, acknowledged_at TEXT, acknowledged_by INTEGER);
    CREATE INDEX IF NOT EXISTS notifications_open ON notifications(acknowledged_at, level);
    CREATE TABLE IF NOT EXISTS automations (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      triggers TEXT NOT NULL DEFAULT '[]', conditions TEXT NOT NULL DEFAULT '[]', actions TEXT NOT NULL DEFAULT '[]',
      cooldown INTEGER NOT NULL DEFAULT 0, last_run TEXT, run_count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS automation_runs (
      id INTEGER PRIMARY KEY, automation_id INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
      ts TEXT NOT NULL, trigger TEXT, ok INTEGER NOT NULL, error TEXT, duration_ms INTEGER);
    CREATE INDEX IF NOT EXISTS automation_runs_a ON automation_runs(automation_id, id);`),
]

export function migrate() {
  const current = db.prepare('PRAGMA user_version').get().user_version
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      MIGRATIONS[v]()
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}

migrate()

export function tx(fn) {
  db.exec('BEGIN')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export const json = s => JSON.parse(s || '{}')
