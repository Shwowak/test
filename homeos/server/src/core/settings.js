import { db } from './db.js'

export const DEFAULT_SETTINGS = {
  location: { lat: 52.52, lon: 13.405, name: 'Berlin' },
  timezone: process.env.TZ || 'Europe/Berlin',
  autologin: null,
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

export function isLocalIp(ip = '') {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)
}

export function isLanIp(ip = '') {
  const v4 = ip.replace(/^::ffff:/, '')
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(v4) || /^172\.(1[6-9]|2\d|3[01])\./.test(v4)) return true
  return /^(::1$|f[cd]|fe80:)/i.test(ip)
}
