import { db } from './db.js'
import { bus } from './events.js'

export const LOG_CATEGORIES = ['system', 'network', 'bluetooth', 'plugins', 'devices', 'automations', 'users', 'security', 'updates', 'errors']
export const LOG_LEVELS = ['debug', 'info', 'warning', 'error', 'critical']

const insert = db.prepare('INSERT INTO logs (ts, level, category, message, data, user_id) VALUES (?, ?, ?, ?, ?, ?)')
const MAX_ROWS = Number(process.env.HOMEOS_LOG_MAX ?? 50000)
let writes = 0

export function log(category, level, message, data = null, userId = null) {
  if (!LOG_CATEGORIES.includes(category)) category = 'system'
  if (!LOG_LEVELS.includes(level)) level = 'info'
  const ts = new Date().toISOString()
  insert.run(ts, level, category, message, data ? JSON.stringify(data) : null, userId)
  if (level === 'error' || level === 'critical') {
    if (category !== 'errors') insert.run(ts, level, 'errors', `[${category}] ${message}`, data ? JSON.stringify(data) : null, userId)
  }
  if (++writes % 500 === 0) db.prepare('DELETE FROM logs WHERE id <= (SELECT MAX(id) FROM logs) - ?').run(MAX_ROWS)
  bus.emit('log', { ts, level, category, message })
}

export function queryLogs({ category, level, q, from, to, limit = 200, offset = 0 }) {
  const where = []
  const args = []
  if (category) { where.push('category = ?'); args.push(category) }
  if (level) { where.push(`level IN (${LOG_LEVELS.slice(LOG_LEVELS.indexOf(level)).map(() => '?').join(',')})`); args.push(...LOG_LEVELS.slice(LOG_LEVELS.indexOf(level))) }
  if (q) { where.push('(message LIKE ? OR data LIKE ?)'); args.push(`%${q}%`, `%${q}%`) }
  if (from) { where.push('ts >= ?'); args.push(from) }
  if (to) { where.push('ts <= ?'); args.push(to) }
  const sql = `SELECT l.*, u.name AS user_name FROM logs l LEFT JOIN users u ON u.id = l.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.id DESC LIMIT ? OFFSET ?`
  return db.prepare(sql).all(...args, Math.min(Number(limit), 5000), Number(offset))
}
