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
    add.run(id, 'clock', 'Uhrzeit', 0, 0, 4, 3, '{}')
    add.run(id, 'text', 'Willkommen', 4, 0, 8, 3, JSON.stringify({ text: 'Tippe auf ✎ um Widgets anzulegen, zu verschieben und Datenquellen auszuwählen.' }))
    add.run(id, 'kpi', 'Beispielwert', 0, 3, 3, 2, JSON.stringify({ value: 21.5, unit: '°C', color: '#22D3EE' }))
    add.run(id, 'gauge', 'Auslastung', 3, 3, 3, 3, JSON.stringify({ value: 42, max: 100, unit: '%', color: '#8B5CF6' }))
    add.run(id, 'chart', 'Verlauf', 6, 3, 6, 3, JSON.stringify({ values: [3, 5, 4, 8, 6, 9, 7, 11, 9, 13], color: '#EC4899' }))
  }
}
