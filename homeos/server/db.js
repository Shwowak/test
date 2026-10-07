import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const file = process.env.HOMEOS_DB ?? './data/homeos.db'
mkdirSync(dirname(file), { recursive: true })
export const db = new DatabaseSync(file)

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
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
  config TEXT NOT NULL DEFAULT '{}');
`)

export function hashPassword(pw) {
  const salt = randomBytes(16)
  return salt.toString('hex') + ':' + scryptSync(pw, salt, 64).toString('hex')
}

export function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':')
  const a = Buffer.from(hash, 'hex')
  const b = scryptSync(pw, Buffer.from(salt, 'hex'), 64)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
    const pw = process.env.HOMEOS_ADMIN_PASSWORD
    if (!pw) throw new Error('HOMEOS_ADMIN_PASSWORD fehlt (erster Start)')
    db.prepare('INSERT INTO users (name, password) VALUES (?, ?)').run(process.env.HOMEOS_ADMIN_USER ?? 'admin', hashPassword(pw))
  }
  if (db.prepare('SELECT COUNT(*) c FROM dashboards').get().c === 0) {
    const id = db.prepare('INSERT INTO dashboards (name, icon) VALUES (?, ?)').run('Zuhause', '⌂').lastInsertRowid
    const add = db.prepare('INSERT INTO widgets (dashboard_id, type, title, x, y, w, h, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    const w = (type, title, x, y, ww, h, cfg = {}) => add.run(id, type, title, x, y, ww, h, JSON.stringify(cfg))
    w('kpi', 'Innen', 0, 0, 3, 2, { value: 21.5, unit: '°C', color: '#22D3EE', decimals: 1 })
    w('kpi', 'Strom jetzt', 3, 0, 3, 2, { value: 842, unit: 'W', color: '#F59E0B' })
    w('kpi', 'PV heute', 6, 0, 3, 2, { value: 12.4, unit: 'kWh', color: '#22C55E', decimals: 1 })
    w('kpi', 'Netzwerk', 9, 0, 3, 2, { value: 37, unit: 'Geräte', color: '#EC4899' })
    w('clock', 'Uhrzeit', 0, 2, 4, 3)
    w('chart', 'Verbrauch 24 h', 4, 2, 8, 3, { style: 'wave', color: '#EC4899', unit: 'kW', values: [0.4, 0.3, 0.3, 0.5, 1.2, 2.1, 1.4, 0.9, 1.1, 2.8, 1.6, 1.2, 0.9, 1.4, 3.2, 2.2, 1.5, 1.1, 0.8, 0.6] })
    w('gauge', 'CPU Server', 0, 5, 3, 3, { value: 42, max: 100, unit: '%', color: '#8B5CF6' })
    w('gauge', 'Speicher', 3, 5, 3, 3, { value: 68, max: 100, unit: '%', color: '#22D3EE' })
    w('chart', 'Firewall Blocks / h', 6, 5, 6, 3, { style: 'spectrum', values: [12, 18, 9, 22, 30, 14, 26, 19, 33, 21, 15, 28, 24, 17] })
    w('chart', 'Bandbreite', 0, 8, 6, 3, { style: 'line', color: '#22D3EE', unit: 'Mbit/s', values: [120, 180, 90, 240, 310, 200, 160, 280, 350, 260, 190, 230] })
    w('chart', 'Wasser', 6, 8, 6, 3, { style: 'bar', color: '#3B82F6', unit: 'l', values: [80, 120, 95, 140, 110, 160, 130] })
  }
}
