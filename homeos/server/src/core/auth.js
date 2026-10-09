import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { db } from './db.js'
import { log } from './logger.js'

export const PERMISSIONS = [
  'dashboards.view', 'dashboards.edit', 'sources.view', 'sources.edit', 'devices.view', 'devices.control', 'devices.manage',
  'notifications.view', 'notifications.manage', 'automations.view', 'automations.manage', 'plugins.view', 'plugins.manage',
  'users.manage', 'logs.view', 'versions.view', 'versions.restore', 'system.view', 'profile.edit',
]

export const ROLES = {
  admin: ['*'],
  user: ['dashboards.view', 'dashboards.edit', 'sources.view', 'devices.view', 'devices.control', 'devices.manage', 'notifications.view', 'notifications.manage', 'automations.view', 'automations.manage', 'plugins.view', 'versions.view', 'system.view', 'profile.edit'],
  restricted: ['dashboards.view', 'devices.view', 'devices.control', 'notifications.view', 'notifications.manage', 'profile.edit'],
  guest: ['dashboards.view', 'devices.view', 'notifications.view'],
}

export const can = (user, perm) => !!user && (ROLES[user.role] ?? []).some(p => p === '*' || p === perm)

export function hashSecret(secret) {
  const salt = randomBytes(16)
  return salt.toString('hex') + ':' + scryptSync(secret, salt, 64).toString('hex')
}

export function verifySecret(secret, stored) {
  if (!stored) return false
  const [salt, hash] = stored.split(':')
  const a = Buffer.from(hash, 'hex')
  const b = scryptSync(String(secret), Buffer.from(salt, 'hex'), 64)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'password.too_short'
  return null
}

export function pinProblem(pin) {
  if (!/^\d{4,8}$/.test(String(pin ?? ''))) return 'pin.invalid'
  return null
}

export const SESSION_DAYS = 30

export function createSession(userId) {
  const token = randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, Date.now() + SESSION_DAYS * 864e5)
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
  return token
}

export const publicUser = u => u && ({
  id: u.id, name: u.name, display_name: u.display_name ?? u.name, role: u.role, locale: u.locale ?? 'de',
  has_pin: !!u.pin, disabled: !!u.disabled,
  permissions: ROLES[u.role]?.includes('*') ? PERMISSIONS : ROLES[u.role] ?? [],
})

export function userFromToken(token) {
  if (!token) return null
  return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ? AND u.disabled = 0`).get(token, Date.now()) ?? null
}

const attempts = new Map()
const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10

export function loginBlocked(key) {
  const a = attempts.get(key)
  if (!a || a.until < Date.now()) return false
  return a.count >= MAX_ATTEMPTS
}

export function loginFailed(key, ip, name) {
  const a = attempts.get(key)
  const now = Date.now()
  if (!a || a.until < now) attempts.set(key, { count: 1, until: now + WINDOW_MS })
  else a.count++
  log('security', 'warning', 'login.failed', { ip, name })
}

export function loginSucceeded(key, user, ip, method) {
  attempts.delete(key)
  log('security', 'info', 'login.success', { ip, method }, user.id)
}

export function seedAdmin() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return
  const pw = process.env.HOMEOS_ADMIN_PASSWORD
  if (!pw) throw new Error('HOMEOS_ADMIN_PASSWORD fehlt (erster Start)')
  db.prepare("INSERT INTO users (name, password, role) VALUES (?, ?, 'admin')").run(process.env.HOMEOS_ADMIN_USER ?? 'admin', hashSecret(pw))
  log('users', 'info', 'user.created', { name: process.env.HOMEOS_ADMIN_USER ?? 'admin', role: 'admin' })
}
