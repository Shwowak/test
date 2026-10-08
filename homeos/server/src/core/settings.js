import { db } from './db.js'

export const DEFAULT_SETTINGS = {
  location: { lat: 52.52, lon: 13.405, name: 'Berlin' },
  timezone: process.env.TZ || 'Europe/Berlin',
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? JSON.parse(row.value) : DEFAULT_SETTINGS[key]
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
}

export function allSettings() {
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(k => [k, getSetting(k)]))
}
