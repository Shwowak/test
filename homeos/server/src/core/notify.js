import { db } from './db.js'
import { bus } from './events.js'
import { log } from './logger.js'

export const NOTIFICATION_LEVELS = ['info', 'warning', 'critical', 'emergency']
const KEEP = Number(process.env.HOMEOS_NOTIFICATIONS_KEEP ?? 2000)

export function notify({ level = 'info', title, message = null, source = 'system', data = null }) {
  if (!NOTIFICATION_LEVELS.includes(level)) level = 'info'
  const ts = new Date().toISOString()
  const id = db.prepare('INSERT INTO notifications (ts, level, title, message, source, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ts, level, String(title).slice(0, 200), message ? String(message).slice(0, 2000) : null, source, data ? JSON.stringify(data) : null).lastInsertRowid
  db.prepare('DELETE FROM notifications WHERE id <= (SELECT MAX(id) FROM notifications) - ?').run(KEEP)
  const n = { id, ts, level, title, message, source, acknowledged_at: null }
  bus.emit('notification', n)
  if (level === 'critical' || level === 'emergency') log('system', level === 'emergency' ? 'critical' : 'error', 'notification.' + level, { title, source })
  return n
}

export function acknowledge(ids, user) {
  const ts = new Date().toISOString()
  const upd = db.prepare('UPDATE notifications SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ? AND acknowledged_at IS NULL')
  let n = 0
  for (const id of ids) n += Number(upd.run(ts, user?.id ?? null, id).changes)
  if (n) bus.emit('notification.ack', { ids })
  return n
}

export function listNotifications({ open = false, limit = 100 } = {}) {
  return db.prepare(`SELECT n.*, u.name AS acknowledged_by_name FROM notifications n LEFT JOIN users u ON u.id = n.acknowledged_by
    ${open ? 'WHERE n.acknowledged_at IS NULL' : ''} ORDER BY n.id DESC LIMIT ?`).all(Math.min(Number(limit), 1000))
}
