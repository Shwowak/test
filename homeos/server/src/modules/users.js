import { db } from '../core/db.js'
import { hashSecret, publicUser, passwordProblem, pinProblem, ROLES } from '../core/auth.js'
import { HttpError, badRequest, notFound, requirePerm } from '../core/http.js'
import { log } from '../core/logger.js'
import { LOCALES } from './registry.js'

const userBody = {
  type: 'object',
  properties: {
    name: { type: 'string', pattern: '^[a-zA-Z0-9._-]{2,32}$' },
    display_name: { type: 'string', maxLength: 80 },
    role: { type: 'string', enum: Object.keys(ROLES) },
    locale: { type: 'string' },
    password: { type: 'string' },
    pin: { type: ['string', 'null'] },
    disabled: { type: 'boolean' },
  },
}

const adminCount = () => db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND disabled = 0").get().c

export default async function usersModule(app) {
  const opts = (summary, extra = {}) => ({ schema: { tags: ['users'], summary, ...extra }, preHandler: requirePerm('users.manage') })

  app.get('/users', opts('List users'), async () => db.prepare('SELECT * FROM users ORDER BY name').all().map(publicUser))

  app.post('/users', opts('Create user', { body: { ...userBody, required: ['name', 'role', 'password'] } }), async req => {
    const b = req.body
    const p = passwordProblem(b.password)
    if (p) throw badRequest(p)
    if (b.pin && pinProblem(b.pin)) throw badRequest('pin.invalid')
    if (b.locale && !LOCALES.includes(b.locale)) throw badRequest('locale.invalid')
    if (db.prepare('SELECT 1 FROM users WHERE name = ?').get(b.name)) throw new HttpError(409, 'user.exists')
    const id = db.prepare('INSERT INTO users (name, display_name, role, locale, password, pin) VALUES (?, ?, ?, ?, ?, ?)')
      .run(b.name, b.display_name ?? null, b.role, b.locale ?? 'de', hashSecret(b.password), b.pin ? hashSecret(b.pin) : null).lastInsertRowid
    log('users', 'info', 'user.created', { name: b.name, role: b.role }, req.user.id)
    return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))
  })

  app.put('/users/:id', opts('Update user', { body: userBody }), async req => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
    if (!u) throw notFound()
    const b = req.body
    const demotes = (b.role && b.role !== 'admin') || b.disabled === true
    if (u.role === 'admin' && !u.disabled && demotes && adminCount() <= 1) throw badRequest('user.last_admin')
    if (b.password) {
      const p = passwordProblem(b.password)
      if (p) throw badRequest(p)
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashSecret(b.password), u.id)
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id)
      log('security', 'warning', 'password.reset', { user: u.name }, req.user.id)
    }
    if (b.pin !== undefined) {
      if (b.pin && pinProblem(b.pin)) throw badRequest('pin.invalid')
      db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(b.pin ? hashSecret(b.pin) : null, u.id)
    }
    if (b.locale && !LOCALES.includes(b.locale)) throw badRequest('locale.invalid')
    db.prepare(`UPDATE users SET display_name = COALESCE(?, display_name), role = COALESCE(?, role),
      locale = COALESCE(?, locale), disabled = COALESCE(?, disabled) WHERE id = ?`)
      .run(b.display_name ?? null, b.role ?? null, b.locale ?? null, b.disabled === undefined ? null : Number(b.disabled), u.id)
    if (b.disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id)
    log('users', 'info', 'user.updated', { user: u.name, role: b.role, disabled: b.disabled }, req.user.id)
    return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id))
  })

  app.delete('/users/:id', opts('Delete user'), async req => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
    if (!u) throw notFound()
    if (u.id === req.user.id) throw badRequest('user.delete_self')
    if (u.role === 'admin' && adminCount() <= 1) throw badRequest('user.last_admin')
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id)
    log('users', 'warning', 'user.deleted', { user: u.name }, req.user.id)
    return { ok: true }
  })
}
